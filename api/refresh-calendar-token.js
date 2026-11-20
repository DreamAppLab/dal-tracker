const { z } = require('zod');
const { withSecurity, parseJsonBody, validate } = require('./_lib/security');

const Schema = z.object({ refreshToken: z.string().min(10).max(2048) });

module.exports = withSecurity({ name: 'refresh-calendar-token', methods: ['POST'], auth: 'admin' }, async function handler(req, res) {
  const { refreshToken } = validate(Schema, parseJsonBody(req));

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'Google OAuth client is not configured' });
  }

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
      return res.status(response.ok ? 500 : response.status).json({
        error: data.error || 'Failed to refresh access token',
      });
    }
    return res.status(200).json({
      access_token: data.access_token,
      expires_in: data.expires_in,
    });
  } catch (err) {
    console.error('refresh-calendar-token failed:', err && err.message);
    return res.status(502).json({ error: 'Failed to refresh access token' });
  }
});
