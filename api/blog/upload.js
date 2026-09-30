// Mission Control — upload blog images to dal-website-c9dd8 Storage
// POST /api/blog/upload — { filename, contentType, data (base64) }

const crypto = require('crypto');
const path = require('path');
const { initializeApp, getApp, cert } = require('firebase-admin/app');
const { getStorage } = require('firebase-admin/storage');

const MAX_BYTES = 2.5 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']);

let _siteApp = null;

function getSiteApp() {
  if (_siteApp) return _siteApp;

  const projectId = process.env.DAL_SITE_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.DAL_SITE_FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.DAL_SITE_FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const storageBucket =
    process.env.DAL_SITE_FIREBASE_STORAGE_BUCKET ||
    'dal-website-c9dd8.firebasestorage.app';

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing DAL_SITE Firebase env vars');
  }

  const appName = 'dalSiteAdmin';
  let app;
  try {
    app = getApp(appName);
  } catch (_) {
    app = initializeApp(
      { credential: cert({ projectId, clientEmail, privateKey }), projectId, storageBucket },
      appName
    );
  }

  _siteApp = app;
  return _siteApp;
}

function parseBody(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
}

function extFor(filename, contentType) {
  const fromName = path.extname(String(filename || '')).toLowerCase();
  if (fromName && fromName.length <= 5) return fromName;
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/gif') return '.gif';
  if (contentType === 'image/webp') return '.webp';
  return '.jpg';
}

module.exports.config = {
  api: { bodyParser: { sizeLimit: '4mb' } },
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = parseBody(req);
    const contentType = String(body.contentType || 'image/jpeg').toLowerCase();
    if (!ALLOWED.has(contentType)) {
      return res.status(400).json({ error: 'Use a JPG, PNG, GIF, or WebP image.' });
    }
    const raw = String(body.data || '');
    if (!raw) return res.status(400).json({ error: 'Image data is required' });
    const buffer = Buffer.from(raw, 'base64');
    if (!buffer.length) return res.status(400).json({ error: 'Image data is required' });
    if (buffer.length > MAX_BYTES) {
      return res.status(400).json({ error: 'Image must be 2.5MB or smaller.' });
    }

    const token = crypto.randomUUID();
    const objectPath = `blog-images/${Date.now()}-${crypto.randomUUID()}${extFor(body.filename, contentType)}`;
    const bucket = getStorage(getSiteApp()).bucket();
    const file = bucket.file(objectPath);
    await file.save(buffer, {
      resumable: false,
      metadata: {
        contentType,
        metadata: { firebaseStorageDownloadTokens: token },
      },
    });

    const encoded = encodeURIComponent(objectPath);
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encoded}?alt=media&token=${token}`;
    return res.status(200).json({ ok: true, url, path: objectPath });
  } catch (e) {
    console.error('blog upload api error', e);
    return res.status(500).json({
      error: 'Blog image upload failed',
      detail: String((e && e.message) || e),
    });
  }
};
