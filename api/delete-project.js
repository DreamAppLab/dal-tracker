// Mission Control — cascade-delete a project, its subcollections, and Storage files.
// POST /api/delete-project  { id }
// Uses the dal-mission-control service account (DAL_MC_FIREBASE_* env vars).

const { initializeApp, getApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

let _mcApp = null;

function getMcApp() {
  if (_mcApp) return _mcApp;

  const projectId = process.env.DAL_MC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.DAL_MC_FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.DAL_MC_FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const storageBucket =
    process.env.DAL_MC_FIREBASE_STORAGE_BUCKET ||
    (projectId ? projectId + '.firebasestorage.app' : '');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing DAL_MC Firebase env vars');
  }

  const appName = 'dalMcAdmin';
  let app;
  try {
    app = getApp(appName);
  } catch (_) {
    app = initializeApp(
      {
        credential: cert({ projectId, clientEmail, privateKey }),
        projectId,
        storageBucket,
      },
      appName
    );
  }

  _mcApp = app;
  return _mcApp;
}

async function deleteDocumentTree(docRef) {
  const collections = await docRef.listCollections();
  for (const col of collections) {
    const children = await col.listDocuments();
    for (const child of children) {
      await deleteDocumentTree(child);
    }
  }
  await docRef.delete();
}

async function deleteStoragePrefix(bucket, prefix) {
  try {
    const [files] = await bucket.getFiles({ prefix });
    if (!files.length) return 0;
    await Promise.all(files.map((file) => file.delete().catch(() => null)));
    return files.length;
  } catch (err) {
    console.error('storage cleanup failed for', prefix, err);
    return 0;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const id = String((req.query && req.query.id) || body.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Project id is required' });
    if (id.includes('/') || id.includes('..')) {
      return res.status(400).json({ error: 'Invalid project id' });
    }

    const app = getMcApp();
    const db = getFirestore(app);
    const projectRef = db.collection('projects').doc(id);
    const existing = await projectRef.get();
    if (!existing.exists) return res.status(404).json({ error: 'Project not found' });

    let storageDeleted = 0;
    try {
      const bucket = getStorage(app).bucket();
      storageDeleted += await deleteStoragePrefix(bucket, 'projects/' + id + '/');
      storageDeleted += await deleteStoragePrefix(bucket, 'vault/' + id + '/');
      storageDeleted += await deleteStoragePrefix(bucket, 'blackbox/' + id + '/');
    } catch (err) {
      console.error('storage bucket init failed', err);
    }

    await deleteDocumentTree(projectRef);

    return res.status(200).json({ ok: true, id, storageDeleted });
  } catch (e) {
    console.error('delete-project error', e);
    return res.status(500).json({
      error: 'Failed to delete project',
      detail: String((e && e.message) || e),
    });
  }
};
