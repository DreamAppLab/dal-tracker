// Shared Firebase Admin app for the dal-mission-control project.
// Credentials come only from server-side Vercel env vars (never REACT_APP_*):
//   DAL_MC_FIREBASE_PROJECT_ID, DAL_MC_FIREBASE_CLIENT_EMAIL, DAL_MC_FIREBASE_PRIVATE_KEY
//   DAL_MC_FIREBASE_STORAGE_BUCKET (optional)

const { initializeApp, getApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getStorage } = require('firebase-admin/storage');

const APP_NAME = 'dalMissionControl';
let testOverrides = null;

function getMcApp() {
  try {
    return getApp(APP_NAME);
  } catch (_) {
    // not initialised yet
  }
  const projectId = process.env.DAL_MC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.DAL_MC_FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.DAL_MC_FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing DAL_MC_FIREBASE_* server env vars');
  }
  const storageBucket =
    process.env.DAL_MC_FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`;
  return initializeApp(
    { credential: cert({ projectId, clientEmail, privateKey }), storageBucket },
    APP_NAME
  );
}

function getMcDb() {
  if (testOverrides && testOverrides.db) return testOverrides.db;
  return getFirestore(getMcApp());
}

function getMcAuth() {
  if (testOverrides && testOverrides.auth) return testOverrides.auth;
  return getAuth(getMcApp());
}

function getMcBucket() {
  if (testOverrides && testOverrides.bucket) return testOverrides.bucket;
  return getStorage(getMcApp()).bucket();
}

// Test seam: lets unit tests inject fake db/auth without real credentials.
function __setTestOverrides(overrides) {
  testOverrides = overrides;
}

module.exports = { getMcApp, getMcDb, getMcAuth, getMcBucket, __setTestOverrides };
