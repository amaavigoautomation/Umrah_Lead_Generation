import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, User, signOut } from 'firebase/auth';
import { auth, db, isFirebaseConfigured } from '../firebase/config.js';
import { doc, getDoc } from 'firebase/firestore';
import { safeSetDoc } from './clientFirestoreUtils.js';

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
    cachedAccessToken = window.sessionStorage.getItem('calendar_access_token');
  } catch {}
}

const provider = new GoogleAuthProvider();
CALENDAR_SCOPES.forEach((scope) => provider.addScope(scope));
provider.setCustomParameters({
  login_hint: CALENDAR_TARGET_ACCOUNT,
  prompt: 'consent',
  access_type: 'offline',
});

/**
 * Initializes Google Auth state listener and synchronizes active token to backend.
 */
export const initCalendarAuth = (
  onAuthSuccess?: (user: User | null, token: string) => void,
  onAuthFailure?: () => void
) => {
  // If we already have a session token, sync to server immediately
  if (cachedAccessToken && typeof window !== 'undefined') {
    syncCalendarTokenToServer(cachedAccessToken, CALENDAR_TARGET_ACCOUNT).then((ok) => {
      if (ok && onAuthSuccess) {
        onAuthSuccess(cachedUser, cachedAccessToken!);
      }
    });
  }

  // Also query Firestore for any previously registered active token
  fetchStoredCalendarToken().then((stored) => {
    if (stored?.accessToken) {
      cachedAccessToken = stored.accessToken;
      if (typeof window !== 'undefined') {
        try {
          window.sessionStorage.setItem('calendar_access_token', stored.accessToken);
        } catch {}
      }
      syncCalendarTokenToServer(stored.accessToken, stored.email || CALENDAR_TARGET_ACCOUNT);
      if (onAuthSuccess) {
        onAuthSuccess(cachedUser, stored.accessToken);
      }
    }
  });

  return onAuthStateChanged(auth, async (user: User | null) => {
    cachedUser = user;
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else {
        // Try fetching stored token from Firestore settings/calendar_auth
        const stored = await fetchStoredCalendarToken();
        if (stored && stored.accessToken) {
          cachedAccessToken = stored.accessToken;
          if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
          return;
        }
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
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get Google Calendar OAuth access token from credential. Please ensure popup permissions are allowed.');
    }

    cachedAccessToken = credential.accessToken;
    cachedUser = result.user;

    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.setItem('calendar_access_token', credential.accessToken);
      } catch {}
    }

    // Sync token to server API and Firestore settings for background pipeline access
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
    } catch {}
  }
  return syncCalendarTokenToServer(cleanToken, userEmail);
};

/**
 * Gets cached in-memory access token, or fetches from sessionStorage / Firestore settings.
 */
export const getCalendarAccessToken = async (): Promise<string | null> => {
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

  const stored = await fetchStoredCalendarToken();
  if (stored?.accessToken) {
    cachedAccessToken = stored.accessToken;
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.setItem('calendar_access_token', stored.accessToken);
      } catch {}
    }
    return cachedAccessToken;
  }
  return null;
};

/**
 * Syncs the acquired OAuth access token to the server endpoint and Firestore settings.
 */
export const syncCalendarTokenToServer = async (token: string, userEmail: string): Promise<boolean> => {
  try {
    // 1. Send to server backend
    await fetch('/api/calendar/auth-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: token, email: userEmail, updatedAt: new Date().toISOString() }),
    }).catch(() => {});

    // 2. Persist in Firestore settings for serverless / background worker access
    if (isFirebaseConfigured && db) {
      await safeSetDoc(
        doc(db, 'settings', 'calendar_auth'),
        {
          accessToken: token,
          email: userEmail || CALENDAR_TARGET_ACCOUNT,
          targetAccount: CALENDAR_TARGET_ACCOUNT,
          updatedAt: new Date().toISOString(),
          active: true,
        },
        { merge: true }
      );
    }
    return true;
  } catch (err) {
    console.warn('[Calendar Auth Sync Notice]:', err);
    return false;
  }
};

/**
 * Fetches stored calendar token from Firestore.
 */
export const fetchStoredCalendarToken = async (): Promise<{ accessToken: string; email: string } | null> => {
  if (!isFirebaseConfigured || !db) return null;
  try {
    const snap = await getDoc(doc(db, 'settings', 'calendar_auth'));
    if (snap.exists()) {
      const data = snap.data();
      if (data?.accessToken) {
        return { accessToken: data.accessToken, email: data.email || CALENDAR_TARGET_ACCOUNT };
      }
    }
  } catch (e) {
    console.warn('[Fetch Calendar Token Notice]:', e);
  }
  return null;
};

export const logoutCalendar = async () => {
  await signOut(auth);
  cachedAccessToken = null;
  cachedUser = null;
};
