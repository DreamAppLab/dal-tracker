import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const FT_APP_NAME = 'familythread';

const familyThreadConfig = {
  apiKey: process.env.REACT_APP_FT_API_KEY,
  authDomain: process.env.REACT_APP_FT_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FT_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FT_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FT_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FT_APP_ID,
};

function getMissingConfigKeys() {
  return Object.entries(familyThreadConfig)
    .filter(([, value]) => !value)
    .map(([key]) => key);
}

function getFamilyThreadApp() {
  const missing = getMissingConfigKeys();
  if (missing.length > 0) {
    throw new Error(
      `Missing FamilyThread Firebase config: ${missing.join(', ')}. ` +
        'Set REACT_APP_FT_* environment variables and restart the dev server.'
    );
  }

  const existing = getApps().find((app) => app.name === FT_APP_NAME);
  if (existing) return existing;
  return initializeApp(familyThreadConfig, FT_APP_NAME);
}

const missingKeys = getMissingConfigKeys();

export const familyThreadConfigError =
  missingKeys.length > 0
    ? `FamilyThread Firebase is not configured (missing ${missingKeys.join(', ')}). Add REACT_APP_FT_* env vars and restart.`
    : null;

export const familyThreadDb = familyThreadConfigError
  ? null
  : getFirestore(getFamilyThreadApp());
