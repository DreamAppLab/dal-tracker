// GET /api/familythread-admin — server-side proxy to FamilyThread's getAdminData
// Cloud Function. The shared admin secret lives only in the FT_ADMIN_SECRET
// Vercel env var (it used to ship to the browser as REACT_APP_FT_ADMIN_SECRET).

const { withSecurity } = require('./_lib/security');

const ADMIN_DATA_URL = 'https://us-central1-familythread-prod.cloudfunctions.net/getAdminData';

module.exports = withSecurity(
  { name: 'familythread-admin', methods: ['GET'], auth: 'admin', rateLimit: { limit: 30, windowMs: 60_000 } },
  async (req, res) => {
    const secret = process.env.FT_ADMIN_SECRET;
    if (!secret) return res.status(503).json({ error: 'FamilyThread admin is not configured (FT_ADMIN_SECRET)' });
    const upstream = await fetch(ADMIN_DATA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret },
    });
    if (!upstream.ok) {
      console.error('familythread getAdminData failed', upstream.status);
      return res.status(502).json({ error: `FamilyThread admin data request failed (${upstream.status})` });
    }
    const data = await upstream.json();
    return res.status(200).json(data);
  }
);
