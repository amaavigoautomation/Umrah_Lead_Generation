import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, Firestore, doc, getDocFromServer } from 'firebase/firestore';
import { getAuth, Auth } from 'firebase/auth';
import firebaseConfigJson from '../../firebase-applet-config.json';

const fallbackConfig = {
  projectId: "gen-lang-client-0376069258",
  appId: "1:280237761588:web:1e0633ce031a5a49f15661",
  apiKey: "AIzaSyAcr6lIIH50XWD7CcmclWh9lxbPKO7TzBk",
  authDomain: "gen-lang-client-0376069258.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-379c884e-3360-468a-ad55-8105acbd3214",
  storageBucket: "gen-lang-client-0376069258.firebasestorage.app",
  messagingSenderId: "280237761588",
};

// If firebase-applet-config.json points to another project without Firestore enabled (e.g. dedicated OAuth project),
// use the provisioned Firestore database project to ensure Firestore operations succeed.
const activeProjectId =
  process.env.VITE_FIREBASE_PROJECT_ID ||
  process.env.FIREBASE_PROJECT_ID ||
  ((firebaseConfigJson as any)?.projectId === fallbackConfig.projectId
    ? (firebaseConfigJson as any).projectId
    : fallbackConfig.projectId);

const activeApiKey =
  process.env.VITE_FIREBASE_API_KEY ||
  process.env.FIREBASE_API_KEY ||
  ((firebaseConfigJson as any)?.projectId === fallbackConfig.projectId
    ? (firebaseConfigJson as any).apiKey
    : fallbackConfig.apiKey);

export const firebaseConfig = {
  apiKey: activeApiKey,
  authDomain: (firebaseConfigJson as any)?.authDomain || fallbackConfig.authDomain,
  projectId: activeProjectId,
  storageBucket: (firebaseConfigJson as any)?.storageBucket || fallbackConfig.storageBucket,
  messagingSenderId: (firebaseConfigJson as any)?.messagingSenderId || fallbackConfig.messagingSenderId,
  appId: (firebaseConfigJson as any)?.appId || fallbackConfig.appId,
  firestoreDatabaseId: (firebaseConfigJson as any)?.firestoreDatabaseId || fallbackConfig.firestoreDatabaseId,
};

// Initialize Firebase App singleton for Firestore
export const app = getApps().find((a) => a.name === '[DEFAULT]') || initializeApp(firebaseConfig);

// Initialize Firestore with specific database ID if provided
export const db: Firestore = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

// Auth configuration uses OAuth project credentials from firebase-applet-config.json
const oauthProjectConfig = {
  apiKey: (firebaseConfigJson as any)?.apiKey || activeApiKey,
  authDomain: (firebaseConfigJson as any)?.authDomain || "gen-lang-client-0295687148.firebaseapp.com",
  projectId: (firebaseConfigJson as any)?.projectId || "gen-lang-client-0295687148",
  appId: (firebaseConfigJson as any)?.appId || "1:27669323758:web:ca139ff1b786c339b1b8ff",
};

export const authApp =
  oauthProjectConfig.projectId === firebaseConfig.projectId
    ? app
    : (getApps().find((a) => a.name === 'authApp') || initializeApp(oauthProjectConfig, 'authApp'));

// Initialize Auth with the OAuth-enabled app
export const auth: Auth = getAuth(authApp);

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
