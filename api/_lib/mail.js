// Outbound email via Mailgun. Server-only: MAILGUN_API_KEY never leaves api/.

const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || 'inbound.dreamapplab.com';
const MAILGUN_FROM = process.env.MAILGUN_FROM || 'Dream App Lab <lab@inbound.dreamapplab.com>';
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

// Where copies of client mail and feedback land (LAB_INBOX overrides).
function labInbox() {
  return process.env.LAB_INBOX || 'lab@dreamapplab.com';
}

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Send one email. attachments: [{ filename, contentType, buffer }] (total ≤ 15 MB;
 * extra ones are dropped and noted). Returns { ok, id, status }; never throws.
 */
async function sendMail({ to, subject, html, text, replyTo, attachments = [], fetchImpl = fetch }) {
  const key = process.env.MAILGUN_API_KEY;
  if (!key) {
    console.error('[mail] MAILGUN_API_KEY not configured');
    return { ok: false, status: 0 };
  }
  const fields = [
    ['from', MAILGUN_FROM],
    ['to', to],
    ['subject', String(subject || '').slice(0, 900)],
  ];
  if (html) fields.push(['html', html]);
  if (text) fields.push(['text', text]);
  if (replyTo) fields.push(['h:Reply-To', replyTo]);

  let body;
  let headers = { Authorization: 'Basic ' + Buffer.from('api:' + key).toString('base64') };
  const files = [];
  let total = 0;
  for (const a of attachments || []) {
    if (!a || !a.buffer) continue;
    if (total + a.buffer.length > MAX_ATTACHMENT_BYTES) continue;
    total += a.buffer.length;
    files.push(a);
  }
  if (files.length) {
    body = new FormData();
    fields.forEach(([k, v]) => body.append(k, v));
    files.forEach((a) => body.append('attachment', new Blob([a.buffer], { type: a.contentType || 'application/octet-stream' }), String(a.filename || 'attachment').slice(0, 200)));
  } else {
    const params = new URLSearchParams();
    fields.forEach(([k, v]) => params.append(k, v));
    body = params.toString();
    headers = { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' };
  }
  try {
    const r = await fetchImpl(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, { method: 'POST', headers, body });
    if (!r.ok) {
      console.error('[mail] Mailgun send failed', r.status);
      return { ok: false, status: r.status };
    }
    const data = await r.json().catch(() => ({}));
    return { ok: true, id: data.id || '', status: r.status };
  } catch (e) {
    console.error('[mail] Mailgun send error', e && e.message);
    return { ok: false, status: 0 };
  }
}

module.exports = { sendMail, labInbox, escHtml, MAILGUN_DOMAIN, MAILGUN_FROM };
