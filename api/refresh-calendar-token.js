function setCors(req, res) {
  const origin = String(req.headers.origin || '');
  const allowed =
    origin === 'https://dal-tracker.vercel.app' ||
    /^https:\/\/dal-tracker[a-z0-9-]*\.vercel\.app$/i.test(origin) ||
    /^http:\/\/localhost:\d+$/i.test(origin);
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : 'https://dal-tracker.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const refreshToken = req.body?.refreshToken;
  if (!refreshToken) {
    return res.status(400).json({ error: 'refreshToken is required' });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.REACT_APP_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.REACT_APP_GOOGLE_CLIENT_SECRET;
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
        error: data.error_description || data.error || 'Failed to refresh access token',
      });
    }
    return res.status(200).json({
      access_token: data.access_token,
      expires_in: data.expires_in,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to refresh access token' });
  }
};
