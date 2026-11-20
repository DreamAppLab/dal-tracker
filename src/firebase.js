import { initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import {
  connectAuthEmulator,
  getAuth,
  browserLocalPersistence,
  setPersistence,
} from 'firebase/auth';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyDHnKVFCK4HAZrClbRb5ZDGEpoOrorMyRc",
  authDomain: "dal-mission-control.firebaseapp.com",
  projectId: "dal-mission-control",
  storageBucket: "dal-mission-control.firebasestorage.app",
  messagingSenderId: "665542362807",
  appId: "1:665542362807:web:eed270233b172eaa84ef32"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
const _auth = getAuth(app);
setPersistence(_auth, browserLocalPersistence).catch(console.error);
// Local development only: on `npm start` (never in a production build, where
// NODE_ENV is 'production' and this block is compiled away), set
// localStorage['mc.emulators'] = '1' on localhost to use the Firestore/Auth
// emulators from firebase.json instead of the real project.
if (
  process.env.NODE_ENV === 'development'
  && typeof window !== 'undefined'
  && window.location.hostname === 'localhost'
  && window.localStorage.getItem('mc.emulators') === '1'
) {
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectAuthEmulator(_auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}
export const auth = _auth;
export const calendarAuth = getAuth(
  initializeApp(firebaseConfig, 'google-calendar-oauth')
);
