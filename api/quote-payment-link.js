// Mission Control — create a Stripe payment link and email it to the client.
// POST /api/quote-payment-link
// { kind: 'deposit' | 'balance', firstName, email, amount, businessName }

const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || 'inbound.dreamapplab.com';
const MAILGUN_FROM =
  process.env.MAILGUN_FROM || 'Dream App Lab <lab@inbound.dreamapplab.com>';

const money = (n) =>
  '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

function shell(inner) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#1a2130;">
    <div style="background:#0a0d1a;padding:22px;text-align:center;">
      <span style="color:#4cc1f3;font-size:19px;font-weight:bold;letter-spacing:2px;">DREAM APP LAB</span>
    </div>
    <div style="padding:26px 24px;background:#ffffff;">${inner}</div>
    <div style="padding:16px 24px;background:#f3f6fb;color:#8a93a6;font-size:12px;text-align:center;">
      Dream App Lab &middot; lab@dreamapplab.com &middot; Clarity first. Creation second.
    </div>
  </div>`;
}

function payButton(url, label) {
  return `<p style="text-align:center;margin:26px 0 10px;">
    <a href="${esc(url)}" style="display:inline-block;background:#4cc1f3;color:#0a0d1a;padding:14px 28px;border-radius:8px;font-weight:bold;text-decoration:none;">${esc(label)}</a>
  </p>`;
}

function depositEmail(firstName, amount, url) {
  return shell(`
    <p style="font-size:16px;line-height:1.6;margin:0 0 8px;">Hi ${esc(firstName)}, your deposit link is ready. Click below to pay your 20% deposit of ${money(amount)} and we will get started right away.</p>
    ${payButton(url, `Pay Your Deposit — ${money(amount)} →`)}
  `);
}

function balanceEmail(firstName, amount, url) {
  return shell(`
    <p style="font-size:16px;line-height:1.6;margin:0 0 8px;">Hi ${esc(firstName)}, your project is complete and ready for delivery. Click below to pay your final balance of ${money(amount)}.</p>
    ${payButton(url, `Pay Your Balance — ${money(amount)} →`)}
  `);
}

async function createStripeLink(productName, amountDollars, meta = {}) {
  const secret = process.env.STRIPE_SECRET_KEY;
  const cents = Math.round(Number(amountDollars || 0) * 100);
  if (!secret || !cents) return null;

  const auth = 'Bearer ' + secret;
  const form = (obj) =>
    Object.entries(obj)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
      .join('&');

  const priceRes = await fetch('https://api.stripe.com/v1/prices', {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form({
      currency: 'usd',
      unit_amount: String(cents),
      'product_data[name]': productName,
    }),
  });
  const price = await priceRes.json();
  if (!priceRes.ok) {
    throw new Error(price.error?.message || 'Stripe price create failed');
  }

  const quoteId = String(meta.quoteId || '').trim();
  const kind = String(meta.kind || '').trim();
  const buildId = String(meta.buildId || '').trim();

  const linkRes = await fetch('https://api.stripe.com/v1/payment_links', {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form({
      'line_items[0][price]': price.id,
      'line_items[0][quantity]': '1',
      'metadata[quoteId]': quoteId,
      'metadata[kind]': kind,
      'metadata[buildId]': buildId,
      'payment_intent_data[metadata][quoteId]': quoteId,
      'payment_intent_data[metadata][kind]': kind,
      'payment_intent_data[metadata][buildId]': buildId,
    }),
  });
  const link = await linkRes.json();
  if (!linkRes.ok) {
    throw new Error(link.error?.message || 'Stripe payment link create failed');
  }
  return link.url;
}

async function sendEmail(to, subject, html) {
  const apiKey = process.env.MAILGUN_API_KEY;
  if (!apiKey) throw new Error('MAILGUN_API_KEY not configured');

  const formData = new FormData();
  formData.append('from', MAILGUN_FROM);
  formData.append('to', to);
  formData.append('subject', subject);
  formData.append('html', html);
  formData.append('h:Reply-To', 'lab@dreamapplab.com');

  const r = await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`api:${apiKey}`).toString('base64'),
    },
    body: formData,
  });
  if (!r.ok) throw new Error('Mailgun ' + r.status + ': ' + (await r.text()));
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const kind = String(body.kind || '').trim();
    const email = String(body.email || '').trim();
    const firstName = String(body.firstName || 'there').trim() || 'there';
    const amount = Number(body.amount);
    const businessName = String(body.businessName || 'Dream App Lab Project').trim();
    const quoteId = String(body.quoteId || '').trim();
    const buildId = String(body.buildId || '').trim();

    if (kind !== 'deposit' && kind !== 'balance') {
      return res.status(400).json({ error: 'kind must be deposit or balance' });
    }
    if (!email) return res.status(400).json({ error: 'email is required' });
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'A valid amount is required' });
    }

    const productName =
      kind === 'deposit'
        ? 'Project Deposit — ' + businessName
        : 'Project Balance — ' + businessName;

    const url = await createStripeLink(productName, amount, { quoteId, kind, buildId });
    if (!url) {
      return res.status(500).json({ error: 'Stripe is not configured or amount is invalid' });
    }

    const html =
      kind === 'deposit' ? depositEmail(firstName, amount, url) : balanceEmail(firstName, amount, url);
    const subject =
      kind === 'deposit'
        ? 'Your Dream App Lab deposit link is ready'
        : 'Your Dream App Lab project is ready — final balance';

    await sendEmail(email, subject, html);

    return res.status(200).json({ ok: true, url, kind, emailed: true, emailedTo: email });
  } catch (e) {
    console.error('quote-payment-link error', e);
    return res.status(500).json({
      error: 'Failed to send payment link',
      detail: String((e && e.message) || e),
    });
  }
};
