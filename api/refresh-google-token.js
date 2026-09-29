/**
 * POST /api/refresh-google-token
 *
 * Body: { email: string }
 *
 * Reads the stored refresh_token from Firestore for the given calendar
 * account, exchanges it at Google's token endpoint for a fresh access_token,
 * writes the new access_token + tokenExpiry back to Firestore, and returns
 * them to the caller.
 *
 * On an unrecoverable failure (refresh_token revoked / missing) it sets
 * needsReconnect: true on the Firestore document so Mission Control can
 * surface a reconnect prompt.
 *
 * Required environment variables (Vercel):
 *   GOOGLE_CLIENT_ID              – OAuth 2.0 client ID (from Google Cloud Console)
 *   GOOGLE_CLIENT_SECRET          – OAuth 2.0 client secret
 *   FIREBASE_SERVICE_ACCOUNT_JSON – Full service-account JSON as a single string
 */

const admin = require('firebase-admin');

// ── Firebase Admin singleton ──────────────────────────────────────────────────

let adminApp = null;

function getDb() {
  if (!adminApp) {
    if (admin.apps.length > 0) {
      adminApp = admin.apps[0];
    } else {
      if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON environment variable is not set.');
      }
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      adminApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }
  }
  return admin.firestore(adminApp);
}

// ── Handler ───────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body || {};

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'A valid email is required.' });
  }

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.error('[refresh-google-token] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET');
    return res.status(500).json({ error: 'Server is not configured for token refresh.' });
  }

  let db;
  try {
    db = getDb();
  } catch (err) {
    console.error('[refresh-google-token] Firebase Admin init failed:', err.message);
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  const docRef = db.collection('connectedCalendars').doc(email);

  // ── Read stored refresh token ─────────────────────────────────────────────

  let storedData;
  try {
    const snap = await docRef.get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Calendar account not found.', needsReconnect: true });
    }
    storedData = snap.data();
  } catch (err) {
    console.error('[refresh-google-token] Firestore read failed:', err.message);
    return res.status(500).json({ error: 'Failed to read calendar record.' });
  }

  const { refreshToken } = storedData;

  if (!refreshToken) {
    // Account was connected before this fix was deployed — no refresh token on file.
    await docRef.update({ needsReconnect: true }).catch(() => {});
    return res.status(400).json({
      error: 'No refresh token stored for this account. Please reconnect your Google Calendar.',
      needsReconnect: true,
    });
  }

  // ── Exchange refresh token at Google ──────────────────────────────────────

  let tokenData;
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });
    tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      // Token was revoked or is otherwise invalid — this only happens when the
      // user manually revokes access in their Google account settings.
      console.warn(
        `[refresh-google-token] Google rejected refresh for ${email}: ${tokenData.error} – ${tokenData.error_description}`
      );
      await docRef.update({ needsReconnect: true }).catch(() => {});
      return res.status(401).json({
        error:
          tokenData.error_description ||
          'Google refresh token is no longer valid. Please reconnect your Google Calendar.',
        needsReconnect: true,
      });
    }
  } catch (err) {
    console.error('[refresh-google-token] Google token request failed:', err.message);
    return res.status(502).json({ error: 'Failed to reach Google token endpoint. Try again shortly.' });
  }

  // ── Persist new token back to Firestore ───────────────────────────────────

  const expiresInMs = (tokenData.expires_in || 3600) * 1000;
  const newExpiry = new Date(Date.now() + expiresInMs).toISOString();

  try {
    await docRef.update({
      accessToken: tokenData.access_token,
      tokenExpiry: newExpiry,
      needsReconnect: false,
      lastRefreshed: new Date().toISOString(),
    });
  } catch (err) {
    // Non-fatal: the token is still valid, the client can use it even if we
    // fail to write it back.
    console.error('[refresh-google-token] Firestore write failed:', err.message);
  }

  return res.status(200).json({
    accessToken: tokenData.access_token,
    tokenExpiry: newExpiry,
  });
};
