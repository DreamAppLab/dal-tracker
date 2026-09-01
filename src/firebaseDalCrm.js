import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const DAL_CRM_APP_NAME = 'dalCrmApp';

// DAL CRM Firebase project (fieldbase-prod-42be2).
// Required Vercel env vars:
//   REACT_APP_DALCRM_FIREBASE_API_KEY
//   REACT_APP_DALCRM_FIREBASE_AUTH_DOMAIN       (optional, has default)
//   REACT_APP_DALCRM_FIREBASE_PROJECT_ID        (optional, has default)
//   REACT_APP_DALCRM_FIREBASE_STORAGE_BUCKET    (optional, has default)
//   REACT_APP_DALCRM_FIREBASE_MESSAGING_SENDER_ID
//   REACT_APP_DALCRM_FIREBASE_APP_ID
const dalCrmConfig = {
  apiKey: process.env.REACT_APP_DALCRM_FIREBASE_API_KEY,
  authDomain:
    process.env.REACT_APP_DALCRM_FIREBASE_AUTH_DOMAIN ||
    'fieldbase-prod-42be2.firebaseapp.com',
  projectId:
    process.env.REACT_APP_DALCRM_FIREBASE_PROJECT_ID || 'fieldbase-prod-42be2',
  storageBucket:
    process.env.REACT_APP_DALCRM_FIREBASE_STORAGE_BUCKET ||
    'fieldbase-prod-42be2.firebasestorage.app',
  messagingSenderId: process.env.REACT_APP_DALCRM_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_DALCRM_FIREBASE_APP_ID,
};

function getDalCrmApp() {
  if (!dalCrmConfig.apiKey) return null;
  const existing = getApps().find((app) => app.name === DAL_CRM_APP_NAME);
  if (existing) return existing;
  return initializeApp(dalCrmConfig, DAL_CRM_APP_NAME);
}

const dalCrmApp = getDalCrmApp();
export const dalCrmDb = dalCrmApp ? getFirestore(dalCrmApp) : null;
export const dalCrmStorage = dalCrmApp ? getStorage(dalCrmApp) : null;
export const dalCrmConfigured = !!dalCrmApp;
