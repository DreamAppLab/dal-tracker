// ONE-TIME admin endpoint — fixes Kasey (Burning Bush Candle Co.) $75 annual maintenance fee
// Voids the existing one-time invoice and creates a $75/year recurring subscription instead
// Protected by SETUP_BILLING_TOKEN env var
// DELETE THIS FILE after use.

const Stripe = require('stripe');

const CUSTOMER_ID = 'cus_VPuKZaTOcNAfaR';
const NOV_1_2027 = Math.floor(new Date('2027-11-01T00:00:00Z').getTime() / 1000);
const MAINTENANCE_NICKNAME = 'BB Annual Maintenance $75/yr';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const token = req.headers['x-setup-token'] || (req.body && req.body.token);
  const expected = process.env.SETUP_BILLING_TOKEN;
  if (!expected || token !== expected) return res.status(401).json({ error: 'Unauthorized' });

  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_KEY) return res.status(500).json({ error: 'STRIPE_SECRET_KEY not set' });

  const stripe = Stripe(STRIPE_KEY);
  const log = [];

  try {
    // 1. Void any open/draft invoices for $75 that aren't subscriptions
    const invoices = await stripe.invoices.list({ customer: CUSTOMER_ID, limit: 50 });
    for (const inv of invoices.data) {
      if (inv.amount_due === 7500 && !inv.subscription) {
        if (inv.status === 'open') {
          await stripe.invoices.voidInvoice(inv.id);
          log.push(`voided_invoice: ${inv.id}`);
        } else if (inv.status === 'draft') {
          await stripe.invoices.del(inv.id);
          log.push(`deleted_draft_invoice: ${inv.id}`);
        } else {
          log.push(`skipped_invoice: ${inv.id} [${inv.status}]`);
        }
      }
    }

    // 2. Check if $75/yr subscription already exists
    const subs = await stripe.subscriptions.list({ customer: CUSTOMER_ID, status: 'all', limit: 20 });
    const alreadyExists = subs.data.some(s =>
      s.status !== 'canceled' &&
      s.items.data.some(i => i.price.nickname === MAINTENANCE_NICKNAME)
    );

    if (alreadyExists) {
      log.push('annual_maintenance_sub: already_exists — skipped');
    } else {
      // Create $75/year price
      const price = await stripe.prices.create({
        unit_amount: 7500,
        currency: 'usd',
        recurring: { interval: 'year' },
        product_data: { name: 'Burning Bush Candle Co. — Annual Maintenance Fee' },
        nickname: MAINTENANCE_NICKNAME,
      });

      // Create subscription schedule starting Nov 1 2027
      const schedule = await stripe.subscriptionSchedules.create({
        customer: CUSTOMER_ID,
        start_date: NOV_1_2027,
        end_behavior: 'release',
        phases: [{ items: [{ price: price.id, quantity: 1 }] }],
      });
      log.push(`annual_maintenance_sub: created_schedule ${schedule.id} — $75/yr starting Nov 1 2027`);
    }

    return res.status(200).json({ ok: true, log });
  } catch (e) {
    return res.status(500).json({ error: e.message, log });
  }
};
