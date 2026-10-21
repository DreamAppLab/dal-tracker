// ONE-TIME admin endpoint — sets up Kasey (Burning Bush Candle Co.) Stripe billing
// Protected by SETUP_BILLING_TOKEN env var
// DELETE THIS FILE after use.

const Stripe = require('stripe');

const NOV_1_2026 = Math.floor(new Date('2026-11-01T00:00:00Z').getTime() / 1000);
const NOV_1_2027 = Math.floor(new Date('2027-11-01T00:00:00Z').getTime() / 1000);

const CUSTOMER_EMAIL = 'burningbushcandleco08@gmail.com';
const CUSTOMER_NAME  = 'Kasey – Burning Bush Candle Co.';

const BUILD_NICKNAME    = 'BB Build Fee $100/mo';
const HOSTING_NICKNAME  = 'BB Database/POS Hosting $15/mo';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Auth check
  const token = req.headers['x-setup-token'] || (req.body && req.body.token);
  const expected = process.env.SETUP_BILLING_TOKEN;
  if (!expected || token !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_KEY) return res.status(500).json({ error: 'STRIPE_SECRET_KEY not set' });

  const stripe = Stripe(STRIPE_KEY);
  const log = [];

  try {
    // ── 1. Find or create customer ────────────────────────────────────────────
    let customer;
    const existing = await stripe.customers.list({ email: CUSTOMER_EMAIL, limit: 5 });
    if (existing.data.length > 0) {
      customer = existing.data[0];
      log.push(`found_customer: ${customer.id} (${customer.email})`);
    } else {
      customer = await stripe.customers.create({ email: CUSTOMER_EMAIL, name: CUSTOMER_NAME });
      log.push(`created_customer: ${customer.id}`);
    }

    // ── 2. Existing subscriptions ─────────────────────────────────────────────
    const subs = await stripe.subscriptions.list({ customer: customer.id, status: 'all', limit: 20 });
    const schedules = await stripe.subscriptionSchedules.list({ customer: customer.id, limit: 20 });

    const subExists = (nickname) =>
      subs.data.some(s =>
        s.status !== 'canceled' &&
        s.items.data.some(i => i.price.nickname === nickname)
      ) ||
      schedules.data.some(sch =>
        sch.status !== 'canceled' &&
        sch.phases?.some(ph =>
          ph.items?.some(i => i.price && typeof i.price === 'object' && i.price.nickname === nickname)
        )
      );

    log.push(`existing_subs: ${subs.data.map(s => s.id + '[' + s.status + ']').join(', ') || 'none'}`);
    log.push(`existing_schedules: ${schedules.data.map(s => s.id + '[' + s.status + ']').join(', ') || 'none'}`);

    // ── 3a. $100/month × 12 months starting Nov 1 2026 ───────────────────────
    if (subExists(BUILD_NICKNAME)) {
      log.push('build_fee: already_exists — skipped');
    } else {
      const buildPrice = await stripe.prices.create({
        unit_amount: 10000,
        currency: 'usd',
        recurring: { interval: 'month' },
        product_data: { name: 'Burning Bush Candle Co. — Build Fee' },
        nickname: BUILD_NICKNAME,
      });
      const buildSchedule = await stripe.subscriptionSchedules.create({
        customer: customer.id,
        start_date: NOV_1_2026,
        end_behavior: 'cancel',
        phases: [{ items: [{ price: buildPrice.id, quantity: 1 }], iterations: 12 }],
      });
      log.push(`build_fee: created_schedule ${buildSchedule.id} — $100/mo x12 starting Nov 1 2026`);
    }

    // ── 3b. $75 one-time invoice due Nov 1 2027 ───────────────────────────────
    const invoices = await stripe.invoices.list({ customer: customer.id, limit: 50 });
    const has75 = invoices.data.some(inv =>
      inv.amount_due === 7500 &&
      inv.due_date === NOV_1_2027 &&
      inv.status !== 'void'
    );
    if (has75) {
      log.push('annual_maintenance: already_exists — skipped');
    } else {
      const inv75 = await stripe.invoices.create({
        customer: customer.id,
        collection_method: 'send_invoice',
        due_date: NOV_1_2027,
        description: 'Burning Bush Candle Co. — Annual Maintenance Fee (Year 2)',
      });
      await stripe.invoiceItems.create({
        customer: customer.id,
        invoice: inv75.id,
        amount: 7500,
        currency: 'usd',
        description: 'Annual Maintenance Fee — Year 2 (Nov 1 2027)',
      });
      await stripe.invoices.finalizeInvoice(inv75.id, { auto_advance: false });
      log.push(`annual_maintenance: created_invoice ${inv75.id} — $75 due Nov 1 2027 (finalized, not yet sent)`);
    }

    // ── 3c. $15/month ongoing hosting subscription ────────────────────────────
    if (subExists(HOSTING_NICKNAME)) {
      log.push('hosting: already_exists — skipped');
    } else {
      const hostingPrice = await stripe.prices.create({
        unit_amount: 1500,
        currency: 'usd',
        recurring: { interval: 'month' },
        product_data: { name: 'Burning Bush Candle Co. — Database/POS Hosting' },
        nickname: HOSTING_NICKNAME,
      });
      const hostingSub = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: hostingPrice.id }],
        billing_cycle_anchor: NOV_1_2026,
        proration_behavior: 'none',
        collection_method: 'send_invoice',
        days_until_due: 7,
      });
      log.push(`hosting: created_subscription ${hostingSub.id} — $15/mo ongoing starting Nov 1 2026`);
    }

    return res.status(200).json({ ok: true, customer_id: customer.id, log });

  } catch (e) {
    return res.status(500).json({ error: e.message, log });
  }
};
