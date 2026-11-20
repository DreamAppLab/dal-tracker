// POST /api/auth/sign-in — called by Mission Control right after a fresh sign-in.
// Records the sign-in in auditLog and emails a sign-in alert through Mailgun.
// Replaces the old unauthenticated send-notification endpoint (Brevo is gone).
//
// Alert recipient: SIGNIN_ALERT_EMAIL (Vercel env) — ideally an inbox other
// than the one you sign in with. Falls back to the business mailbox.

const { withSecurity } = require('../_lib/security');
const { writeAuditSafe: writeAudit } = require('../_lib/audit');
const { ADMIN_EMAILS } = require('../_lib/allowlist');

const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || 'inbound.dreamapplab.com';
const MAILGUN_FROM = process.env.MAILGUN_FROM || 'Dream App Lab <lab@inbound.dreamapplab.com>';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function sendAlert(entry) {
  const key = process.env.MAILGUN_API_KEY;
  if (!key) return false;
  const to = process.env.SIGNIN_ALERT_EMAIL || ADMIN_EMAILS[0];
  const when = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  const params = new URLSearchParams();
  params.append('from', MAILGUN_FROM);
  params.append('to', to);
  params.append('subject', `Mission Control sign-in — ${when}`);
  params.append(
    'html',
    `<p>Mission Control was signed in to at <strong>${esc(when)}</strong> (Eastern).</p>
     <p>Account: ${esc(entry.actorEmail)}<br/>Method: ${esc(entry.meta.provider)}<br/>IP: ${esc(entry.ip)}<br/>Browser: ${esc(entry.userAgent)}</p>
     <p>If this was not you, change your password and revoke sessions in the Firebase console immediately.</p>`
  );
  const r = await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from('api:' + key).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  return r.ok;
}

module.exports = withSecurity(
  { name: 'auth-sign-in', methods: ['POST'], auth: 'admin', rateLimit: { limit: 10, windowMs: 60_000 } },
  async (req, res) => {
    const provider = (req.auth.firebase && req.auth.firebase.sign_in_provider) || 'unknown';
    const entry =
      (await writeAudit(
        { type: 'sign_in', actor: req.auth, target: null, meta: { provider, authTime: Number(req.auth.auth_time) || null } },
        req
      )) || { actorEmail: req.auth.email, meta: { provider }, ip: null, userAgent: null };
    let emailed = false;
    try {
      emailed = await sendAlert(entry);
    } catch (e) {
      console.error('sign-in alert failed:', e && e.message);
    }
    return res.status(200).json({ ok: true, emailed });
  }
);
