// Basic fixed-window rate limiting.
//  - In-memory per function instance for every endpoint (cheap, catches bursts).
//  - "durable" mode additionally counts in Firestore (rateLimits collection,
//    server-only) so public endpoints stay limited across serverless instances.
// Keys are hashed so raw IP addresses are never stored.

const crypto = require('crypto');

const memory = new Map();
const MAX_KEYS = 5000;

function hashKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 40);
}

function memoryHit(key, limit, windowMs, now) {
  let entry = memory.get(key);
  if (!entry || now - entry.start >= windowMs) {
    entry = { start: now, count: 0 };
    if (memory.size >= MAX_KEYS) memory.delete(memory.keys().next().value);
  }
  entry.count += 1;
  memory.set(key, entry);
  return { allowed: entry.count <= limit, retryAfterMs: Math.max(0, entry.start + windowMs - now) };
}

async function durableHit(key, limit, windowMs, now) {
  // Lazy require so unit tests of non-durable paths need no Firestore.
  const { getMcDb } = require('./firebaseAdmin');
  const db = getMcDb();
  const ref = db.collection('rateLimits').doc(key);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    let start = data && typeof data.start === 'number' ? data.start : now;
    let count = data && typeof data.count === 'number' ? data.count : 0;
    if (now - start >= windowMs) {
      start = now;
      count = 0;
    }
    count += 1;
    tx.set(ref, { start, count, expiresAt: new Date(start + windowMs * 2) });
    return { allowed: count <= limit, retryAfterMs: Math.max(0, start + windowMs - now) };
  });
}

async function checkRateLimit({ key, limit, windowMs, durable = false }) {
  const now = Date.now();
  const hashed = hashKey(key);
  const mem = memoryHit(hashed, limit, windowMs, now);
  if (!mem.allowed) return mem;
  if (!durable) return mem;
  try {
    return await durableHit(hashed, limit, windowMs, now);
  } catch (e) {
    // Never fail open silently on a public endpoint: fall back to memory result
    // (already counted) but log so a misconfiguration is visible.
    console.warn('[rateLimit] durable store unavailable:', e && e.message);
    return mem;
  }
}

function __resetMemory() {
  memory.clear();
}

module.exports = { checkRateLimit, hashKey, __resetMemory };
