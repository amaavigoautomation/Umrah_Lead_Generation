import { initializeApp, getApps } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  Firestore,
  doc,
  getDocFromServer,
} from 'firebase/firestore';
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

function createDb(): Firestore {
  const dbId = firebaseConfig.firestoreDatabaseId || undefined;
  const isBrowser = typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
  if (isBrowser) {
    try {
      const settings = { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) };
      return dbId ? initializeFirestore(app, settings, dbId) : initializeFirestore(app, settings);
    } catch (err) {
      console.warn('[Firebase] Local cache not enabled:', err);
    }
  }
  return dbId ? getFirestore(app, dbId) : getFirestore(app);
}
export const db: Firestore = createDb();

export const auth: Auth = getAuth(app);

export const isFirebaseConfigured = Boolean(firebaseConfig.projectId && (firebaseConfig.apiKey || typeof window === 'undefined'));

async function testFirestoreConnection() {
  if (typeof window === 'undefined') return;
  if (!isFirebaseConfigured || !db) return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase client is offline or connection not established.');
    }
  }
}
testFirestoreConnection();
