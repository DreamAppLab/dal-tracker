import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const ZERBIQ_APP_NAME = 'zerbiqApp';

// Zerbiq Firebase project (fieldbase-prod-42be2).
// Required Vercel env vars:
//   REACT_APP_ZERBIQ_FIREBASE_API_KEY
//   REACT_APP_ZERBIQ_FIREBASE_AUTH_DOMAIN       (optional, has default)
//   REACT_APP_ZERBIQ_FIREBASE_PROJECT_ID        (optional, has default)
//   REACT_APP_ZERBIQ_FIREBASE_STORAGE_BUCKET    (optional, has default)
//   REACT_APP_ZERBIQ_FIREBASE_MESSAGING_SENDER_ID
//   REACT_APP_ZERBIQ_FIREBASE_APP_ID
const zerbiqConfig = {
  apiKey: process.env.REACT_APP_ZERBIQ_FIREBASE_API_KEY,
  authDomain:
    process.env.REACT_APP_ZERBIQ_FIREBASE_AUTH_DOMAIN ||
    'fieldbase-prod-42be2.firebaseapp.com',
  projectId:
    process.env.REACT_APP_ZERBIQ_FIREBASE_PROJECT_ID || 'fieldbase-prod-42be2',
  storageBucket:
    process.env.REACT_APP_ZERBIQ_FIREBASE_STORAGE_BUCKET ||
    'fieldbase-prod-42be2.firebasestorage.app',
  messagingSenderId: process.env.REACT_APP_ZERBIQ_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_ZERBIQ_FIREBASE_APP_ID,
};

function getZerbiqApp() {
  if (!zerbiqConfig.apiKey) return null;
  const existing = getApps().find((app) => app.name === ZERBIQ_APP_NAME);
  if (existing) return existing;
  return initializeApp(zerbiqConfig, ZERBIQ_APP_NAME);
}

const zerbiqApp = getZerbiqApp();
export const zerbiqDb = zerbiqApp ? getFirestore(zerbiqApp) : null;
export const zerbiqStorage = zerbiqApp ? getStorage(zerbiqApp) : null;
export const zerbiqConfigured = !!zerbiqApp;
