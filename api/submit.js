// Mission Control — quote submission endpoint
// POST /api/submit — create a new quote in the DAL site Firestore
// Accepts JSON body matching the quote schema; zerbiqClientId is persisted for CRM quotes.

const { initializeApp, getApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');

const CRM_FORM_TYPES = new Set(['CRM Only', 'Website + CRM']);

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
    try { return value.toDate().toISOString(); } catch (_) { return null; }
  }
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000).toISOString();
  }
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach((k) => { out[k] = serializeValue(value[k]); });
    return out;
  }
  return value;
}

function serializeDoc(docSnap) {
  return { id: docSnap.id, ...serializeValue(docSnap.data() || {}) };
}

function buildQuoteData(body) {
  const now = new Date().toISOString();
  const formType = String(body.formType || '');
  const isCrm = CRM_FORM_TYPES.has(formType);

  const data = {
    name: body.name || '',
    email: body.email || '',
    phone: body.phone || body.phoneNumber || '',
    business: body.business || body.biz || '',
    formType,
    status: body.status || 'submitted',
    total: body.total != null ? Number(body.total) : 0,
    originalTotal: body.originalTotal != null ? Number(body.originalTotal) : undefined,
    notes: body.notes || '',
    items: Array.isArray(body.items) ? body.items : [],
    selections: Array.isArray(body.selections) ? body.selections : [],
    design: body.design || '',
    colors: body.colors || '',
    inspirations: body.inspirations || body.designInspirations || '',
    brandStatus: body.brandStatus || body.brand_status || '',
    managementChoice: body.managementChoice || '',
    managedTier: body.managedTier || body.plan || '',
    monthlyFee: body.monthlyFee != null ? Number(body.monthlyFee) : null,
    transferFee: body.transferFee != null ? Number(body.transferFee) : null,
    discountCode: body.discountCode || '',
    discountAmount: body.discountAmount != null ? Number(body.discountAmount) : 0,
    discountPercent: body.discountPercent != null ? Number(body.discountPercent) : null,
    createdAt: Timestamp.fromDate(new Date(body.createdAt || now)),
    submittedAt: Timestamp.fromDate(new Date(body.submittedAt || now)),
  };

  if (isCrm && body.zerbiqClientId) {
    data.zerbiqClientId = String(body.zerbiqClientId).trim();
  }

  // Strip undefined values
  Object.keys(data).forEach((k) => { if (data[k] === undefined) delete data[k]; });

  return data;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSiteDb();
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};

    if (!body.email) {
      return res.status(400).json({ error: 'email is required' });
    }

    const data = buildQuoteData(body);
    const ref = await db.collection('quotes').add(data);
    const snap = await ref.get();

    return res.status(200).json({ ok: true, quote: serializeDoc(snap) });
  } catch (e) {
    console.error('submit api error', e);
    return res.status(500).json({
      error: 'Quote submission failed',
      detail: String((e && e.message) || e),
    });
  }
};
