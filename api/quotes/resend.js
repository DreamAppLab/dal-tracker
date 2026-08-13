// Mission Control — resend the original estimate email for a quote.
// POST /api/quotes/resend  { id }

const { initializeApp, getApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || 'inbound.dreamapplab.com';
const MAILGUN_FROM =
  process.env.MAILGUN_FROM || 'Dream App Lab <lab@inbound.dreamapplab.com>';
const SITE_URL = process.env.DAL_SITE_URL || 'https://www.dreamapplab.com';
const NDA_URL = process.env.NDA_URL || '';

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

const money = (n) =>
  '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

function firstName(name) {
  const n = String(name || '').trim();
  if (!n) return 'there';
  return n.split(/\s+/)[0];
}

function normalizeItems(d) {
  if (Array.isArray(d.items) && d.items.length) {
    return d.items.map((it) => ({
      name: it.name || it.label || '',
      description: it.description || it.desc || '',
    }));
  }
  if (Array.isArray(d.selections) && d.selections.length) {
    return d.selections.map((it) => ({
      name: it.label || it.name || '',
      description: it.description || it.desc || '',
    }));
  }
  return [];
}

function finalPricing(d) {
  const clientDiscount = Number(d.discountAmount || 0);
  const original =
    d.originalTotal != null ? Number(d.originalTotal) : Number(d.total || 0) + clientDiscount;
  const afterClient =
    d.originalTotal != null ? Number(d.total || 0) : Math.max(0, original - clientDiscount);
  const dalDiscount = Number(d.dalDiscount || 0);
  const finalTotal = Math.max(0, afterClient - dalDiscount);
  const deposit = Math.round(finalTotal * 0.2);
  const balance = finalTotal - deposit;
  return { original, clientDiscount, afterClient, dalDiscount, finalTotal, deposit, balance };
}

function totalsBlock(d, pricing) {
  const hasClient =
    d.discountCode && pricing.clientDiscount > 0;
  const hasDal = pricing.dalDiscount > 0;

  if (hasClient || hasDal) {
    let html = `
    <div style="border-top:2px solid #0a0d1a;padding-top:12px;font-size:15px;overflow:hidden;color:#8a93a6;">
      <span>Original total</span><span style="float:right;text-decoration:line-through;">${money(pricing.original)}</span>
    </div>`;
    if (hasClient) {
      html += `
    <div style="padding-top:8px;font-size:15px;overflow:hidden;color:#1a7f4a;font-weight:bold;">
      <span>Discount (${esc(d.discountCode)}${d.discountPercent != null ? ' — ' + esc(d.discountPercent) + '% off' : ''})</span><span style="float:right;">-${money(pricing.clientDiscount)}</span>
    </div>`;
    }
    if (hasDal) {
      html += `
    <div style="padding-top:8px;font-size:15px;overflow:hidden;color:#1a7f4a;font-weight:bold;">
      <span>Studio discount${d.dalDiscountNote ? ' — ' + esc(d.dalDiscountNote) : ''}</span><span style="float:right;">-${money(pricing.dalDiscount)}</span>
    </div>`;
    }
    html += `
    <div style="padding-top:10px;font-size:18px;font-weight:bold;overflow:hidden;color:#1a7f4a;">
      <span>Total investment</span><span style="float:right;">${money(pricing.finalTotal)}</span>
    </div>`;
    return html;
  }

  return `
    <div style="border-top:2px solid #0a0d1a;padding-top:12px;font-size:18px;font-weight:bold;overflow:hidden;">
      <span>Total investment</span><span style="float:right;">${money(pricing.finalTotal)}</span>
    </div>`;
}

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

function clientEstimateEmail(d, items, quoteId, pricing) {
  const rows = items
    .map((it) => {
      const desc = it.description
        ? `<div style="color:#8a93a6;font-size:13px;line-height:1.45;margin-top:3px;">${esc(it.description)}</div>`
        : '';
      return `<div style="padding:10px 0;border-bottom:1px solid #eee;">
        <div style="font-weight:bold;color:#1a2130;">${esc(it.name)}</div>
        ${desc}
      </div>`;
    })
    .join('');

  const acceptUrl = `${SITE_URL}/api/quote-accept?id=${encodeURIComponent(quoteId)}`;
  const thinkingUrl = `${SITE_URL}/api/quote-thinking?id=${encodeURIComponent(quoteId)}`;

  return shell(`
    <h2 style="margin:0 0 8px;">Hi ${esc(firstName(d.name))}, here's your estimate</h2>
    <p style="color:#5a6474;">Thanks for using our instant quote. Here's a summary of what's included. Your pre-signed NDA is attached.</p>
    <div style="margin:16px 0;">${rows || '<p style="color:#5a6474;">No line items selected.</p>'}</div>
    ${totalsBlock(d, pricing)}
    <table style="width:100%;margin-top:14px;font-size:14px;"><tr>
      <td style="background:#f3f6fb;padding:12px;border-radius:8px;">20% deposit on acceptance<br><b style="font-size:16px;">${money(
        pricing.deposit
      )}</b></td>
      <td style="width:12px;"></td>
      <td style="background:#f3f6fb;padding:12px;border-radius:8px;">80% on delivery<br><b style="font-size:16px;">${money(
        pricing.balance
      )}</b></td>
    </tr></table>
    <p style="text-align:center;margin:22px 0 10px;color:#5a6474;font-size:14px;">When you're ready, let us know how you'd like to proceed:</p>
    <p style="text-align:center;margin:0 0 10px;">
      <a href="${esc(acceptUrl)}" style="display:inline-block;background:#4cc1f3;color:#0a0d1a;padding:14px 28px;border-radius:8px;font-weight:bold;text-decoration:none;">Start My Project →</a>
    </p>
    <p style="text-align:center;margin:0 0 8px;">
      <a href="${esc(thinkingUrl)}" style="display:inline-block;background:#ffffff;color:#1a2130;padding:12px 24px;border-radius:8px;font-weight:bold;text-decoration:none;border:2px solid #c5cedd;">I'm Still Thinking</a>
    </p>
    <p style="color:#5a6474;font-size:13px;margin-top:16px;">This is an approximate estimate &mdash; third-party costs (hosting, payment processors, etc.) are separate and subject to change. Nothing is final until you approve. Reply to this email and we'll take it from there.</p>
  `);
}

async function sendEmail(to, subject, html, attachNda) {
  const apiKey = process.env.MAILGUN_API_KEY;
  if (!apiKey) throw new Error('MAILGUN_API_KEY not configured');

  const formData = new FormData();
  formData.append('from', MAILGUN_FROM);
  formData.append('to', to);
  formData.append('subject', subject);
  formData.append('html', html);
  formData.append('h:Reply-To', 'lab@dreamapplab.com');

  if (attachNda && NDA_URL) {
    const ndaRes = await fetch(NDA_URL);
    if (ndaRes.ok) {
      const ndaBuf = Buffer.from(await ndaRes.arrayBuffer());
      formData.append('attachment', new File([ndaBuf], 'DAL-NDA.pdf', { type: 'application/pdf' }));
    }
  }

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
    const id = String((req.query && req.query.id) || body.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Quote id is required' });

    const db = getSiteDb();
    const snap = await db.collection('quotes').doc(id).get();
    if (!snap.exists) return res.status(404).json({ error: 'Quote not found' });

    const d = snap.data() || {};
    if (!d.email) return res.status(400).json({ error: 'Quote is missing a client email' });

    const items = normalizeItems(d);
    const pricing = finalPricing(d);
    const html = clientEstimateEmail(d, items, id, pricing);

    await sendEmail(d.email, 'Your Dream App Lab estimate', html, true);

    return res.status(200).json({ ok: true, id, emailed: true });
  } catch (e) {
    console.error('quotes resend error', e);
    return res.status(500).json({
      error: 'Failed to resend estimate',
      detail: String((e && e.message) || e),
    });
  }
};
