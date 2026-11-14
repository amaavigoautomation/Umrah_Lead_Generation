import { initializeApp, getApps } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import rawFirebaseConfig from './appletConfig.js';

// Safely detect environment variables in both Vite browser client and Node serverless functions
const envProjectId =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_FIREBASE_PROJECT_ID) ||
  (typeof process !== 'undefined' && process.env?.VITE_FIREBASE_PROJECT_ID) ||
  (typeof process !== 'undefined' && process.env?.FIREBASE_PROJECT_ID);

const envApiKey =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_FIREBASE_API_KEY) ||
  (typeof process !== 'undefined' && process.env?.VITE_FIREBASE_API_KEY) ||
  (typeof process !== 'undefined' && process.env?.FIREBASE_API_KEY);

const envAuthDomain =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_FIREBASE_AUTH_DOMAIN) ||
  (typeof process !== 'undefined' && process.env?.VITE_FIREBASE_AUTH_DOMAIN);

const envStorageBucket =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_FIREBASE_STORAGE_BUCKET) ||
  (typeof process !== 'undefined' && process.env?.VITE_FIREBASE_STORAGE_BUCKET);

const envMessagingSenderId =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_FIREBASE_MESSAGING_SENDER_ID) ||
  (typeof process !== 'undefined' && process.env?.VITE_FIREBASE_MESSAGING_SENDER_ID);

const envAppId =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_FIREBASE_APP_ID) ||
  (typeof process !== 'undefined' && process.env?.VITE_FIREBASE_APP_ID);

const envDatabaseId =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_FIRESTORE_DATABASE_ID) ||
  (typeof process !== 'undefined' && process.env?.VITE_FIRESTORE_DATABASE_ID) ||
  (typeof process !== 'undefined' && process.env?.FIRESTORE_DATABASE_ID);

const resolvedProjectId: string = envProjectId || rawFirebaseConfig.projectId;

const usingOtherProject = resolvedProjectId !== rawFirebaseConfig.projectId;

export const firebaseConfig = {
  ...rawFirebaseConfig,
  projectId: resolvedProjectId,
  apiKey: envApiKey || (usingOtherProject ? '' : rawFirebaseConfig.apiKey),
  authDomain: envAuthDomain || (usingOtherProject ? `${resolvedProjectId}.firebaseapp.com` : rawFirebaseConfig.authDomain),
  storageBucket: envStorageBucket || (usingOtherProject ? `${resolvedProjectId}.firebasestorage.app` : rawFirebaseConfig.storageBucket),
  messagingSenderId: envMessagingSenderId || (usingOtherProject ? '' : rawFirebaseConfig.messagingSenderId),
  appId: envAppId || (usingOtherProject ? '' : rawFirebaseConfig.appId),
  firestoreDatabaseId: envDatabaseId || (usingOtherProject ? '(default)' : rawFirebaseConfig.firestoreDatabaseId),
};

const webApiKeyMissing = !firebaseConfig.apiKey;
if (webApiKeyMissing && typeof console !== 'undefined') {
  console.error(
    `[Firebase] VITE_FIREBASE_API_KEY is missing for project "${firebaseConfig.projectId}". ` +
      'Set it (with the other VITE_FIREBASE_* values) in this environment and redeploy.'
  );
}

export const app =
  getApps().find((a) => a.name === '[DEFAULT]') ||
  initializeApp(webApiKeyMissing ? { ...firebaseConfig, apiKey: 'missing-web-api-key' } : firebaseConfig);

/**
 * Data access in the browser goes through the authenticated /api/db endpoint (MongoDB lives on the
 * server). Firebase is used only for sign-in. `db` is re-exported so existing imports keep working.
 */
export { db } from '../services/clientDb';

export const auth: Auth = getAuth(app);

export const isFirebaseConfigured = Boolean(firebaseConfig.projectId && (firebaseConfig.apiKey || typeof window === 'undefined'));
