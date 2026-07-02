/**
 * Generates a Firebase auth import file with bcrypt password hash for an existing user.
 * Usage: node scripts/prepare-password-import.mjs <uid> <email> <password>
 */
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import bcrypt from 'bcryptjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const [uid, email, password] = process.argv.slice(2);

if (!uid || !email || !password) {
  console.error('Usage: node scripts/prepare-password-import.mjs <uid> <email> <password>');
  process.exit(1);
}

const hash = await bcrypt.hash(password, 10);
const passwordHash = Buffer.from(hash, 'utf8').toString('base64');

const payload = {
  users: [
    {
      localId: uid,
      email,
      emailVerified: true,
      displayName: 'Eddie Skehan',
      passwordHash,
    },
  ],
};

const outPath = join(__dirname, 'password-import.json');
writeFileSync(outPath, JSON.stringify(payload, null, 2));
console.log(`Wrote ${outPath}`);
