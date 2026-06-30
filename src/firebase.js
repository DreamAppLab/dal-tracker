import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
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
export const auth = getAuth(app);
export const storage = getStorage(app);
