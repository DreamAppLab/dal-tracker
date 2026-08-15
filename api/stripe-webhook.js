// Mission Control — Stripe webhook for quote deposits/balances
// POST /api/stripe-webhook
// Verifies Stripe signatures, then records the payment idempotently by
// Stripe payment intent ID (creates Build Board entries for deposits).

const Stripe = require('stripe');
const {
  processQuotePayment,
  extractPaymentIntentId,
  paymentLinkIdFrom,
  tokenList,
} = require('./record-quote-payment');

let _stripe = null;

function getStripe() {
  if (_stripe) return _stripe;
  _stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  return _stripe;
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
  let paymentLinkId =
    paymentLinkIdFrom(object.payment_link) ||
    paymentLinkIdFrom(object.metadata && object.metadata.payment_link);

  let sessionMetadata = {};
  if (!paymentLinkId && object.object === 'payment_intent' && object.id) {
    const sessions = await stripe.checkout.sessions.list({
      payment_intent: object.id,
      limit: 1,
    });
    const session = sessions.data && sessions.data[0];
    if (session) {
      paymentLinkId = paymentLinkIdFrom(session.payment_link);
      sessionMetadata = session.metadata || {};
      if (object.amount_total == null && session.amount_total != null) {
        object.amount_total = session.amount_total;
      }
    }
  }

  let paymentLinkUrl = null;
  let linkMetadata = {};
  if (paymentLinkId) {
    try {
      const link = await stripe.paymentLinks.retrieve(paymentLinkId);
      paymentLinkUrl = link && link.url ? link.url : null;
      linkMetadata = (link && link.metadata) || {};
    } catch (err) {
      console.error('stripe webhook: failed to retrieve payment link', paymentLinkId, err);
    }
  }

  return {
    paymentLinkId,
    paymentLinkUrl,
    tokens: tokenList(paymentLinkId, paymentLinkUrl),
    metadata: {
      ...linkMetadata,
      ...sessionMetadata,
      ...(object.metadata || {}),
    },
  };
}

async function handlePaidEvent(stripe, object) {
  const stripePaymentIntentId = extractPaymentIntentId(object);
  if (!stripePaymentIntentId) {
    console.log('stripe webhook: missing payment intent id', { objectId: object && object.id });
    return { matched: false, reason: 'missing_payment_intent' };
  }

  const existingCheck = await processQuotePayment({
    stripePaymentIntentId,
    amount: amountDollars(object),
    ...(await resolvePaymentLink(stripe, object)),
  });

  return existingCheck;
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
