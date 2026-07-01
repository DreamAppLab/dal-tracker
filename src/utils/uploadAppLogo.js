import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, setDoc } from 'firebase/firestore';
import { storage, db } from '../firebase';

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml'];
const ACCEPTED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'svg'];
const UPLOAD_TIMEOUT_MS = 45000;

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

function withTimeout(promise, ms, stepLabel) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${stepLabel} timed out after ${Math.round(ms / 1000)}s. Check your connection and Firebase Storage rules.`));
      }, ms);
    }),
  ]);
}

function cacheBustUrl(url) {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${Date.now()}`;
}

export async function uploadAppLogo(appId, file) {
  if (!appId) {
    throw new Error('Missing app ID for logo upload.');
  }
  if (!isValidLogoFile(file)) {
    throw new Error('Please upload a PNG, JPG, or SVG file.');
  }

  const storagePath = `appLogos/${appId}/logo`;
  const storageRef = ref(storage, storagePath);

  try {
    await withTimeout(
      uploadBytes(storageRef, file, { contentType: resolveContentType(file) }),
      UPLOAD_TIMEOUT_MS,
      'Storage upload'
    );
  } catch (err) {
    const code = err?.code ? ` (${err.code})` : '';
    throw new Error(`Storage upload failed${code}: ${err.message || 'Unknown error'}`);
  }

  let downloadUrl;
  try {
    downloadUrl = await withTimeout(getDownloadURL(storageRef), 15000, 'Fetching download URL');
  } catch (err) {
    const code = err?.code ? ` (${err.code})` : '';
    throw new Error(`Could not get logo URL${code}: ${err.message || 'Unknown error'}`);
  }

  const logoUrl = cacheBustUrl(downloadUrl);

  try {
    await withTimeout(
      setDoc(doc(db, 'revenue', appId), { logoUrl }, { merge: true }),
      15000,
      'Saving logo URL to Firestore'
    );
  } catch (err) {
    const code = err?.code ? ` (${err.code})` : '';
    throw new Error(`Firestore save failed${code}: ${err.message || 'Unknown error'}`);
  }

  return logoUrl;
}
