import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, Firestore, doc, getDocFromServer } from 'firebase/firestore';
import { getAuth, Auth } from 'firebase/auth';
import rawFirebaseConfig from '../../firebase-applet-config.json';

// Safely detect environment variables in both Vite browser client and Node serverless functions
const envProjectId =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_FIREBASE_PROJECT_ID) ||
  (typeof process !== 'undefined' && process.env?.VITE_FIREBASE_PROJECT_ID) ||
  (typeof process !== 'undefined' && process.env?.FIREBASE_PROJECT_ID);

const envApiKey =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_FIREBASE_API_KEY) ||
  (typeof process !== 'undefined' && process.env?.VITE_FIREBASE_API_KEY) ||
  (typeof process !== 'undefined' && process.env?.FIREBASE_API_KEY);

// The remaining settings can also come from the environment, so ONE codebase can run against different
// Firebase projects (for example: production on the main database, a test deployment on another one).
// Each name is written out literally because Vite only replaces literal `import.meta.env.VITE_*` references.
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

// Browser builds read VITE_FIRESTORE_DATABASE_ID; the server also accepts its own FIRESTORE_DATABASE_ID.
const envDatabaseId =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_FIRESTORE_DATABASE_ID) ||
  (typeof process !== 'undefined' && process.env?.VITE_FIRESTORE_DATABASE_ID) ||
  (typeof process !== 'undefined' && process.env?.FIRESTORE_DATABASE_ID);

const resolvedProjectId: string = envProjectId || rawFirebaseConfig.projectId;

// True when the environment selects a project OTHER than the one in firebase-applet-config.json.
// In that case the file's project-specific values (API key, auth domain, database name...) belong to a
// different project and must never be borrowed: use the environment value or a safe default instead.
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

// Another project was selected but its web API key was not provided. The browser cannot sign anyone in
// without it, so say exactly what is missing instead of failing later with a cryptic auth error.
const webApiKeyMissing = !firebaseConfig.apiKey;
if (webApiKeyMissing && typeof console !== 'undefined') {
  console.error(
    `[Firebase] VITE_FIREBASE_API_KEY is missing for project "${firebaseConfig.projectId}". ` +
      'Set it (with the other VITE_FIREBASE_* values) in this environment and redeploy.'
  );
}

// Initialize Firebase App singleton for Firestore & Authentication.
// (A placeholder key keeps start-up from crashing; the server does not use the web key at all.)
export const app =
  getApps().find((a) => a.name === '[DEFAULT]') ||
  initializeApp(webApiKeyMissing ? { ...firebaseConfig, apiKey: 'missing-web-api-key' } : firebaseConfig);

// Initialize Firestore with specific database ID
export const db: Firestore = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

// Auth for the project selected above.
export const auth: Auth = getAuth(app);

// The server talks to Firebase with the service account, so only the browser needs the web API key.
export const isFirebaseConfigured = Boolean(firebaseConfig.projectId && (firebaseConfig.apiKey || typeof window === 'undefined'));

// Validate connection per skill guideline (browser client only; skip during Node SSR/build)
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


