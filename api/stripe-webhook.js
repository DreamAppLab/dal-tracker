// Mission Control — Stripe webhook for quote deposits/balances
// POST /api/stripe-webhook
// Verifies Stripe signatures, matches Payment Links to quotes on dal-website-c9dd8,
// updates quote status, and posts revenue entries to Mission Control.

const Stripe = require('stripe');
const { initializeApp, getApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const REVENUE_ENTRIES_URL = 'https://dal-tracker.vercel.app/api/revenue-entries';

let _siteDb = null;
let _stripe = null;

function getStripe() {
  if (_stripe) return _stripe;
  _stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}

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

function todayISO() {
  return new Date().toISOString().split('T')[0];
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

async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
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

function amountDollars(object) {
  const cents = Number(
    object.amount_total != null
      ? object.amount_total
      : object.amount_received != null
        ? object.amount_received
        : object.amount || 0
  );
  return cents / 100;
}

async function resolvePaymentLink(stripe, object) {
  let paymentLinkId = paymentLinkIdFrom(object.payment_link) ||
    paymentLinkIdFrom(object.metadata && object.metadata.payment_link);

  if (!paymentLinkId && object.object === 'payment_intent' && object.id) {
    const sessions = await stripe.checkout.sessions.list({
      payment_intent: object.id,
      limit: 1,
    });
    const session = sessions.data && sessions.data[0];
    if (session) {
      paymentLinkId = paymentLinkIdFrom(session.payment_link);
      if (object.amount_total == null && session.amount_total != null) {
        object.amount_total = session.amount_total;
      }
    }
  }

  let paymentLinkUrl = null;
  if (paymentLinkId) {
    try {
      const link = await stripe.paymentLinks.retrieve(paymentLinkId);
      paymentLinkUrl = link && link.url ? link.url : null;
    } catch (err) {
      console.error('stripe webhook: failed to retrieve payment link', paymentLinkId, err);
    }
  }

  return {
    paymentLinkId,
    paymentLinkUrl,
    tokens: tokenList(paymentLinkId, paymentLinkUrl),
  };
}

async function findMatchingQuote(db, tokens) {
  if (!tokens.length) return null;

  const snap = await db.collection('quotes').get();
  for (const docSnap of snap.docs) {
    const data = docSnap.data() || {};
    const depositUrl = data.stripeDepositUrl;
    const balanceUrl = data.stripeBalanceUrl;
    if (urlContainsToken(depositUrl, tokens)) {
      return { id: docSnap.id, type: 'deposit', quote: data, ref: docSnap.ref };
    }
    if (urlContainsToken(balanceUrl, tokens)) {
      return { id: docSnap.id, type: 'balance', quote: data, ref: docSnap.ref };
    }
  }
  return null;
}

async function postRevenueEntry({ type, amount, description, quoteId }) {
  const secret = process.env.DAL_MC_INTERNAL_SECRET || '';
  const res = await fetch(REVENUE_ENTRIES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + secret,
    },
    body: JSON.stringify({
      type,
      amount,
      date: todayISO(),
      description,
      appId: 'dal-website',
      quoteId,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || data.detail || 'Failed to post revenue entry');
  }
  return data;
}

async function handlePaidEvent(stripe, object) {
  const { tokens, paymentLinkId } = await resolvePaymentLink(stripe, object);
  const amount = amountDollars(object);
  const db = getSiteDb();
  const match = await findMatchingQuote(db, tokens);

  if (!match) {
    console.log('stripe webhook: no matching quote', {
      paymentLinkId,
      tokens,
      objectId: object.id,
    });
    return { matched: false };
  }

  const alreadyPaid =
    match.type === 'deposit'
      ? match.quote.status === 'deposit_paid' || !!match.quote.depositPaidAt
      : match.quote.status === 'balance_paid' || !!match.quote.balancePaidAt;

  if (alreadyPaid) {
    console.log('stripe webhook: quote already marked paid', match.id, match.type);
    return { matched: true, quoteId: match.id, type: match.type, skipped: true };
  }

  const name = quoteDisplayName(match.quote);
  const now = new Date().toISOString();

  if (match.type === 'deposit') {
    await match.ref.set(
      {
        status: 'deposit_paid',
        depositPaidAt: now,
        depositPaidAmount: amount,
      },
      { merge: true }
    );
    await postRevenueEntry({
      type: 'deposit',
      amount,
      description: 'Project deposit — ' + name,
      quoteId: match.id,
    });
  } else {
    await match.ref.set(
      {
        status: 'balance_paid',
        balancePaidAt: now,
        balancePaidAmount: amount,
      },
      { merge: true }
    );
    await postRevenueEntry({
      type: 'balance',
      amount,
      description: 'Project balance — ' + name,
      quoteId: match.id,
    });
  }

  return { matched: true, quoteId: match.id, type: match.type, amount };
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !webhookSecret) {
    console.error('stripe webhook: missing signature or STRIPE_WEBHOOK_SECRET');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    const rawBody = await readRawBody(req);
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('stripe webhook signature verification failed', err);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    if (event.type !== 'checkout.session.completed' && event.type !== 'payment_intent.succeeded') {
      return res.status(200).json({ ok: true, ignored: event.type });
    }

    const result = await handlePaidEvent(getStripe(), event.data.object || {});
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('stripe webhook error', err);
    return res.status(400).json({
      error: 'Webhook handler failed',
      detail: String((err && err.message) || err),
    });
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
