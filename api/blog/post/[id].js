// Mission Control — single blog post proxy for dal-website-c9dd8
// PATCH  /api/blog/post/[id] — update a post
// DELETE /api/blog/post/[id] — delete a post

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
    const storageBucket =
      process.env.DAL_SITE_FIREBASE_STORAGE_BUCKET ||
      (projectId ? projectId + '.firebasestorage.app' : '');
    app = initializeApp(
      { credential: cert({ projectId, clientEmail, privateKey }), projectId, storageBucket },
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

function prepareUpdate(body) {
  const update = {};
  const allowed = [
    'title',
    'content',
    'body',
    'status',
    'source',
    'slug',
    'featuredImage',
    'category',
    'tags',
    'metaTitle',
    'metaDescription',
    'publishedAt',
  ];
  allowed.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(body, key)) update[key] = body[key];
  });
  if (Object.prototype.hasOwnProperty.call(update, 'body') && !Object.prototype.hasOwnProperty.call(update, 'content')) {
    update.content = update.body;
  }
  if (Object.prototype.hasOwnProperty.call(update, 'content') && !Object.prototype.hasOwnProperty.call(update, 'body')) {
    update.body = update.content;
  }
  if (Object.prototype.hasOwnProperty.call(update, 'tags') && !Array.isArray(update.tags)) {
    update.tags = String(update.tags || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }
  if (Object.prototype.hasOwnProperty.call(update, 'publishedAt')) {
    const published = toTimestamp(update.publishedAt);
    update.publishedAt = published || FieldValue.serverTimestamp();
  }
  if (Object.prototype.hasOwnProperty.call(body, 'scheduledAt')) {
    if (body.scheduledAt == null || body.scheduledAt === '') {
      update.scheduledAt = FieldValue.delete();
    } else {
      const scheduled = toTimestamp(body.scheduledAt);
      if (scheduled) update.scheduledAt = scheduled;
    }
  }
  update.updatedAt = FieldValue.serverTimestamp();
  return update;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const id = String((req.query && req.query.id) || '').trim();
    if (!id) return res.status(400).json({ error: 'Post id is required' });

    const db = getSiteDb();
    const ref = db.collection('posts').doc(id);

    if (req.method === 'PATCH') {
      const existing = await ref.get();
      if (!existing.exists) return res.status(404).json({ error: 'Post not found' });
      const body = parseBody(req);
      const update = prepareUpdate(body);
      const prev = existing.data() || {};
      if (update.status === 'published' && (!prev.publishedAt || Object.prototype.hasOwnProperty.call(body, 'publishedAt'))) {
        update.publishedAt = FieldValue.serverTimestamp();
      }
      await ref.update(update);
      const updated = await ref.get();
      return res.status(200).json({ ok: true, post: serializeDoc(updated) });
    }

    if (req.method === 'DELETE') {
      const existing = await ref.get();
      if (!existing.exists) return res.status(404).json({ error: 'Post not found' });
      await ref.delete();
      return res.status(200).json({ ok: true, id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('blog post api error', e);
    return res.status(500).json({
      error: 'Blog post request failed',
      detail: String((e && e.message) || e),
    });
  }
};
