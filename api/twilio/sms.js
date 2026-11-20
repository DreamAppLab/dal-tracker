const { z } = require('zod');
const { withSecurity, parseJsonBody, validate } = require('../_lib/security');

const SmsSchema = z.object({
  to: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, 'E.164 phone number required'),
  body: z.string().trim().min(1).max(1600),
});

module.exports = withSecurity({ name: 'twilio-sms', methods: ['POST'], auth: 'admin', rateLimit: { limit: 20, windowMs: 60_000 } }, async function handler(req, res) {
  const { to, body } = validate(SmsSchema, parseJsonBody(req));

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !from) {
    return res.status(500).json({ error: 'Twilio credentials not configured' });
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const twilioRes = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    });

    const data = await twilioRes.json().catch(() => ({}));

    if (!twilioRes.ok) {
      const message = data.message || data.error_message || `Twilio error (${twilioRes.status})`;
      return res.status(twilioRes.status).json({ error: message, success: false });
    }

    return res.status(200).json({ success: true, sid: data.sid });
  } catch (error) {
    console.error('twilio send failed:', error && error.message);
    return res.status(502).json({ error: 'SMS send failed', success: false });
  }
});
