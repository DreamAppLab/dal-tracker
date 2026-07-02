/**
 * Creates the Mission Control auth user and updates security rules with their UID.
 * Usage: node scripts/create-auth-user.mjs <email> <password>
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const API_KEY = 'AIzaSyDHnKVFCK4HAZrClbRb5ZDGEpoOrorMyRc';
const [email, password] = process.argv.slice(2);

if (!email || !password) {
  console.error('Usage: node scripts/create-auth-user.mjs <email> <password>');
  process.exit(1);
}

const res = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  }
);

const data = await res.json();
if (!res.ok) {
  if (data.error?.message === 'EMAIL_EXISTS') {
    const signInRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      }
    );
    const signInData = await signInRes.json();
    if (!signInRes.ok) {
      console.error('Account exists but sign-in failed:', signInData.error?.message);
      process.exit(1);
    }
    data.localId = signInData.localId;
    console.log('Account already exists — retrieved UID via sign-in.');
  } else {
    console.error('Failed to create user:', data.error?.message);
    process.exit(1);
  }
}

const uid = data.localId;
console.log(`Authorized UID: ${uid}`);

for (const file of ['firestore.rules', 'storage.rules']) {
  const path = join(root, file);
  const content = readFileSync(path, 'utf8').replace(/PLACEHOLDER_UID/g, uid);
  writeFileSync(path, content);
  console.log(`Updated ${file}`);
}
