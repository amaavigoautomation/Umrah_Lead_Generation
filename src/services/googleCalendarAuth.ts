import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, User, signOut, getAuth, type Auth } from 'firebase/auth';
import { initializeApp, getApps } from 'firebase/app';
import { auth, firebaseConfig } from '../firebase/config.js';

import { CALENDAR_TARGET_ACCOUNT } from '../shared/brandLabels';
export { CALENDAR_TARGET_ACCOUNT };
export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
];

let cachedAccessToken: string | null = null;
let cachedUser: User | null = null;
let isSigningIn = false;

// Try restoring cached token from sessionStorage if in browser
if (typeof window !== 'undefined') {
  try {
    // Only a token this browser got from the popup in the last 55 minutes (see dropExpiredToken).
    const exp = Number(window.sessionStorage.getItem('calendar_access_token_exp') || 0);
    cachedAccessToken = exp && Date.now() < exp ? window.sessionStorage.getItem('calendar_access_token') : null;
  } catch {}
}

/** True when this browser already holds a calendar token (used so the page does not flash "Disconnected"). */
export const hasCalendarToken = (): boolean => Boolean(cachedAccessToken);

const provider = new GoogleAuthProvider();
CALENDAR_SCOPES.forEach((scope) => provider.addScope(scope));
provider.setCustomParameters({
  login_hint: CALENDAR_TARGET_ACCOUNT,
  prompt: 'consent',
  access_type: 'offline',
});

/**
 * A SEPARATE Firebase auth instance used only for the Google Calendar popup.
 *
 * The popup must never run on the app's own `auth`: signInWithPopup(auth, ...) replaces the signed-in
 * workspace user with the Google account, which has no workspace, so the app showed
 * "Your account is not assigned to a workspace yet" and the calendar token could not be saved either.
 * With its own instance the popup only hands us the Google access token; the app session is untouched.
 */
let calendarOAuthAuth: Auth | null = null;
function getCalendarOAuthAuth(): Auth {
  if (!calendarOAuthAuth) {
    const name = 'calendar-oauth';
    const app = getApps().find((a) => a.name === name) || initializeApp(firebaseConfig, name);
    calendarOAuthAuth = getAuth(app);
  }
  return calendarOAuthAuth;
}

/**
 * Initializes Google Auth state listener and synchronizes active token to backend.
 */
/**
 * Google popup tokens live ~60 minutes. Past that this browser must not keep sending its token: the
 * server would try it, get 401 and mark the calendar expired again. Treat it as gone after 55 minutes.
 */
const TOKEN_EXP_KEY = 'calendar_access_token_exp';
const TOKEN_LIFETIME_MS = 55 * 60 * 1000;
function dropExpiredToken() {
  if (typeof window === 'undefined') return;
  try {
    const exp = Number(window.sessionStorage.getItem(TOKEN_EXP_KEY) || 0);
    // No expiry recorded = saved by an older build, age unknown: drop it too.
    if (!exp || Date.now() > exp) {
      cachedAccessToken = null;
      window.sessionStorage.removeItem('calendar_access_token');
      window.sessionStorage.removeItem(TOKEN_EXP_KEY);
    }
  } catch {}
}

export const initCalendarAuth = (
  onAuthSuccess?: (user: User | null, token: string) => void,
  onAuthFailure?: () => void
) => {
  dropExpiredToken();
  // If we already have a fresh session token, sync to server immediately
  if (cachedAccessToken && typeof window !== 'undefined') {
    syncCalendarTokenToServer(cachedAccessToken, CALENDAR_TARGET_ACCOUNT).then((ok) => {
      if (ok && onAuthSuccess) {
        onAuthSuccess(cachedUser, cachedAccessToken!);
      }
    });
  }

  return onAuthStateChanged(auth, async (user: User | null) => {
    cachedUser = user;
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else {
        if (onAuthFailure && !isSigningIn) onAuthFailure();
      }
    } else {
      // Don't wipe session token if user is viewing without explicit Firebase logout
      if (!cachedAccessToken && onAuthFailure) {
        onAuthFailure();
      }
    }
  });
};

/**
 * Signs in with Google to obtain calendar.events OAuth access token.
 */
export const signInWithGoogleCalendar = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    // Popup on the separate instance: the workspace user stays signed in to the app.
    const calendarAuth = getCalendarOAuthAuth();
    const result = await signInWithPopup(calendarAuth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    // We only needed the Google access token, not a second login: drop the Google session straight away.
    await signOut(calendarAuth).catch(() => {});
    if (!credential?.accessToken) {
      throw new Error('Failed to get Google Calendar OAuth access token from credential. Please ensure popup permissions are allowed.');
    }

    cachedAccessToken = credential.accessToken;

    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.setItem('calendar_access_token', credential.accessToken);
        window.sessionStorage.setItem(TOKEN_EXP_KEY, String(Date.now() + TOKEN_LIFETIME_MS));
      } catch {}
    }

    // Sync token to the server (it stores it in this workspace's settings for background work)
    await syncCalendarTokenToServer(cachedAccessToken, result.user.email || CALENDAR_TARGET_ACCOUNT);

    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('[Google Calendar Auth Error]:', error);
    if (error?.code === 'auth/unauthorized-domain' || error?.message?.includes('unauthorized-domain')) {
      const currentDomain = typeof window !== 'undefined' ? window.location.hostname : 'leadgeneration-sable.vercel.app';
      throw new Error(
        `Firebase Unauthorized Domain Error: "${currentDomain}" is not whitelisted in Firebase Console. Add "${currentDomain}" to Firebase Console -> Authentication -> Settings -> Authorized domains. Alternatively, paste your access token below.`
      );
    }
    throw error;
  } finally {
    isSigningIn = false;
  }
};

/**
 * Manually registers an OAuth access token (useful for direct testing or pasting).
 */
export const registerCalendarAccessToken = async (token: string, userEmail: string = CALENDAR_TARGET_ACCOUNT): Promise<boolean> => {
  if (!token || !token.trim()) return false;
  const cleanToken = token.trim();
  cachedAccessToken = cleanToken;
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem('calendar_access_token', cleanToken);
      window.sessionStorage.setItem(TOKEN_EXP_KEY, String(Date.now() + TOKEN_LIFETIME_MS));
    } catch {}
  }
  return syncCalendarTokenToServer(cleanToken, userEmail);
};

/**
 * Gets this browser's calendar token (memory, then sessionStorage) while it is still fresh.
 * Never reads the old flat `settings/calendar_auth` doc: that held a long-dead token which was pushed
 * back to the server on every page load and overwrote a freshly re-synced one.
 */
export const getCalendarAccessToken = async (): Promise<string | null> => {
  dropExpiredToken();
  if (cachedAccessToken) return cachedAccessToken;

  if (typeof window !== 'undefined') {
    try {
      const sessionTok = window.sessionStorage.getItem('calendar_access_token');
      if (sessionTok) {
        cachedAccessToken = sessionTok;
        return sessionTok;
      }
    } catch {}
  }
  return null;
};

/**
 * Sends the acquired OAuth access token to the server, which stores it for this workspace.
 */
export const syncCalendarTokenToServer = async (token: string, userEmail: string): Promise<boolean> => {
  try {
    // 1. Send to server backend
    await fetch('/api/calendar/auth-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: token, email: userEmail, updatedAt: new Date().toISOString() }),
    }).catch(() => {});

    return true;
  } catch (err) {
    console.warn('[Calendar Auth Sync Notice]:', err);
    return false;
  }
};

/** Forgets the calendar token in this browser. Never signs the user out of the app itself. */
export const logoutCalendar = async () => {
  if (calendarOAuthAuth) await signOut(calendarOAuthAuth).catch(() => {});
  cachedAccessToken = null;
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.removeItem('calendar_access_token');
      window.sessionStorage.removeItem(TOKEN_EXP_KEY);
    } catch {}
  }
};