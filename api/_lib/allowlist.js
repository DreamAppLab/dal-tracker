// Mission Control admin allowlist — the ONLY accounts that may use the app,
// its API functions and its Firestore/Storage data.
//
// Access requires BOTH:
//   1. a Firebase ID token whose email is VERIFIED (email_verified == true), and
//   2. that email (lower-cased) in ADMIN_EMAILS, or the token's uid in ADMIN_UIDS.
//
// KEEP IN SYNC with firestore.rules and storage.rules (isAdmin()).
// tests/security/allowlist-sync.test.js fails the build if they drift.

const ADMIN_EMAILS = Object.freeze(['lab@dreamapplab.com']);

// Optional extra pinning by Firebase uid (still requires a verified email).
const ADMIN_UIDS = Object.freeze([]);

function isAdminClaims(claims) {
  if (!claims || typeof claims !== 'object') return false;
  if (claims.email_verified !== true) return false;
  const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
  const uid = typeof claims.uid === 'string' ? claims.uid : claims.sub;
  return ADMIN_EMAILS.includes(email) || (typeof uid === 'string' && ADMIN_UIDS.includes(uid));
}

module.exports = { ADMIN_EMAILS, ADMIN_UIDS, isAdminClaims };
