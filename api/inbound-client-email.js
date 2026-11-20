/*
  Mailgun inbound route (Mailgun dashboard → Receiving → Routes):
  - Filter: match_recipient("clients@inbound.dreamapplab.com") (the Reply-To on
    every client email Mission Control sends; lab@inbound.dreamapplab.com too)
  - Action: forward("https://dal-tracker.vercel.app/api/inbound-client-email")

  Every message is filed in Mission Control (thread reply, or the verified
  sender's contact) AND copied with attachments to lab@dreamapplab.com — see
  api/_lib/inboundEmail.js. Authenticity = Mailgun signature (fails closed).
*/

import security from './_lib/security';
import firebaseAdmin from './_lib/firebaseAdmin';
import mailgunWebhook from './_lib/mailgunWebhook';
import inboundEmail from './_lib/inboundEmail';
import inboundForm from './_lib/inboundForm';

// Mailgun posts multipart/form-data when the email has attachments; parse it ourselves.
export const config = { api: { bodyParser: false } };

const { withSecurity } = security;
const { getMcDb } = firebaseAdmin;
const { verifyMailgunRequest } = mailgunWebhook;
const { handleInbound } = inboundEmail;
const { parseInboundForm } = inboundForm;

async function handler(req, res) {
  let parsed;
  try {
    parsed = await parseInboundForm(req);
  } catch (e) {
    console.error('inbound-client-email: could not parse body:', e && e.message);
    return res.status(400).json({ error: 'Invalid body' });
  }
  if (!(await verifyMailgunRequest(parsed.body))) {
    console.error('inbound-client-email: rejected (missing or invalid Mailgun signature)');
    return res.status(401).json({ error: 'Invalid signature' });
  }
  try {
    const result = await handleInbound(getMcDb(), parsed.body, { attachments: parsed.attachments });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('inbound-client-email error:', err && err.message);
    return res.status(500).json({ error: 'Inbound processing failed' });
  }
}

// Server-to-server (Mailgun route): no CORS; authenticity = Mailgun signature.
export default withSecurity(
  { name: 'inbound-client-email', methods: ['POST'], auth: 'public', cors: 'none', rateLimit: { limit: 60, windowMs: 60_000 } },
  handler
);
