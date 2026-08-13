// Mission Control — quotes proxy for dal-website-c9dd8
// GET  /api/quotes          — all quotes, newest first
// GET  /api/quotes?id=xxx   — one quote
// POST /api/quotes?id=xxx   — merge-update one quote

const { initializeApp, getApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');

const TIMESTAMP_FIELDS = new Set([
  'createdAt',
  'acceptedAt',
  'thinkingAt',
  'questionsSentAt',
  'clientRepliedAt',
  'depositSentAt',
  'balanceSentAt',
  'inBuildAt',
  'completedAt',
  'dalDiscountAppliedAt',
  'sentAt',
]);

let _siteDb = null;

function getSiteDb() {
  if (_siteDb) return _siteDb;

  const projectId = process.env.DAL_SITE_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.DAL_SITE_FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.DAL_SITE_FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing DAL_SITE Firebase env vars');
  }

  const appName = 'dalSiteAdmin';
  let app;
  try {
    app = getApp(appName);
  } catch (_) {
    app = initializeApp(
      { credential: cert({ projectId, clientEmail, privateKey }) },
      appName
    );
  }

  _siteDb = getFirestore(app);
  return _siteDb;
}

function serializeValue(value) {
  if (value == null) return value;
  if (typeof value.toDate === 'function') {
    try {
      return value.toDate().toISOString();
    } catch (_) {
      return null;
    }
  }
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000).toISOString();
  }
  if (typeof value === 'object' && typeof value._seconds === 'number') {
    return new Date(value._seconds * 1000).toISOString();
  }
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach((key) => {
      out[key] = serializeValue(value[key]);
    });
    return out;
  }
  return value;
}

function serializeDoc(docSnap) {
  return { id: docSnap.id, ...serializeValue(docSnap.data() || {}) };
}

function createdAtMs(quote) {
  const raw = quote.createdAt;
  if (!raw) return 0;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function prepareUpdate(body) {
  const update = { ...(body || {}) };
  delete update.id;
  Object.keys(update).forEach((key) => {
    if (!TIMESTAMP_FIELDS.has(key)) return;
    const val = update[key];
    if (val === true || val === 'SERVER_TIMESTAMP') {
      update[key] = FieldValue.serverTimestamp();
      return;
    }
    if (typeof val === 'string' && val) {
      const d = new Date(val);
      if (!Number.isNaN(d.getTime())) {
        update[key] = Timestamp.fromDate(d);
      }
    }
  });
  return update;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const db = getSiteDb();
    const id = String((req.query && req.query.id) || '').trim();

    if (req.method === 'GET') {
      if (id) {
        const snap = await db.collection('quotes').doc(id).get();
        if (!snap.exists) return res.status(404).json({ error: 'Quote not found' });
        return res.status(200).json({ ok: true, quote: serializeDoc(snap) });
      }

      const snap = await db.collection('quotes').get();
      const quotes = snap.docs.map(serializeDoc).sort((a, b) => createdAtMs(b) - createdAtMs(a));
      return res.status(200).json({ ok: true, quotes });
    }

    if (req.method === 'POST') {
      if (!id) return res.status(400).json({ error: 'Quote id is required' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const update = prepareUpdate(body);
      if (!Object.keys(update).length) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      const ref = db.collection('quotes').doc(id);
      const existing = await ref.get();
      if (!existing.exists) return res.status(404).json({ error: 'Quote not found' });

      await ref.set(update, { merge: true });
      const updated = await ref.get();
      return res.status(200).json({ ok: true, quote: serializeDoc(updated) });
    }

    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'Quote id is required' });
      const ref = db.collection('quotes').doc(id);
      const existing = await ref.get();
      if (!existing.exists) return res.status(404).json({ error: 'Quote not found' });
      await ref.delete();
      return res.status(200).json({ ok: true, id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('quotes api error', e);
    return res.status(500).json({
      error: 'Quotes request failed',
      detail: String((e && e.message) || e),
    });
  }
};
