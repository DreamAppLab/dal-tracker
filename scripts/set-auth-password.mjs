/**
 * Sets password on an existing Firebase Auth user (e.g. Google-only account).
 * Usage: node scripts/set-auth-password.mjs <uid> <password>
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const [uid, password] = process.argv.slice(2);
if (!uid || !password) {
  console.error('Usage: node scripts/set-auth-password.mjs <uid> <password>');
  process.exit(1);
}

initializeApp({
  projectId: 'dal-mission-control',
  credential: applicationDefault(),
});
await getAuth().updateUser(uid, { password });
console.log(`Password set for UID: ${uid}`);
