// Mission Control — blog posts proxy for dal-website-c9dd8
// GET  /api/blog/posts — all posts
// POST /api/blog/posts — create a post

const { initializeApp, getApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');

let _siteDb = null;

function getSiteDb() {
  if (_siteDb) return _siteDb;

  const projectId = process.env.DAL_SITE_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.DAL_SITE_FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.DAL_SITE_FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing DAL_SITE Firebase env vars');
  }

  const appName = 'dalSiteAdmin';
  let app;
  try {
    app = getApp(appName);
  } catch (_) {
    app = initializeApp(
      { credential: cert({ projectId, clientEmail, privateKey }) },
      appName
    );
  }

  _siteDb = getFirestore(app);
  return _siteDb;
}

function serializeValue(value) {
  if (value == null) return value;
  if (typeof value.toDate === 'function') {
    try {
      return value.toDate().toISOString();
    } catch (_) {
      return null;
    }
  }
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000).toISOString();
  }
  if (typeof value === 'object' && typeof value._seconds === 'number') {
    return new Date(value._seconds * 1000).toISOString();
  }
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach((key) => {
      out[key] = serializeValue(value[key]);
    });
    return out;
  }
  return value;
}

function serializeDoc(docSnap) {
  return { id: docSnap.id, ...serializeValue(docSnap.data() || {}) };
}

function parseBody(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
}

function toTimestamp(value) {
  if (value == null || value === '') return null;
  if (typeof value.toDate === 'function') return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : Timestamp.fromDate(d);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const db = getSiteDb();
    const col = db.collection('posts');

    if (req.method === 'GET') {
      const snap = await col.get();
      const posts = snap.docs.map(serializeDoc);
      return res.status(200).json({ ok: true, posts });
    }

    if (req.method === 'POST') {
      const body = parseBody(req);
      const now = FieldValue.serverTimestamp();
      const data = {
        title: typeof body.title === 'string' ? body.title : '',
        content: typeof body.content === 'string' ? body.content : '',
        status: body.status || 'draft',
        source: body.source || 'manual',
        createdAt: now,
        updatedAt: now,
      };
      if (body.scheduledAt) {
        const scheduled = toTimestamp(body.scheduledAt);
        if (scheduled) data.scheduledAt = scheduled;
      }
      const ref = await col.add(data);
      const created = await ref.get();
      return res.status(200).json({ ok: true, post: serializeDoc(created) });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('blog posts api error', e);
    return res.status(500).json({
      error: 'Blog posts request failed',
      detail: String((e && e.message) || e),
    });
  }
};
