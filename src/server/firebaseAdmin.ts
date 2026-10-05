import { initializeApp, getApps, cert, applicationDefault, App } from 'firebase-admin/app';
import { getAuth, Auth, UserRecord } from 'firebase-admin/auth';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';
import rawConfig from '../../firebase-applet-config.json';
import type { AuthClaims, UserRole } from '../types/tenant.js';

let initialized = false;

export function getFirebaseAdminApp(): App {
  const existingApps = getApps();
  if (existingApps.length > 0) {
    return existingApps[0];
  }

  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    rawConfig.projectId;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (serviceAccountJson) {
    try {
      const parsed = JSON.parse(serviceAccountJson);
      return initializeApp({
        credential: cert(parsed),
        projectId: parsed.project_id || projectId,
      });
    } catch (e) {
      console.warn('[Firebase Admin] Warning parsing FIREBASE_SERVICE_ACCOUNT_JSON:', e);
    }
  }

  try {
    return initializeApp({
      credential: applicationDefault(),
      projectId,
    });
  } catch {
    try {
      return initializeApp({
        projectId,
      });
    } catch {
      return getApps()[0] || initializeApp();
    }
  }
}

export function getAdminAuth(): Auth {
  const app = getFirebaseAdminApp();
  return getAuth(app);
}

let firestoreConfigured = false;

export function getAdminFirestore(): Firestore {
  const app = getFirebaseAdminApp();
  const dbId = process.env.FIRESTORE_DATABASE_ID || rawConfig.firestoreDatabaseId;
  let fs: Firestore;
  if (dbId && dbId !== '(default)') {
    try {
      fs = (getFirestore as any)(app, dbId);
    } catch {
      fs = getFirestore(app);
    }
  } else {
    fs = getFirestore(app);
  }
  if (!firestoreConfigured) {
    // Match the old client-SDK behaviour: skip `undefined` fields instead of throwing.
    try { fs.settings({ ignoreUndefinedProperties: true }); } catch {}
    firestoreConfigured = true;
  }
  return fs;
}

/**
 * Assigns tenant custom claims to a Firebase Auth user
 */
export async function setTenantUserClaims(
  uid: string,
  claims: AuthClaims
): Promise<void> {
  const auth = getAdminAuth();
  await auth.setCustomUserClaims(uid, {
    tenantId: claims.tenantId || null,
    role: claims.role || 'member',
    platformAdmin: Boolean(claims.platformAdmin),
  });
}

/**
 * Creates a user in Firebase Auth and assigns claims.
 * - An existing account is never silently moved to another tenant.
 * - With no password, a random one is generated; the user sets their own via
 *   the password-reset link (see createPasswordSetupLink).
 */
export async function createTenantUser(params: {
  email: string;
  password?: string;
  displayName?: string;
  tenantId: string;
  role: UserRole;
}): Promise<UserRecord> {
  const auth = getAdminAuth();
  const email = params.email.trim().toLowerCase();
  let userRecord: UserRecord;

  try {
    userRecord = await auth.getUserByEmail(email);
    const existing = (userRecord.customClaims || {}) as AuthClaims;
    if (existing.tenantId && existing.tenantId !== params.tenantId) {
      throw new Error('This email already belongs to another workspace');
    }
  } catch (error: any) {
    if (error?.code === 'auth/user-not-found') {
      userRecord = await auth.createUser({
        email,
        password: params.password || randomBytes(18).toString('base64url') + 'aA1!',
        displayName: params.displayName || email.split('@')[0],
        emailVerified: false,
      });
    } else {
      throw error;
    }
  }

  await setTenantUserClaims(userRecord.uid, {
    tenantId: params.tenantId,
    role: params.role,
    platformAdmin: params.role === 'platformAdmin',
  });

  return userRecord;
}

/** Link the user opens to set their own password (used for invites). */
export async function createPasswordSetupLink(email: string, continueUrl?: string): Promise<string> {
  return getAdminAuth().generatePasswordResetLink(
    email,
    continueUrl ? { url: continueUrl } : undefined
  );
}

/** Force all existing sessions of a user to re-authenticate. */
export async function revokeUserSessions(uid: string): Promise<void> {
  await getAdminAuth().revokeRefreshTokens(uid);
}
