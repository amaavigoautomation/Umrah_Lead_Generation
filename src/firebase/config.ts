import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, Firestore, doc, getDocFromServer } from 'firebase/firestore';
import { getAuth, Auth } from 'firebase/auth';

// Project gen-lang-client-0376069258 is the provisioned Firestore host for database ai-studio-379c884e-3360-468a-ad55-8105acbd3214
const firestoreProjectConfig = {
  projectId: "gen-lang-client-0376069258",
  appId: "1:280237761588:web:1e0633ce031a5a49f15661",
  apiKey: "AIzaSyAcr6lIIH50XWD7CcmclWh9lxbPKO7TzBk",
  authDomain: "gen-lang-client-0376069258.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-379c884e-3360-468a-ad55-8105acbd3214",
  storageBucket: "gen-lang-client-0376069258.firebasestorage.app",
  messagingSenderId: "280237761588",
};

// Safely detect environment variables in both Vite browser client and Node serverless functions
const envProjectId =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_FIREBASE_PROJECT_ID) ||
  (typeof process !== 'undefined' && process.env?.VITE_FIREBASE_PROJECT_ID) ||
  (typeof process !== 'undefined' && process.env?.FIREBASE_PROJECT_ID);

const envApiKey =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_FIREBASE_API_KEY) ||
  (typeof process !== 'undefined' && process.env?.VITE_FIREBASE_API_KEY) ||
  (typeof process !== 'undefined' && process.env?.FIREBASE_API_KEY);

const activeProjectId = envProjectId || firestoreProjectConfig.projectId;
const activeApiKey = envApiKey || firestoreProjectConfig.apiKey;

export const firebaseConfig = {
  apiKey: activeApiKey,
  authDomain: firestoreProjectConfig.authDomain,
  projectId: activeProjectId,
  storageBucket: firestoreProjectConfig.storageBucket,
  messagingSenderId: firestoreProjectConfig.messagingSenderId,
  appId: firestoreProjectConfig.appId,
  firestoreDatabaseId: firestoreProjectConfig.firestoreDatabaseId,
};

// Initialize Firebase App singleton for Firestore & Authentication (gen-lang-client-0376069258)
export const app = getApps().find((a) => a.name === '[DEFAULT]') || initializeApp(firebaseConfig);

// Initialize Firestore with specific database ID
export const db: Firestore = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

// Auth configuration uses the provisioned project (gen-lang-client-0376069258)
export const auth: Auth = getAuth(app);

export const isFirebaseConfigured = Boolean(firebaseConfig.projectId && firebaseConfig.apiKey);

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


