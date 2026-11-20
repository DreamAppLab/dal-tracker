// Append-only audit trail. Written ONLY by server functions (Admin SDK);
// Firestore rules deny all client writes to auditLog and allow reads only to
// the admin allowlist.
//
// Never put secrets, plaintext vault values, tokens or full card/account
// numbers into an audit entry — record WHAT happened and to WHICH record.

const { FieldValue } = require('firebase-admin/firestore');
const { getMcDb } = require('./firebaseAdmin');

const AUDIT_TYPES = Object.freeze([
  'sign_in',
  'vault_reveal',
  'vault_copy',
  'sensitive_create',
  'sensitive_update',
  'sensitive_delete',
  'import',
  'delete',
  'access_denied',
]);

function clientIp(req) {
  const xff = String((req && req.headers && req.headers['x-forwarded-for']) || '');
  return (xff.split(',')[0] || '').trim() || String((req && req.headers && req.headers['x-real-ip']) || '') || null;
}

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (/secret|token|password|plaintext|cipher|routingNumber|accountNumber|cardNumber|^ein$|^pin$|cvv/i.test(k)) continue;
    if (v === undefined) continue;
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) {
      out[k] = typeof v === 'string' ? v.slice(0, 500) : v;
    } else if (Array.isArray(v)) {
      out[k] = v.slice(0, 50).map((x) => (typeof x === 'string' ? x.slice(0, 200) : x));
    }
  }
  return out;
}

/**
 * @param {object} entry
 * @param {string} entry.type      one of AUDIT_TYPES
 * @param {object} [entry.actor]   decoded token ({uid,email}) or null for system
 * @param {string} [entry.target]  e.g. "companies/dal/bankAccounts/abc"
 * @param {object} [entry.meta]    small, non-sensitive context
 * @param {object} [req]           request (for ip/user agent)
 */
async function writeAudit(entry, req) {
  if (!entry || !AUDIT_TYPES.includes(entry.type)) {
    throw new Error(`Unknown audit type: ${entry && entry.type}`);
  }
  const actor = entry.actor || null;
  const doc = {
    type: entry.type,
    actorUid: actor ? actor.uid || actor.sub || null : null,
    actorEmail: actor ? actor.email || null : null,
    target: entry.target ? String(entry.target).slice(0, 300) : null,
    meta: sanitizeMeta(entry.meta),
    ip: clientIp(req),
    userAgent: req && req.headers ? String(req.headers['user-agent'] || '').slice(0, 300) : null,
    at: FieldValue.serverTimestamp(),
  };
  await getMcDb().collection('auditLog').add(doc);
  return doc;
}

/**
 * For audits recorded AFTER an action has already happened (e.g. a delete):
 * a failed audit write is logged loudly but must not turn a completed action
 * into an error response. Use writeAudit() (strict) when the audit must
 * succeed BEFORE the action, e.g. before returning a decrypted vault value.
 */
async function writeAuditSafe(entry, req) {
  try {
    return await writeAudit(entry, req);
  } catch (e) {
    console.error('[audit] FAILED to record', entry && entry.type, entry && entry.target, '-', e && e.message);
    return null;
  }
}

module.exports = { writeAudit, writeAuditSafe, AUDIT_TYPES, clientIp, sanitizeMeta };
