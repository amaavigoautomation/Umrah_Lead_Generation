import { initializeApp, getApps, cert, applicationDefault, App } from 'firebase-admin/app';
import { getAuth, Auth, UserRecord } from 'firebase-admin/auth';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
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

export function getAdminFirestore(): Firestore {
  const app = getFirebaseAdminApp();
  const dbId = process.env.FIRESTORE_DATABASE_ID || rawConfig.firestoreDatabaseId;
  if (dbId && dbId !== '(default)') {
    try {
      return (getFirestore as any)(app, dbId);
    } catch {
      return getFirestore(app);
    }
  }
  return getFirestore(app);
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
 * Creates or updates a user in Firebase Auth and assigns claims
 */
export async function createTenantUser(params: {
  email: string;
  password?: string;
  displayName?: string;
  tenantId: string;
  role: UserRole;
}): Promise<UserRecord> {
  const auth = getAdminAuth();
  let userRecord: UserRecord;

  try {
    userRecord = await auth.getUserByEmail(params.email);
    if (params.password) {
      userRecord = await auth.updateUser(userRecord.uid, {
        password: params.password,
        displayName: params.displayName || userRecord.displayName,
      });
    }
  } catch (error: any) {
    if (error.code === 'auth/user-not-found') {
      userRecord = await auth.createUser({
        email: params.email,
        password: params.password || Math.random().toString(36).substring(2, 14) + '!A9',
        displayName: params.displayName || params.email.split('@')[0],
        emailVerified: true,
      });
    } else {
      throw error;
    }
  }

  // Assign claims
  await setTenantUserClaims(userRecord.uid, {
    tenantId: params.tenantId,
    role: params.role,
    platformAdmin: params.role === 'platformAdmin',
  });

  return userRecord;
}
