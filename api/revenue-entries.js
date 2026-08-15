// Mission Control — client project revenue entries
// GET    /api/revenue-entries           — list (query: from, to, type=deposit|balance|reversal)
// POST   /api/revenue-entries           — create
// DELETE /api/revenue-entries?id=xxx    — delete
// Uses the dal-mission-control service account (DAL_MC_FIREBASE_* env vars).
//
// Client project payments live on the revenue collection: typed documents at the
// top level, plus revenue/{appId}/manualSales entries written by Quotes / Build Board.

const { initializeApp, getApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const ENTRY_TYPES = ['deposit', 'balance', 'reversal'];
const DEFAULT_APP_ID = 'dal-website';

let _mcApp = null;

function getMcApp() {
  if (_mcApp) return _mcApp;

  const projectId = process.env.DAL_MC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.DAL_MC_FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.DAL_MC_FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const storageBucket =
    process.env.DAL_MC_FIREBASE_STORAGE_BUCKET ||
    (projectId ? projectId + '.firebasestorage.app' : '');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing DAL_MC Firebase env vars');
  }

  const appName = 'dalMcAdmin';
  let app;
  try {
    app = getApp(appName);
  } catch (_) {
    app = initializeApp(
      {
        credential: cert({ projectId, clientEmail, privateKey }),
        projectId,
        storageBucket,
      },
      appName
    );
  }

  _mcApp = app;
  return _mcApp;
}

function getDb() {
  return getFirestore(getMcApp());
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

function serializeDoc(snap, extra) {
  return { id: snap.id, ...serializeValue(snap.data() || {}), ...(extra || {}) };
}

function normalizeType(value) {
  return String(value || '').trim().toLowerCase();
}

function isClientEntry(row) {
  return ENTRY_TYPES.includes(normalizeType(row && row.type));
}

function entryDate(row) {
  return String((row && row.date) || '').slice(0, 10);
}

function matchesFilters(row, query) {
  const from = String((query && query.from) || '').trim();
  const to = String((query && query.to) || '').trim();
  const type = normalizeType(query && query.type);
  const date = entryDate(row);

  if (type) {
    if (!ENTRY_TYPES.includes(type)) return false;
    if (normalizeType(row.type) !== type) return false;
  } else if (!isClientEntry(row)) {
    return false;
  }
  if (from && date && date < from) return false;
  if (to && date && date > to) return false;
  return true;
}

function pickAllowed(body) {
  const out = {};
  if (body.date != null) out.date = String(body.date).trim().slice(0, 10);
  if (body.description != null) out.description = String(body.description).trim();
  if (body.note != null) out.note = String(body.note).trim();
  if (body.type != null) out.type = normalizeType(body.type);
  if (body.amount != null) out.amount = Number(body.amount);
  if (body.appId != null) out.appId = String(body.appId).trim();
  if (body.quoteId != null) out.quoteId = String(body.quoteId).trim();
  if (body.buildId != null) out.buildId = String(body.buildId).trim();
  if (body.stripePaymentIntentId != null) {
    out.stripePaymentIntentId = String(body.stripePaymentIntentId).trim();
  }
  if (body.isTest != null) out.isTest = body.isTest === true || body.isTest === 'true';

  if (!out.date) throw Object.assign(new Error('Date is required'), { status: 400 });
  if (!out.description && out.note) out.description = out.note;
  if (!out.description) throw Object.assign(new Error('Description is required'), { status: 400 });
  if (!ENTRY_TYPES.includes(out.type)) {
    throw Object.assign(new Error('Type must be deposit, balance, or reversal'), { status: 400 });
  }
  if (!Number.isFinite(out.amount)) {
    throw Object.assign(new Error('Amount is required'), { status: 400 });
  }
  if (!out.appId) out.appId = DEFAULT_APP_ID;
  if (!out.note) out.note = out.description;
  return out;
}

async function listEntries(db, query) {
  const col = db.collection('revenue');
  const snap = await col.get();
  const entries = [];
  const seen = new Set();

  const pushRow = (row) => {
    if (!matchesFilters(row, query || {})) return;
    const key = `${row.appId || ''}::${row.id}`;
    if (seen.has(key) || seen.has(row.id)) return;
    seen.add(key);
    seen.add(row.id);
    entries.push(row);
  };

  await Promise.all(
    snap.docs.map(async (docSnap) => {
      const top = serializeDoc(docSnap, { appId: docSnap.data()?.appId || docSnap.id });
      pushRow(top);

      const salesSnap = await docSnap.ref.collection('manualSales').get();
      salesSnap.docs.forEach((saleSnap) => {
        pushRow(serializeDoc(saleSnap, { appId: saleSnap.data()?.appId || docSnap.id }));
      });
    })
  );

  entries.sort((a, b) => {
    const dateCmp = entryDate(b).localeCompare(entryDate(a));
    if (dateCmp) return dateCmp;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });

  return entries;
}

async function findEntryRef(db, id) {
  const top = db.collection('revenue').doc(id);
  const topSnap = await top.get();
  if (topSnap.exists && isClientEntry(topSnap.data() || {})) return top;

  const revenueSnap = await db.collection('revenue').get();
  for (const docSnap of revenueSnap.docs) {
    const ref = docSnap.ref.collection('manualSales').doc(id);
    const saleSnap = await ref.get();
    if (saleSnap.exists) return ref;
  }
  return null;
}

module.exports = async (req, res) => {
  if (req.method === 'POST' || req.method === 'DELETE' || req.method === 'PATCH') {
    const auth = String(req.headers['authorization'] || '');
    const secret = process.env.DAL_MC_INTERNAL_SECRET || '';
    if (!secret || auth !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const db = getDb();
    const id = String((req.query && req.query.id) || '').trim();

    if (req.method === 'GET') {
      const type = normalizeType(req.query && req.query.type);
      if (type && !ENTRY_TYPES.includes(type)) {
        return res.status(400).json({ error: 'type must be deposit, balance, or reversal' });
      }
      const entries = await listEntries(db, req.query || {});
      return res.status(200).json({ ok: true, entries });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const data = pickAllowed(body);
      data.createdAt = FieldValue.serverTimestamp();

      const appRef = db.collection('revenue').doc(data.appId);
      await appRef.set({ appId: data.appId }, { merge: true });

      if (data.stripePaymentIntentId) {
        const byId = appRef.collection('manualSales').doc(data.stripePaymentIntentId);
        const existingById = await byId.get();
        if (existingById.exists) {
          return res.status(200).json({
            ok: true,
            duplicate: true,
            entry: serializeDoc(existingById, { appId: data.appId }),
          });
        }
        const existingByField = await appRef
          .collection('manualSales')
          .where('stripePaymentIntentId', '==', data.stripePaymentIntentId)
          .limit(1)
          .get();
        if (!existingByField.empty) {
          return res.status(200).json({
            ok: true,
            duplicate: true,
            entry: serializeDoc(existingByField.docs[0], { appId: data.appId }),
          });
        }
        try {
          await byId.create(data);
        } catch (err) {
          const code = err && (err.code || err.status);
          if (code === 6 || code === 'already-exists' || /already exists/i.test(String(err.message || ''))) {
            const dup = await byId.get();
            return res.status(200).json({
              ok: true,
              duplicate: true,
              entry: serializeDoc(dup, { appId: data.appId }),
            });
          }
          throw err;
        }
        const created = await byId.get();
        return res.status(200).json({
          ok: true,
          entry: serializeDoc(created, { appId: data.appId }),
        });
      }

      const ref = appRef.collection('manualSales').doc();
      await ref.set(data);
      const created = await ref.get();
      return res.status(200).json({
        ok: true,
        entry: serializeDoc(created, { appId: data.appId }),
      });
    }

    if (req.method === 'PATCH') {
      if (!id) return res.status(400).json({ error: 'Revenue entry id is required' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const ref = await findEntryRef(db, id);
      if (!ref) return res.status(404).json({ error: 'Revenue entry not found' });
      const patch = {};
      if (body.isTest != null) patch.isTest = body.isTest === true || body.isTest === 'true';
      if (!Object.keys(patch).length) {
        return res.status(400).json({ error: 'No fields to update' });
      }
      await ref.set(patch, { merge: true });
      const updated = await ref.get();
      return res.status(200).json({ ok: true, entry: serializeDoc(updated) });
    }

    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'Revenue entry id is required' });
      if (id.includes('/') || id.includes('..')) {
        return res.status(400).json({ error: 'Invalid revenue entry id' });
      }
      const ref = await findEntryRef(db, id);
      if (!ref) return res.status(404).json({ error: 'Revenue entry not found' });
      await ref.delete();
      return res.status(200).json({ ok: true, id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    const status = e && e.status ? e.status : 500;
    console.error('revenue-entries api error', e);
    return res.status(status).json({
      error: status === 400 ? e.message : 'Revenue entries request failed',
      detail: String((e && e.message) || e),
    });
  }
};
