// Mission Control Books (ledger) — server-only actions.
//   POST /api/ledger/unreconcile  { companyId, reconciliationId }
//        Undo a finished reconciliation. Reconciled rows are locked by
//        firestore.rules (no browser can unlock them), so this is the ONLY way
//        to unlock: it writes the audit entry first (strict), then flips the
//        rows back to "cleared" and marks the reconciliation "undone".
//   POST /api/ledger/receipt      { companyId, txnId, name, type, base64 }
//        Attach a receipt (PDF/image) to a transaction. Only the storage path
//        is stored; links are issued on demand by receipt-url (10 minutes).
//   POST /api/ledger/receipt-url  { companyId, txnId }
//   POST /api/ledger/migrate      { mode: 'dry-run' | 'apply' | 'rollback' }
//        Move the retired `expenses` collection into the ledger (backup
//        first, idempotent, audit-logged). See api/_lib/ledgerMigration.js.
//   POST /api/ledger/rebuild      { companyId }
//        Recompute the cached monthly aggregates from the transactions.
// One function (rewritten from /api/ledger/:path* in vercel.json).

const { z } = require('zod');
const { FieldValue } = require('firebase-admin/firestore');
const { withSecurity, parseJsonBody, validate, HttpError, requireRecentAuth } = require('./_lib/security');
const { writeAudit } = require('./_lib/audit');
const { getMcDb, getMcBucket } = require('./_lib/firebaseAdmin');
const { migrateExpenses, rebuildMonthly } = require('./_lib/ledgerMigration');

const companyId = z.enum(['dal', 'zerbiq']);
const docId = z.string().regex(/^[A-Za-z0-9_-]{3,160}$/);

const UnreconcileSchema = z.object({ companyId, reconciliationId: docId }).strict();
const ReceiptUrlSchema = z.object({ companyId, txnId: docId }).strict();
// Unlocking reconciled books and rolling back the migration need a sign-in
// from the last 15 minutes (CLAUDE.md rule 7); apiFetch() prompts for it.
const RECENT_AUTH_SECONDS = 15 * 60;

const RECEIPT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif'];
const ReceiptSchema = z
  .object({
    companyId,
    txnId: docId,
    name: z.string().trim().min(1).max(160),
    type: z.enum(RECEIPT_TYPES),
    base64: z.string().min(4).max(4_200_000),
  })
  .strict();

const MigrateSchema = z.object({ mode: z.enum(['dry-run', 'apply', 'rollback', 'settle', 'projects', 'legacy-report', 'legacy-notes', 'legacy-notes-undo', 'personal-preview', 'personal-move', 'personal-undo']), as: z.enum(['equity', 'owner']).optional(),
  // Card-statement cut-over for "Card payments before Books" (null clears it).
  cutoff: z.union([z.null(), z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), owedCents: z.number().int().min(0).max(1e10) }).strict()]).optional() }).strict();
const RebuildSchema = z.object({ companyId }).strict();

async function migrate(req, res) {
  const { mode, as, cutoff } = validate(MigrateSchema, parseJsonBody(req, { maxBytes: 1024 }));
  // Apply is additive, backed up and idempotent; rollback removes rows.
  if (mode === 'rollback') requireRecentAuth(req.auth, RECENT_AUTH_SECONDS);
  const db = getMcDb();
  if (mode !== 'dry-run' && mode !== 'legacy-report' && mode !== 'personal-preview') {
    // Strict audit before any write.
    await writeAudit({ type: 'ledger_migration', actor: req.auth, target: 'expenses', meta: { mode, ...(as ? { as } : {}), ...(cutoff !== undefined ? { cutoffDate: cutoff ? cutoff.date : 'none', cutoffOwedCents: cutoff ? cutoff.owedCents : 0 } : {}) } }, req);
  }
  try {
    const summary = await migrateExpenses(db, { mode, as, cutoff, getBucket: getMcBucket });
    return res.status(200).json({ ok: true, summary });
  } catch (e) {
    if (e && e.status) throw new HttpError(e.status, e.message);
    throw e;
  }
}

async function rebuild(req, res) {
  const body = validate(RebuildSchema, parseJsonBody(req, { maxBytes: 1024 }));
  const result = await rebuildMonthly(getMcDb(), body.companyId);
  await writeAudit({ type: 'ledger_update', actor: req.auth, target: `ledgerMonthly/${body.companyId}`, meta: { action: 'rebuild', months: result.months } }, req).catch(() => null);
  return res.status(200).json({ ok: true, result });
}

function routeOf(req) {
  const url = String(req.url || '').split('?')[0];
  const m = url.match(/\/api\/ledger\/([a-z-]+)\/?$/);
  return m ? m[1] : '';
}

// Rows locked by a reconciliation whose record was never written (a finish
// interrupted midway) can still be unlocked, so books never stay stuck.
async function unlockOrphans(req, res, db, body) {
  const rows = await db.collection('ledgerTransactions').where('reconciliationId', '==', body.reconciliationId).get();
  const docs = rows.docs.filter((d) => d.data().companyId === body.companyId && d.data().status === 'reconciled');
  if (!docs.length) throw new HttpError(404, 'Reconciliation not found');
  await writeAudit({ type: 'ledger_unreconcile', actor: req.auth, target: `ledgerReconciliations/${body.reconciliationId}`, meta: { companyId: body.companyId, rows: docs.length, orphaned: true } }, req);
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    docs.slice(i, i + 400).forEach((d) => batch.update(d.ref, { status: 'cleared', reconciliationId: null, updatedAt: FieldValue.serverTimestamp() }));
    await batch.commit();
  }
  return res.status(200).json({ ok: true, rows: docs.length, orphaned: true });
}

async function unreconcile(req, res) {
  const body = validate(UnreconcileSchema, parseJsonBody(req, { maxBytes: 4 * 1024 }));
  if (!body.reconciliationId.startsWith(`${body.companyId}_`)) throw new HttpError(400, 'Reconciliation does not belong to this company');
  requireRecentAuth(req.auth, RECENT_AUTH_SECONDS);
  const db = getMcDb();
  const recRef = db.collection('ledgerReconciliations').doc(body.reconciliationId);
  const snap = await recRef.get();
  if (!snap.exists) return unlockOrphans(req, res, db, body);
  const rec = snap.data();
  if (rec.companyId !== body.companyId) throw new HttpError(400, 'Reconciliation does not belong to this company');
  if (rec.status !== 'complete') throw new HttpError(409, 'This reconciliation was already undone');

  // Only the most recent statement can be undone, so starting balances keep chaining.
  const sameAccount = await db.collection('ledgerReconciliations').where('accountId', '==', rec.accountId).get();
  const later = sameAccount.docs
    .map((d) => d.data())
    .filter((r) => r.companyId === body.companyId && r.status === 'complete' && r.statementDate > rec.statementDate);
  if (later.length) throw new HttpError(409, 'Undo the later reconciliation for this account first');

  const rows = await db.collection('ledgerTransactions').where('reconciliationId', '==', body.reconciliationId).get();
  const docs = rows.docs.filter((d) => {
    const t = d.data();
    return t.companyId === body.companyId && t.accountId === rec.accountId && t.status === 'reconciled';
  });

  // Strict audit BEFORE unlocking: if this fails, nothing is unlocked.
  await writeAudit(
    {
      type: 'ledger_unreconcile',
      actor: req.auth,
      target: `ledgerReconciliations/${body.reconciliationId}`,
      meta: { companyId: body.companyId, accountId: rec.accountId, statementDate: rec.statementDate, rows: docs.length },
    },
    req
  );

  const CHUNK = 400;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = db.batch();
    docs.slice(i, i + CHUNK).forEach((d) => {
      batch.update(d.ref, { status: 'cleared', reconciliationId: null, updatedAt: FieldValue.serverTimestamp() });
    });
    if (i + CHUNK >= docs.length) {
      batch.update(recRef, {
        status: 'undone',
        undoneAt: FieldValue.serverTimestamp(),
        undoneBy: (req.auth && req.auth.email) || null,
      });
    }
    await batch.commit();
  }
  if (!docs.length) {
    await recRef.update({ status: 'undone', undoneAt: FieldValue.serverTimestamp(), undoneBy: (req.auth && req.auth.email) || null });
  }
  return res.status(200).json({ ok: true, rows: docs.length });
}

function safeName(name) {
  return String(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'receipt';
}

async function receipt(req, res) {
  const body = validate(ReceiptSchema, parseJsonBody(req, { maxBytes: 4_400_000 }));
  if (!body.txnId.startsWith(`${body.companyId}_`)) throw new HttpError(400, 'Transaction does not belong to this company');
  const buf = Buffer.from(body.base64, 'base64');
  if (!buf.length || buf.length > 3 * 1024 * 1024) throw new HttpError(400, 'Receipt must be 3 MB or smaller');
  const db = getMcDb();
  const ref = db.collection('ledgerTransactions').doc(body.txnId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, 'Transaction not found');
  const t = snap.data();
  if (t.companyId !== body.companyId) throw new HttpError(400, 'Transaction does not belong to this company');
  const path = `ledgerReceipts/${body.companyId}/${body.txnId}/${Date.now()}-${safeName(body.name)}`;
  const file = getMcBucket().file(path);
  await file.save(buf, { contentType: body.type, resumable: false });
  await ref.update({ attachmentPath: path, updatedAt: FieldValue.serverTimestamp() });
  await writeAudit({ type: 'sensitive_update', actor: req.auth, target: `ledgerTransactions/${body.txnId}`, meta: { action: 'receipt_attached', companyId: body.companyId } }, req).catch(() => null);
  return res.status(200).json({ ok: true, attachmentPath: path });
}

/** The object path inside an old signed receipt URL, if it is this expense's own file. */
function legacyReceiptPath(url, legacyId) {
  try {
    const u = new URL(String(url));
    const parts = u.pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p));
    const i = parts.indexOf('expenses');
    if (i < 0 || parts[i + 1] !== legacyId || parts.length !== i + 3) return null;
    const file = parts[i + 2];
    if (!file || file === '.' || file === '..' || /[\\/]/.test(file)) return null;
    return `expenses/${legacyId}/${file}`;
  } catch (_) {
    return null;
  }
}

async function receiptUrl(req, res) {
  const body = validate(ReceiptUrlSchema, parseJsonBody(req, { maxBytes: 1024 }));
  if (!body.txnId.startsWith(`${body.companyId}_`)) throw new HttpError(400, 'Transaction does not belong to this company');
  const snap = await getMcDb().collection('ledgerTransactions').doc(body.txnId).get();
  if (!snap.exists) throw new HttpError(404, 'Transaction not found');
  const t = snap.data();
  if (t.companyId !== body.companyId) throw new HttpError(404, 'No receipt');
  const prefix = `ledgerReceipts/${body.companyId}/${body.txnId}/`;
  let path = t.attachmentPath && String(t.attachmentPath).startsWith(prefix) ? t.attachmentPath : null;
  if (!path && !t.attachmentPath && t.attachmentUrl && t.source === 'migration' && t.legacyExpenseId && /^[A-Za-z0-9_-]{1,120}$/.test(t.legacyExpenseId)) {
    // Receipts from the old Expenses tab: stored at expenses/<id>/<file>. Their
    // saved links were long-lived signed URLs; issue a fresh short one instead.
    path = legacyReceiptPath(t.attachmentUrl, t.legacyExpenseId);
    if (!path) {
      const [files] = await getMcBucket().getFiles({ prefix: `expenses/${t.legacyExpenseId}/`, maxResults: 1 });
      if (files.length) path = files[0].name;
    }
  }
  if (!path) throw new HttpError(404, 'No receipt');
  const [url] = await getMcBucket().file(path).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + 10 * 60 * 1000 });
  return res.status(200).json({ ok: true, url });
}

module.exports = withSecurity(
  { name: 'ledger', methods: ['POST'], auth: 'admin', rateLimit: { limit: 60, windowMs: 60_000 } },
  async (req, res) => {
    const route = routeOf(req);
    if (route === 'unreconcile') return unreconcile(req, res);
    if (route === 'receipt') return receipt(req, res);
    if (route === 'receipt-url') return receiptUrl(req, res);
    if (route === 'migrate') return migrate(req, res);
    if (route === 'rebuild') return rebuild(req, res);
    throw new HttpError(404, 'Not found');
  }
);

module.exports.routeOf = routeOf;
module.exports.legacyReceiptPath = legacyReceiptPath;
