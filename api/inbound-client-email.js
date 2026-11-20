/*
  Mailgun inbound route (Mailgun dashboard → Receiving → Routes):
  - Filter: match_recipient("clients@inbound.dreamapplab.com") (the Reply-To on
    every client email Mission Control sends; lab@inbound.dreamapplab.com too)
  - Action: forward("https://dal-tracker.vercel.app/api/inbound-client-email")

  Every message is filed in Mission Control (thread reply, or the sender's
  contact) AND copied to lab@dreamapplab.com — see api/_lib/inboundEmail.js.
  Authenticity = Mailgun signature (fails closed).
*/

import security from './_lib/security';
import firebaseAdmin from './_lib/firebaseAdmin';
import mailgunWebhook from './_lib/mailgunWebhook';
import inboundEmail from './_lib/inboundEmail';

const { withSecurity } = security;
const { getMcDb } = firebaseAdmin;
const { verifyMailgunRequest } = mailgunWebhook;
const { handleInbound } = inboundEmail;

async function handler(req, res) {
  if (!req.body || typeof req.body !== 'object' || !(await verifyMailgunRequest(req.body))) {
    console.error('inbound-client-email: rejected (missing or invalid Mailgun signature)');
    return res.status(401).json({ error: 'Invalid signature' });
  }
  try {
    const result = await handleInbound(getMcDb(), req.body);
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
