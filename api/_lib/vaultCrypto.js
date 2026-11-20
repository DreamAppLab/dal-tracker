// Company vault encryption — AES-256-GCM, server-side only.
//
// Key: VAULT_ENCRYPTION_KEY (Vercel env, production) = base64 of 32 random bytes.
// It is never sent to the browser and never logged.
//
// Ciphertext format:  v1.<keyId>.<iv b64url>.<tag b64url>.<ciphertext b64url>
// The record path + field name are bound in as AAD, so a ciphertext copied to
// another record or field fails to decrypt.

const crypto = require('crypto');

const VERSION = 'v1';
const KEY_ID = 'k1';

class VaultConfigError extends Error {}

function loadKey() {
  const raw = process.env.VAULT_ENCRYPTION_KEY || '';
  if (!raw) throw new VaultConfigError('VAULT_ENCRYPTION_KEY is not configured');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new VaultConfigError('VAULT_ENCRYPTION_KEY must be 32 bytes (base64)');
  return key;
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');

function aadFor(recordPath, field) {
  return Buffer.from(`dal-vault|${recordPath}|${field}`, 'utf8');
}

function encryptField(plaintext, recordPath, field) {
  if (typeof plaintext !== 'string' || !plaintext) throw new Error('Nothing to encrypt');
  const key = loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aadFor(recordPath, field));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, KEY_ID, b64u(iv), b64u(tag), b64u(ct)].join('.');
}

function decryptField(token, recordPath, field) {
  const parts = String(token || '').split('.');
  if (parts.length !== 5 || parts[0] !== VERSION) throw new Error('Unrecognised ciphertext');
  if (parts[1] !== KEY_ID) throw new Error('Unknown vault key id');
  const key = loadKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, fromB64u(parts[2]));
  decipher.setAAD(aadFor(recordPath, field));
  decipher.setAuthTag(fromB64u(parts[3]));
  return Buffer.concat([decipher.update(fromB64u(parts[4])), decipher.final()]).toString('utf8');
}

function isConfigured() {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

module.exports = { encryptField, decryptField, isConfigured, VaultConfigError };
