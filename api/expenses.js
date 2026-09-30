// Mission Control — expenses CRUD for the expenses collection
// GET    /api/expenses              — list (query: taxYear, category, appId, from, to, search)
// POST   /api/expenses              — create
// PUT    /api/expenses?id=xxx       — merge update
// DELETE /api/expenses?id=xxx       — delete doc + Storage files
// Uses the dal-mission-control service account (DAL_MC_FIREBASE_* env vars).

const { initializeApp, getApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

const CATEGORIES = [
  'Advertising & Marketing',
  'App Store Fees',
  'Domain & Hosting',
  'Hardware & Equipment',
  'Other',
  'Professional Services',
  'Software & Subscriptions',
  'Travel & Meals',
  'Utilities',
];

const APPS = [
  'DAL General',
  'FamilyLens',
  'FamilyThread',
  'Flarepad',
  'Logabode',
  'MyClassLog',
  'RV Vault',
  'Ten Miles Ahead',
  'The Shady Duck',
  'TravelWhirl',
];

const SOURCES = ['email', 'manual', 'pdf', 'image'];

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

function serializeDoc(snap) {
  return { id: snap.id, ...serializeValue(snap.data() || {}) };
}

function taxYearFromDate(dateStr) {
  const year = Number(String(dateStr || '').slice(0, 4));
  return Number.isFinite(year) && year > 1900 ? year : new Date().getFullYear();
}

function pickAllowed(body, { isCreate }) {
  const out = {};
  if (body.vendor != null) out.vendor = String(body.vendor).trim();
  if (body.amount != null) out.amount = Number(body.amount);
  if (body.date != null) out.date = String(body.date).trim();
  if (body.category != null) out.category = String(body.category).trim();
  if (body.appId != null) out.appId = String(body.appId).trim();
  if (body.description != null) out.description = String(body.description).trim();
  if (body.source != null && SOURCES.includes(body.source)) out.source = body.source;
  if (body.rawText != null) out.rawText = String(body.rawText);
  if (body.attachmentUrl != null) out.attachmentUrl = String(body.attachmentUrl).trim();
  if (typeof body.parsedByAI === 'boolean') out.parsedByAI = body.parsedByAI;
  if (typeof body.needsReview === 'boolean') out.needsReview = body.needsReview;
  if (out.date) out.taxYear = taxYearFromDate(out.date);
  else if (body.taxYear != null) out.taxYear = Number(body.taxYear);

  if (isCreate) {
    if (!out.vendor) throw Object.assign(new Error('Vendor is required'), { status: 400 });
    if (!Number.isFinite(out.amount)) throw Object.assign(new Error('Amount is required'), { status: 400 });
    if (!out.date) throw Object.assign(new Error('Date is required'), { status: 400 });
    if (!out.category) throw Object.assign(new Error('Category is required'), { status: 400 });
    if (!out.appId) throw Object.assign(new Error('App is required'), { status: 400 });
    if (out.category && !CATEGORIES.includes(out.category)) {
      throw Object.assign(new Error('Invalid category'), { status: 400 });
    }
    if (out.appId && !APPS.includes(out.appId)) {
      throw Object.assign(new Error('Invalid app'), { status: 400 });
    }
    if (!out.source) out.source = 'manual';
    if (out.parsedByAI == null) out.parsedByAI = false;
    if (!out.description) out.description = '';
    if (!out.rawText) out.rawText = '';
    if (!out.attachmentUrl) out.attachmentUrl = '';
    out.taxYear = taxYearFromDate(out.date);
  } else {
    if (out.category && !CATEGORIES.includes(out.category)) {
      throw Object.assign(new Error('Invalid category'), { status: 400 });
    }
    if (out.appId && !APPS.includes(out.appId)) {
      throw Object.assign(new Error('Invalid app'), { status: 400 });
    }
    if (out.amount != null && !Number.isFinite(out.amount)) {
      throw Object.assign(new Error('Amount must be a number'), { status: 400 });
    }
  }

  return out;
}

function matchesFilters(row, query) {
  const taxYear = query.taxYear != null && query.taxYear !== '' ? Number(query.taxYear) : null;
  const category = String(query.category || '').trim();
  const appId = String(query.appId || '').trim();
  const from = String(query.from || '').trim();
  const to = String(query.to || '').trim();
  const search = String(query.search || '').trim().toLowerCase();

  if (taxYear && Number(row.taxYear) !== taxYear) return false;
  if (category && row.category !== category) return false;
  if (appId && row.appId !== appId) return false;
  if (from && String(row.date || '') < from) return false;
  if (to && String(row.date || '') > to) return false;
  if (search) {
    const vendor = String(row.vendor || '').toLowerCase();
    const description = String(row.description || '').toLowerCase();
    if (!vendor.includes(search) && !description.includes(search)) return false;
  }
  return true;
}

function sanitizeFileName(name) {
  return String(name || 'receipt')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 120);
}

async function saveAttachment(docId, buffer, filename, contentType) {
  const bucket = getStorage(getMcApp()).bucket();
  const path = `expenses/${docId}/${sanitizeFileName(filename)}`;
  const file = bucket.file(path);
  await file.save(buffer, {
    contentType: contentType || 'application/octet-stream',
    resumable: false,
  });
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: '2099-01-01',
  });
  return url;
}

function attachmentFromBody(body) {
  const raw = body && body.attachmentBase64;
  if (!raw || typeof raw !== 'string') return null;
  const buf = Buffer.from(raw, 'base64');
  if (!buf.length) return null;
  if (buf.length > 4 * 1024 * 1024) {
    throw Object.assign(new Error('Receipt must be 4MB or smaller'), { status: 400 });
  }
  return {
    buffer: buf,
    filename: String(body.attachmentName || 'receipt'),
    contentType: String(body.attachmentType || 'application/octet-stream'),
  };
}

async function deleteStoragePrefix(prefix) {
  try {
    const bucket = getStorage(getMcApp()).bucket();
    const [files] = await bucket.getFiles({ prefix });
    if (!files.length) return 0;
    await Promise.all(files.map((file) => file.delete().catch(() => null)));
    return files.length;
  } catch (err) {
    console.error('expense storage cleanup failed for', prefix, err);
    return 0;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const db = getDb();
    const id = String((req.query && req.query.id) || '').trim();
    const col = db.collection('expenses');

    if (req.method === 'GET') {
      if (id) {
        const snap = await col.doc(id).get();
        if (!snap.exists) return res.status(404).json({ error: 'Expense not found' });
        return res.status(200).json({ ok: true, expense: serializeDoc(snap) });
      }

      const snap = await col.get();
      const expenses = snap.docs
        .map(serializeDoc)
        .filter((row) => matchesFilters(row, req.query || {}))
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      return res.status(200).json({ ok: true, expenses });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const data = pickAllowed(body, { isCreate: true });
      data.createdAt = FieldValue.serverTimestamp();
      const ref = col.doc();
      const file = attachmentFromBody(body);
      if (file) {
        data.attachmentUrl = await saveAttachment(ref.id, file.buffer, file.filename, file.contentType);
      }
      await ref.set(data);
      const created = await ref.get();
      return res.status(200).json({ ok: true, expense: serializeDoc(created) });
    }

    if (req.method === 'PUT') {
      if (!id) return res.status(400).json({ error: 'Expense id is required' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const update = pickAllowed(body, { isCreate: false });
      const file = attachmentFromBody(body);
      if (file) {
        update.attachmentUrl = await saveAttachment(id, file.buffer, file.filename, file.contentType);
      }
      if (!Object.keys(update).length) {
        return res.status(400).json({ error: 'No fields to update' });
      }
      const ref = col.doc(id);
      const existing = await ref.get();
      if (!existing.exists) return res.status(404).json({ error: 'Expense not found' });
      await ref.set(update, { merge: true });
      const updated = await ref.get();
      return res.status(200).json({ ok: true, expense: serializeDoc(updated) });
    }

    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'Expense id is required' });
      if (id.includes('/') || id.includes('..')) {
        return res.status(400).json({ error: 'Invalid expense id' });
      }
      const ref = col.doc(id);
      const existing = await ref.get();
      if (!existing.exists) return res.status(404).json({ error: 'Expense not found' });
      await deleteStoragePrefix(`expenses/${id}/`);
      await ref.delete();
      return res.status(200).json({ ok: true, id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    const status = e && e.status ? e.status : 500;
    console.error('expenses api error', e);
    return res.status(status).json({
      error: status === 400 ? e.message : 'Expenses request failed',
      detail: String((e && e.message) || e),
    });
  }
};
