module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { to, body } = req.body || {};

  if (!to || !body) {
    return res.status(400).json({ error: 'Missing required fields: to, body' });
  }

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
    return res.status(500).json({ error: error.message, success: false });
  }
};
