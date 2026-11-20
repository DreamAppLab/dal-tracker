// Mission Control — cascade-delete a project, its subcollections, and Storage files.
// POST /api/delete-project  { id }
// Uses the dal-mission-control service account (DAL_MC_FIREBASE_* env vars).

const shared = require('./_lib/firebaseAdmin');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');


function getMcApp() {
  return shared.getMcApp();
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

const { withSecurity } = require('./_lib/security');
const { writeAuditSafe: writeAudit } = require('./_lib/audit');

module.exports = withSecurity({ name: 'delete-project', methods: ['POST'], auth: 'admin', recentAuthSeconds: 15 * 60 }, async (req, res) => {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const id = String((req.query && req.query.id) || body.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Project id is required' });
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
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
    await writeAudit({ type: 'delete', actor: req.auth, target: `projects/${id}`, meta: { storageDeleted } }, req);

    return res.status(200).json({ ok: true, id, storageDeleted });
  } catch (e) {
    console.error('delete-project error', e);
    return res.status(500).json({
      error: 'Failed to delete project',
    });
  }
});
