// Verifies that a POST really came from Mailgun (inbound routes + webhooks).
// Mailgun signs every request: HMAC-SHA256(signingKey, timestamp + token) == signature.
//
// The signing key comes from MAILGUN_WEBHOOK_SIGNING_KEY if set; otherwise it
// is fetched once per instance from Mailgun's API using MAILGUN_API_KEY
// (GET /v5/accounts/http_signing_key). Verification fails CLOSED.

const crypto = require('crypto');

const MAX_SKEW_SECONDS = 15 * 60;
const seenTokens = new Map(); // replay protection within an instance
let cachedKey = null;

async function getSigningKey() {
  if (process.env.MAILGUN_WEBHOOK_SIGNING_KEY) return process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
  if (cachedKey) return cachedKey;
  const apiKey = process.env.MAILGUN_API_KEY;
  if (!apiKey) return null;
  try {
    const r = await fetch('https://api.mailgun.net/v5/accounts/http_signing_key', {
      headers: { Authorization: 'Basic ' + Buffer.from('api:' + apiKey).toString('base64') },
    });
    if (!r.ok) {
      console.error('[mailgunWebhook] could not fetch signing key:', r.status);
      return null;
    }
    const data = await r.json();
    cachedKey = data && typeof data.http_signing_key === 'string' ? data.http_signing_key : null;
    return cachedKey;
  } catch (e) {
    console.error('[mailgunWebhook] signing key fetch failed:', e && e.message);
    return null;
  }
}

function pick(body, name) {
  if (!body) return '';
  if (body.signature && typeof body.signature === 'object' && body.signature[name]) {
    return String(body.signature[name]);
  }
  const v = body[name];
  return Array.isArray(v) ? String(v[0] || '') : String(v || '');
}

function computeSignature(key, timestamp, token) {
  return crypto.createHmac('sha256', key).update(String(timestamp) + String(token)).digest('hex');
}

// recordToken:false lets a caller record the token only after it succeeds
// (commitMailgunToken), so a failed request can be retried by Mailgun.
// maxSkewSeconds: widen for idempotent handlers whose retries reuse the signature.
async function verifyMailgunRequest(body, { now = Date.now(), keyOverride, recordToken = true, maxSkewSeconds = MAX_SKEW_SECONDS } = {}) {
  const timestamp = pick(body, 'timestamp');
  const token = pick(body, 'token');
  const signature = pick(body, 'signature');
  if (!timestamp || !token || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const ts = Number(timestamp);
  // Past: up to maxSkewSeconds (Mailgun retries). Future: only normal clock skew.
  if (!Number.isFinite(ts) || now / 1000 - ts > maxSkewSeconds || ts - now / 1000 > MAX_SKEW_SECONDS) return false;
  const key = keyOverride || (await getSigningKey());
  if (!key) return false;
  const expected = computeSignature(key, timestamp, token);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature.toLowerCase(), 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  if (seenTokens.has(token)) return false;
  if (recordToken) commitMailgunToken(body, now);
  return true;
}

function commitMailgunToken(body, now = Date.now()) {
  const token = pick(body, 'token');
  if (!token) return;
  seenTokens.set(token, now);
  if (seenTokens.size > 2000) seenTokens.delete(seenTokens.keys().next().value);
}

module.exports = { verifyMailgunRequest, commitMailgunToken, computeSignature };
