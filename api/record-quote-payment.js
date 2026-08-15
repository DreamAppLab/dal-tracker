// Mission Control — idempotent quote deposit/balance recording
// POST /api/record-quote-payment
// Auth: Bearer DAL_MC_INTERNAL_SECRET
// Dedupes on Stripe payment intent ID, posts revenue, and for deposits
// creates a Build Board entry and marks the quote In Build.

const { initializeApp, getApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const DEFAULT_APP_ID = 'dal-website';

let _siteDb = null;
let _mcApp = null;

function getSiteDb() {
  if (_siteDb) return _siteDb;

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.DAL_SITE_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || process.env.DAL_SITE_FIREBASE_CLIENT_EMAIL;
  const privateKey = (
    process.env.FIREBASE_PRIVATE_KEY ||
    process.env.DAL_SITE_FIREBASE_PRIVATE_KEY ||
    ''
  ).replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing Firebase env vars for dal-website-c9dd8');
  }

  const appName = 'dalSiteAdmin';
  let app;
  try {
    app = getApp(appName);
  } catch (_) {
    app = initializeApp(
      { credential: cert({ projectId, clientEmail, privateKey }), projectId },
      appName
    );
  }

  _siteDb = getFirestore(app);
  return _siteDb;
}

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
      { credential: cert({ projectId, clientEmail, privateKey }), projectId, storageBucket },
      appName
    );
  }

  _mcApp = app;
  return _mcApp;
}

function getMcDb() {
  return getFirestore(getMcApp());
}

function todayISO() {
  return new Date().toISOString().split('T').shift();
}

function quoteDisplayName(quote) {
  return (
    quote.businessName ||
    quote.clientName ||
    quote.business ||
    quote.biz ||
    quote.name ||
    'Project'
  );
}

function omitUndefined(obj) {
  const out = {};
  Object.keys(obj || {}).forEach((key) => {
    if (obj[key] !== undefined) out[key] = obj[key];
  });
  return out;
}

function quotePricing(q) {
  const clientDiscount = Number(q.discountAmount || 0);
  const original =
    q.originalTotal != null
      ? Number(q.originalTotal)
      : Number(q.total || 0) + clientDiscount;
  const afterClient =
    q.originalTotal != null ? Number(q.total || 0) : Math.max(0, original - clientDiscount);
  const dalDiscount = Number(q.dalDiscount || 0);
  const finalTotal = Math.max(0, afterClient - dalDiscount);
  const deposit = q.deposit != null ? Number(q.deposit) : Math.round(finalTotal * 0.2);
  const balance = q.balance != null ? Number(q.balance) : finalTotal - deposit;
  return { original, clientDiscount, afterClient, dalDiscount, finalTotal, deposit, balance };
}

function paymentLinkIdFrom(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value.id) return String(value.id);
  return null;
}

function tokenList(paymentLinkId, paymentLinkUrl) {
  const tokens = [];
  if (paymentLinkId) tokens.push(String(paymentLinkId));
  if (paymentLinkUrl) {
    tokens.push(String(paymentLinkUrl));
    try {
      const slug = new URL(paymentLinkUrl).pathname.split('/').filter(Boolean).pop();
      if (slug) tokens.push(slug);
    } catch (_) {
      /* ignore malformed url */
    }
  }
  return [...new Set(tokens.filter(Boolean))];
}

function urlContainsToken(url, tokens) {
  const value = String(url || '');
  if (!value) return false;
  return tokens.some((token) => token && value.includes(token));
}

function extractPaymentIntentId(object) {
  if (!object || typeof object !== 'object') return '';
  if (object.object === 'payment_intent' && object.id) return String(object.id);
  const fromField = object.payment_intent;
  if (typeof fromField === 'string' && fromField) return fromField;
  if (fromField && typeof fromField === 'object' && fromField.id) return String(fromField.id);
  if (object.metadata && object.metadata.payment_intent) return String(object.metadata.payment_intent);
  return '';
}

async function findMatchingQuote(db, { tokens, metadata, quoteId, kind }) {
  const metaQuoteId = String(quoteId || (metadata && metadata.quoteId) || '').trim();
  const metaKind = String(kind || (metadata && metadata.kind) || '').trim().toLowerCase();

  if (metaQuoteId) {
    const snap = await db.collection('quotes').doc(metaQuoteId).get();
    if (snap.exists) {
      const data = snap.data() || {};
      let type = metaKind === 'balance' || metaKind === 'deposit' ? metaKind : '';
      if (!type) {
        if (urlContainsToken(data.stripeBalanceUrl, tokens)) type = 'balance';
        else type = 'deposit';
      }
      return { id: snap.id, type, quote: data, ref: snap.ref };
    }
  }

  if (!tokens.length) return null;

  const snap = await db.collection('quotes').get();
  for (const docSnap of snap.docs) {
    const data = docSnap.data() || {};
    if (urlContainsToken(data.stripeDepositUrl, tokens)) {
      return { id: docSnap.id, type: 'deposit', quote: data, ref: docSnap.ref };
    }
    if (urlContainsToken(data.stripeBalanceUrl, tokens)) {
      return { id: docSnap.id, type: 'balance', quote: data, ref: docSnap.ref };
    }
  }
  return null;
}

async function findRevenueByPaymentIntent(mcDb, paymentIntentId) {
  if (!paymentIntentId) return null;
  const revenueSnap = await mcDb.collection('revenue').get();
  for (const docSnap of revenueSnap.docs) {
    const byId = await docSnap.ref.collection('manualSales').doc(paymentIntentId).get();
    if (byId.exists) return byId;
    const byField = await docSnap.ref
      .collection('manualSales')
      .where('stripePaymentIntentId', '==', paymentIntentId)
      .limit(1)
      .get();
    if (!byField.empty) return byField.docs[0];
  }
  return null;
}

async function writeRevenueEntry(mcDb, { type, amount, description, quoteId, buildId, stripePaymentIntentId, isTest }) {
  const existing = await findRevenueByPaymentIntent(mcDb, stripePaymentIntentId);
  if (existing) {
    return { duplicate: true, id: existing.id };
  }

  const appId = DEFAULT_APP_ID;
  const appRef = mcDb.collection('revenue').doc(appId);
  await appRef.set({ appId }, { merge: true });

  const docId = stripePaymentIntentId || undefined;
  const ref = docId ? appRef.collection('manualSales').doc(docId) : appRef.collection('manualSales').doc();
  const already = docId ? await ref.get() : { exists: false };
  if (already.exists) {
    return { duplicate: true, id: ref.id };
  }

  const data = omitUndefined({
    appId,
    type,
    amount,
    date: todayISO(),
    description,
    note: description,
    quoteId: quoteId || '',
    buildId: buildId || '',
    stripePaymentIntentId: stripePaymentIntentId || '',
    isTest: !!isTest,
    createdAt: FieldValue.serverTimestamp(),
  });

  try {
    await ref.create(data);
  } catch (err) {
    const code = err && (err.code || err.status);
    if (code === 6 || code === 'already-exists' || /already exists/i.test(String(err.message || ''))) {
      return { duplicate: true, id: ref.id };
    }
    throw err;
  }

  return { duplicate: false, id: ref.id };
}

async function ensureBuildFromQuote({ quoteId, quote, amount, stripePaymentIntentId }) {
  const mcDb = getMcDb();
  const pricing = quotePricing(quote);
  const biz = quoteDisplayName(quote);
  const now = new Date().toISOString();
  const buildRef = mcDb.collection('builds').doc('quote-' + quoteId);

  await mcDb.runTransaction(async (tx) => {
    const snap = await tx.get(buildRef);
    if (snap.exists) {
      const prev = snap.data() || {};
      tx.set(
        buildRef,
        omitUndefined({
          status: prev.status === 'complete' ? prev.status : 'in_progress',
          stripeDepositPaymentIntentId: stripePaymentIntentId || prev.stripeDepositPaymentIntentId,
          depositPaidAmount: amount != null ? amount : prev.depositPaidAmount,
          depositPostedToRevenue: true,
          updatedAt: now,
        }),
        { merge: true }
      );
      return;
    }

    tx.set(
      buildRef,
      omitUndefined({
        quoteId,
        clientName: quote.name || quote.clientName || '',
        email: quote.email || '',
        businessName: biz,
        formType: quote.formType || '',
        total: pricing.finalTotal,
        deposit: pricing.deposit,
        balance: pricing.balance,
        managementChoice: quote.managementChoice || '',
        managedTier: quote.managedTier || quote.plan || '',
        monthlyFee: quote.monthlyFee != null ? Number(quote.monthlyFee) : null,
        status: 'in_progress',
        source: 'quote',
        depositPostedToRevenue: true,
        balancePostedToRevenue: false,
        projectNotes: '',
        stripeDepositPaymentIntentId: stripePaymentIntentId || '',
        depositPaidAmount: amount != null ? Number(amount) : pricing.deposit,
        createdAt: now,
        movedToBuildAt: now,
      })
    );
  });

  return { id: buildRef.id };
}

async function processQuotePayment({
  stripePaymentIntentId,
  amount,
  paymentLinkId,
  paymentLinkUrl,
  metadata,
  quoteId,
  kind,
}) {
  const pi = String(stripePaymentIntentId || '').trim();
  if (!pi) {
    throw Object.assign(new Error('stripePaymentIntentId is required'), { status: 400 });
  }

  const tokens = tokenList(paymentLinkId, paymentLinkUrl);
  const siteDb = getSiteDb();
  const match = await findMatchingQuote(siteDb, {
    tokens,
    metadata: metadata || {},
    quoteId,
    kind,
  });

  if (!match) {
    return { matched: false, stripePaymentIntentId: pi };
  }

  const paidAmount = Number(amount);
  const isTest = Number.isFinite(paidAmount) && Math.abs(paidAmount) === 2;
  const name = quoteDisplayName(match.quote);
  const now = new Date().toISOString();

  if (match.type === 'deposit') {
    const build = await ensureBuildFromQuote({
      quoteId: match.id,
      quote: match.quote,
      amount: paidAmount,
      stripePaymentIntentId: pi,
    });

    const revenue = await writeRevenueEntry(getMcDb(), {
      type: 'deposit',
      amount: paidAmount,
      description: 'Project deposit — ' + name,
      quoteId: match.id,
      buildId: build.id,
      stripePaymentIntentId: pi,
      isTest,
    });

    await match.ref.set(
      {
        status: 'in_build',
        depositPaidAt: now,
        depositPaidAmount: paidAmount,
        stripeDepositPaymentIntentId: pi,
        movedToBuildAt: now,
      },
      { merge: true }
    );

    return {
      matched: true,
      duplicate: !!revenue.duplicate,
      quoteId: match.id,
      type: 'deposit',
      buildId: build.id,
      stripePaymentIntentId: pi,
      amount: paidAmount,
    };
  }

  const revenue = await writeRevenueEntry(getMcDb(), {
    type: 'balance',
    amount: paidAmount,
    description: 'Project balance — ' + name,
    quoteId: match.id,
    stripePaymentIntentId: pi,
    isTest,
  });

  await match.ref.set(
    {
      status: 'complete',
      balancePaidAt: now,
      balancePaidAmount: paidAmount,
      stripeBalancePaymentIntentId: pi,
      completedAt: now,
    },
    { merge: true }
  );

  try {
    const buildRef = getMcDb().collection('builds').doc('quote-' + match.id);
    const buildSnap = await buildRef.get();
    if (buildSnap.exists) {
      await buildRef.set(
        {
          status: 'complete',
          completedAt: now,
          balancePostedToRevenue: true,
          stripeBalancePaymentIntentId: pi,
        },
        { merge: true }
      );
    }
  } catch (err) {
    console.error('record-quote-payment: failed to complete build', err);
  }

  return {
    matched: true,
    duplicate: !!revenue.duplicate,
    quoteId: match.id,
    type: 'balance',
    stripePaymentIntentId: pi,
    amount: paidAmount,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = String(req.headers.authorization || '');
  const secret = process.env.DAL_MC_INTERNAL_SECRET || '';
  if (!secret || auth !== 'Bearer ' + secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const result = await processQuotePayment(body);
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    const status = e && e.status ? e.status : 500;
    console.error('record-quote-payment error', e);
    return res.status(status).json({
      error: status === 400 ? e.message : 'Failed to record quote payment',
      detail: String((e && e.message) || e),
    });
  }
};

module.exports.processQuotePayment = processQuotePayment;
module.exports.extractPaymentIntentId = extractPaymentIntentId;
module.exports.paymentLinkIdFrom = paymentLinkIdFrom;
module.exports.tokenList = tokenList;
