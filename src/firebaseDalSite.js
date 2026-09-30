import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const DAL_SITE_APP_NAME = 'dalSiteApp';

// Public web config (same values already in dal-site admin pages).
// Vercel REACT_APP_DAL_SITE_FIREBASE_* env vars override these when set.
const dalSiteConfig = {
  apiKey:
    process.env.REACT_APP_DAL_SITE_FIREBASE_API_KEY ||
    'AIzaSyDT0t0CaE1BkixpCJybEP9eMeOvR9nSL2g',
  authDomain:
    process.env.REACT_APP_DAL_SITE_FIREBASE_AUTH_DOMAIN ||
    'dal-website-c9dd8.firebaseapp.com',
  projectId:
    process.env.REACT_APP_DAL_SITE_FIREBASE_PROJECT_ID || 'dal-website-c9dd8',
  storageBucket:
    process.env.REACT_APP_DAL_SITE_FIREBASE_STORAGE_BUCKET ||
    'dal-website-c9dd8.firebasestorage.app',
  messagingSenderId:
    process.env.REACT_APP_DAL_SITE_FIREBASE_MESSAGING_SENDER_ID || '839233272013',
  appId:
    process.env.REACT_APP_DAL_SITE_FIREBASE_APP_ID ||
    '1:839233272013:web:f92f1fda6241d24c8ad184',
};

function getDalSiteApp() {
  const existing = getApps().find((app) => app.name === DAL_SITE_APP_NAME);
  if (existing) return existing;
  return initializeApp(dalSiteConfig, DAL_SITE_APP_NAME);
}

export const dalSiteApp = getDalSiteApp();
export const dalSiteDb = getFirestore(dalSiteApp);
