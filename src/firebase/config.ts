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

const configSource = firebaseConfigJson || fallbackConfig;

export const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || configSource.apiKey || fallbackConfig.apiKey,
  authDomain: configSource.authDomain || fallbackConfig.authDomain,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || configSource.projectId || fallbackConfig.projectId,
  storageBucket: configSource.storageBucket || fallbackConfig.storageBucket,
  messagingSenderId: configSource.messagingSenderId || fallbackConfig.messagingSenderId,
  appId: configSource.appId || fallbackConfig.appId,
  firestoreDatabaseId: configSource.firestoreDatabaseId || fallbackConfig.firestoreDatabaseId,
};

// Initialize Firebase App singleton
export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Initialize Firestore with specific database ID if provided
export const db: Firestore = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

// Initialize Auth
export const auth: Auth = getAuth(app);

export const isFirebaseConfigured = Boolean(firebaseConfig.projectId && firebaseConfig.apiKey);

// Validate connection per skill guideline
async function testFirestoreConnection() {
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
