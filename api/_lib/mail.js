// Outbound email via Mailgun (domain inbound.dreamapplab.com).
// Server-only: MAILGUN_API_KEY never leaves api/.

const MAILGUN_DOMAIN = 'inbound.dreamapplab.com';
const MAILGUN_FROM = 'Dream App Lab <lab@inbound.dreamapplab.com>';

// Where every copy of client mail lands (override with LAB_INBOX for testing).
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
 * Send one email. Returns { ok, id } and never throws on provider errors
 * (callers decide whether a failed send matters).
 */
async function sendMail({ to, subject, html, text, replyTo, fetchImpl = fetch }) {
  const key = process.env.MAILGUN_API_KEY;
  if (!key) {
    console.error('[mail] MAILGUN_API_KEY not configured');
    return { ok: false, status: 0 };
  }
  const params = new URLSearchParams();
  params.append('from', MAILGUN_FROM);
  params.append('to', to);
  params.append('subject', String(subject || '').slice(0, 900));
  if (html) params.append('html', html);
  if (text) params.append('text', text);
  if (replyTo) params.append('h:Reply-To', replyTo);
  try {
    const r = await fetchImpl(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from('api:' + key).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    if (!r.ok) {
      console.error('[mail] Mailgun send failed', r.status);
      return { ok: false, status: r.status };
    }
    const data = await r.json().catch(() => ({}));
    return { ok: true, id: data.id || '' };
  } catch (e) {
    console.error('[mail] Mailgun send error', e && e.message);
    return { ok: false, status: 0 };
  }
}

module.exports = { sendMail, labInbox, escHtml, MAILGUN_DOMAIN, MAILGUN_FROM };
