import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  type User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc, terminate, clearIndexedDbPersistence } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from '../firebase/config';
import type { AppUser } from '../types';

export interface SessionInfo {
  appUser: AppUser;
  tenantId: string | null; // null for platform admins (they have no workspace)
  isPlatformAdmin: boolean;
  isTenantAdmin: boolean;
}

const DEFAULT_MODULES = ['inbox', 'campaigns', 'crm', 'scheduling', 'knowledge', 'settings'];

export async function signIn(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
  // Wipe this browser's local Firestore copy, so the next person on this computer never sees the
  // previous user's data. Firestore must be stopped before its cache can be cleared, so the page reloads
  // afterwards (back to the sign-in screen with a fresh Firestore).
  if (typeof window !== 'undefined' && isFirebaseConfigured && db) {
    try {
      await terminate(db);
      await clearIndexedDbPersistence(db);
    } catch (err) {
      console.warn('[Auth] Could not clear the local Firestore cache:', err);
    }
    window.location.reload();
  }
}

export async function requestPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

/** Fresh ID token (auto-refreshed by the SDK when near expiry). */
export async function getIdToken(forceRefresh = false): Promise<string | null> {
  const u = auth.currentUser;
  return u ? u.getIdToken(forceRefresh) : null;
}

/** Turn a Firebase user + its server-set claims into the app's session model. */
export async function buildSession(fbUser: FirebaseUser): Promise<SessionInfo> {
  // forceRefresh so freshly-set claims (e.g. right after an invite) are seen
  const tokenResult = await fbUser.getIdTokenResult(true);
  const claims = tokenResult.claims as { tenantId?: string; role?: string; platformAdmin?: boolean };
  const isPlatformAdmin = claims.platformAdmin === true;
  const tenantId = isPlatformAdmin ? null : claims.tenantId || null;
  const isTenantAdmin = isPlatformAdmin || claims.role === 'admin';

  let allowedModules = DEFAULT_MODULES;
  let name = fbUser.displayName || (fbUser.email || '').split('@')[0] || 'User';
  if (isFirebaseConfigured && db && !isPlatformAdmin) {
    try {
      const snap = await getDoc(doc(db, 'users', fbUser.uid));
      if (snap.exists()) {
        const d = snap.data() as any;
        if (Array.isArray(d.allowedModules) && d.allowedModules.length) allowedModules = d.allowedModules;
        if (d.name) name = d.name;
        if (d.active === false) throw new Error('This account has been deactivated.');
      }
    } catch (e: any) {
      if (e?.message?.includes('deactivated')) throw e;
      // rules may not allow the read yet; fall back to defaults
    }
  }

  const now = new Date().toISOString();
  return {
    tenantId,
    isPlatformAdmin,
    isTenantAdmin,
    appUser: {
      userId: fbUser.uid,
      email: fbUser.email || '',
      username: (fbUser.email || '').split('@')[0],
      password: '', // passwords are never held client-side
      name,
      role: isTenantAdmin ? 'ADMIN' : 'SPECIALIST',
      accessLevel: isTenantAdmin ? 'ALL' : 'CUSTOM',
      allowedModules,
      isActive: true,
      createdAt: fbUser.metadata.creationTime || now,
      updatedAt: now,
    },
  };
}

/** Subscribe to sign-in / sign-out. Callback gets null when signed out. */
export function onSession(cb: (s: SessionInfo | null, err?: Error) => void): () => void {
  return onAuthStateChanged(auth, async (fbUser) => {
    if (!fbUser) return cb(null);
    try {
      cb(await buildSession(fbUser));
    } catch (e: any) {
      await signOut(auth).catch(() => {});
      cb(null, e);
    }
  });
}

/** Human-friendly message for Firebase auth errors (no account enumeration). */
export function friendlyAuthError(e: any): string {
  const code = e?.code || '';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Try again later or reset your password.';
  if (code === 'auth/user-disabled') return 'This account has been disabled.';
  if (code === 'auth/network-request-failed') return 'Network error. Check your connection.';
  if (e?.message?.includes('deactivated')) return e.message;
  return 'Invalid email or password.';
}

let fetchPatched = false;

export const authFetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const original = typeof window !== 'undefined' && window.fetch ? window.fetch.bind(window) : fetch.bind(globalThis);
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const isApi = url.startsWith('/api/') || (typeof window !== 'undefined' && url.startsWith(`${window.location.origin}/api/`));
  if (!isApi) return original(input, init);

  const token = await getIdToken().catch(() => null);
  if (!token) return original(input, init);

  const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
  headers.set('Authorization', `Bearer ${token}`);
  return original(input, { ...init, headers });
};

/**
 * Attach the Firebase ID token to every same-origin /api/ request.
 * Call once at startup. (Authorization carries ONLY the Firebase token; the
 * Google Calendar token goes in X-Google-Access-Token.)
 */
export function installAuthFetch(): void {
  if (fetchPatched || typeof window === 'undefined') return;
  fetchPatched = true;

  try {
    const original = window.fetch ? window.fetch.bind(window) : fetch.bind(globalThis);
    const patched = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const isApi = url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`);
      if (!isApi) return original(input, init);

      const token = await getIdToken().catch(() => null);
      if (!token) return original(input, init);

      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      headers.set('Authorization', `Bearer ${token}`);
      return original(input, { ...init, headers });
    };

    // Use Object.defineProperty to shadow getter on Window.prototype without throwing
    try {
      Object.defineProperty(window, 'fetch', {
        value: patched,
        writable: true,
        configurable: true,
      });
    } catch {
      try {
        Object.defineProperty(window, 'fetch', {
          get: () => patched,
          configurable: true,
        });
      } catch {
        try {
          (window as any).fetch = patched;
        } catch {
          (globalThis as any).fetch = patched;
        }
      }
    }
  } catch (err) {
    console.warn('[authService] Could not patch global fetch:', err);
  }
}