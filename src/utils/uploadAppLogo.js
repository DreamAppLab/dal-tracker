import { signInAnonymously } from 'firebase/auth';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, setDoc } from 'firebase/firestore';
import { auth, storage, db } from '../firebase';

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml'];
const ACCEPTED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'svg'];

export function isValidLogoFile(file) {
  if (!file) return false;
  if (ACCEPTED_TYPES.includes(file.type)) return true;
  const ext = file.name.split('.').pop()?.toLowerCase();
  return ACCEPTED_EXTENSIONS.includes(ext);
}

function resolveContentType(file) {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return 'image/png';
}

async function ensureAuth() {
  if (auth.currentUser) return;
  try {
    await signInAnonymously(auth);
  } catch (err) {
    console.warn('Anonymous auth unavailable, attempting upload without auth:', err.message);
  }
}

export async function uploadAppLogo(appId, file) {
  if (!isValidLogoFile(file)) {
    throw new Error('Please upload a PNG, JPG, or SVG file.');
  }

  await ensureAuth();

  const storageRef = ref(storage, `appLogos/${appId}/logo`);
  await uploadBytes(storageRef, file, { contentType: resolveContentType(file) });
  const logoUrl = await getDownloadURL(storageRef);

  await setDoc(doc(db, 'revenue', appId), { logoUrl }, { merge: true });

  return logoUrl;
}
