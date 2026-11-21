// Ledger maintenance jobs run with the Admin SDK (server or CLI):
//   - migrateExpenses: retired `expenses` → DAL credit-card ledger transactions
//       dry-run  : report what would happen, write nothing
//       apply    : back up first (ledgerMigrationBackups/{runId}, server-only),
//                  seed default accounts/categories/rules if missing, write
//                  missing dal_mig_* transactions, carry over imported
//                  statement fingerprints, rebuild monthly aggregates, verify
//       rollback : delete dal_mig_* transactions + legacy import fingerprints,
//                  rebuild aggregates (legacy `expenses` were never modified)
//   - rebuildMonthly: recompute ledgerMonthly for one company from scratch
// Idempotent: re-running apply writes nothing new.

const { FieldValue } = require('firebase-admin/firestore');
const core = require('../../src/ledger/core');

const CHUNK = 400;

async function commitInChunks(db, ops) {
  for (let i = 0; i < ops.length; i += CHUNK) {
    const batch = db.batch();
    ops.slice(i, i + CHUNK).forEach((op) => op(batch));
    await batch.commit();
  }
}

async function readAll(db, name) {
  const snap = await db.collection(name).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function readCompany(db, name, companyId) {
  const snap = await db.collection(name).where('companyId', '==', companyId).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Create default accounts / categories / vendor rules that do not exist yet (never overwrites edits). */
async function seedDefaults(db, companyId, opening) {
  const existing = {
    ledgerAccounts: new Set((await readCompany(db, 'ledgerAccounts', companyId)).map((d) => d.id)),
    ledgerCategories: new Set((await readCompany(db, 'ledgerCategories', companyId)).map((d) => d.id)),
    ledgerVendorRules: new Set((await readCompany(db, 'ledgerVendorRules', companyId)).map((d) => d.id)),
  };
  const ops = [];
  const add = (col, docs) => docs.forEach(({ id, data }) => {
    if (existing[col].has(id)) return;
    ops.push((b) => b.set(db.collection(col).doc(id), { ...data, createdAt: FieldValue.serverTimestamp() }));
  });
  add('ledgerAccounts', core.defaultAccountDocs(companyId, opening));
  add('ledgerCategories', core.defaultCategoryDocs(companyId));
  add('ledgerVendorRules', core.defaultRuleDocs(companyId));
  await commitInChunks(db, ops);
  return ops.length;
}

/** Recompute every ledgerMonthly doc for a company from its transactions. */
async function rebuildMonthly(db, companyId) {
  const txns = await readCompany(db, 'ledgerTransactions', companyId);
  const fresh = core.rebuildMonthly(txns);
  const current = await readCompany(db, 'ledgerMonthly', companyId);
  const ops = [];
  for (const [id, d] of Object.entries(fresh)) {
    if (d.companyId !== companyId) continue;
    ops.push((b) => b.set(db.collection('ledgerMonthly').doc(id), { companyId, month: d.month, acct: d.acct, cat: d.cat, count: d.count, rebuiltAt: FieldValue.serverTimestamp() }));
  }
  for (const m of current) {
    if (!fresh[m.id]) ops.push((b) => b.set(db.collection('ledgerMonthly').doc(m.id), { companyId, month: m.month, acct: {}, cat: {}, count: 0, rebuiltAt: FieldValue.serverTimestamp() }));
  }
  await commitInChunks(db, ops);
  return { months: Object.keys(fresh).length, transactions: txns.length };
}

function accountsAndCategories(accountDocs, categoryDocs) {
  const accounts = {};
  const categories = {};
  for (const c of core.COMPANY_IDS) {
    core.defaultAccountDocs(c).forEach((a) => { accounts[a.id] = a.data; });
    core.defaultCategoryDocs(c).forEach((x) => { categories[x.id] = x.data; });
  }
  accountDocs.forEach((a) => { accounts[a.id] = a; });
  categoryDocs.forEach((x) => { categories[x.id] = x; });
  return { accounts, categories };
}

function legacyTotalCents(expenses, errorIds) {
  return expenses.filter((e) => !errorIds.has(e.id)).reduce((s, e) => s + core.dollarsToCents(e.amount), 0);
}

/**
 * Clear the migrated card history with "Card payments before Books" entries
 * (see core.planHistoricalPayments). as: 'owner' (default — the old card
 * bills were paid from the owner's personal money: Owner contribution) or
 * 'equity' (Opening balance equity, for money from accounts not in Books).
 * The choice is remembered on the card account so re-runs keep it.
 */
async function settleHistory(db, opts) {
  const cardRef = db.collection('ledgerAccounts').doc(core.ACCOUNT);
  const cardSnap = await cardRef.get();
  if (!cardSnap.exists) return { months: 0, totalCents: 0, skipped: 'no card account' };
  const card = cardSnap.data();
  const as = (opts && opts.as) || card.historicalPaymentsAs || 'owner';
  const slug = as === 'owner' ? 'owner_contribution' : 'opening_equity';
  const categoryId = core.ids.category(core.COMPANY, slug);
  const catRef = db.collection('ledgerCategories').doc(categoryId);
  if (!(await catRef.get()).exists) {
    const def = core.defaultCategoryDocs(core.COMPANY).find((d) => d.id === categoryId);
    await catRef.set({ ...def.data, createdAt: FieldValue.serverTimestamp() });
  }
  const dalTxns = await readCompany(db, 'ledgerTransactions', core.COMPANY);
  const zerbiqTxns = await readCompany(db, 'ledgerTransactions', 'zerbiq');
  // Only the main entries are ours; legs/mirrors (if a user re-booked one) are derived.
  const existing = dalTxns.filter((t) => t.source === core.HISTORICAL_SOURCE && (t.role || 'main') === 'main');
  const plan = core.planHistoricalPayments(dalTxns, existing, categoryId);
  const allById = Object.fromEntries([...dalTxns, ...zerbiqTxns].map(({ id, ...d }) => [id, d]));
  const { accounts, categories } = accountsAndCategories(
    [...(await readCompany(db, 'ledgerAccounts', 'dal')), ...(await readCompany(db, 'ledgerAccounts', 'zerbiq'))],
    [...(await readCompany(db, 'ledgerCategories', 'dal')), ...(await readCompany(db, 'ledgerCategories', 'zerbiq'))]
  );
  const ops = [];
  const errors = [];
  const applyPlan = (p) => {
    p.sets.forEach(({ id: docId, data }) => ops.push((b) => b.set(db.collection('ledgerTransactions').doc(docId), { ...data, updatedAt: FieldValue.serverTimestamp() }, { merge: true })));
    p.deletes.forEach(({ id: docId }) => ops.push((b) => b.delete(db.collection('ledgerTransactions').doc(docId))));
  };
  for (const { id, draft } of plan.upserts) {
    const before = allById[id] || null;
    try {
      // These entries are system-managed: re-running restores them (undeletes,
      // and resets a category/transfer someone edited), keeping only their
      // cleared/reconciled state. Linked legs/mirrors are removed by the planner.
      const full = before
        ? { ...before, ...draft, transferAccountId: null, icCategoryId: null, splits: [], deleted: false, status: before.status, reconciliationId: before.reconciliationId || null }
        : draft;
      applyPlan(core.planTransactionWrite({ id, draft: full, before, existing: allById, accounts, categories }));
    } catch (e) {
      errors.push({ id, error: e.message });
    }
  }
  for (const id of plan.deleteIds) {
    try {
      applyPlan(core.planTransactionWrite({ id, draft: null, before: allById[id], existing: allById, accounts, categories }));
    } catch (e) {
      errors.push({ id, error: e.message });
    }
  }
  await commitInChunks(db, ops);
  await cardRef.set({ historicalPaymentsAs: as }, { merge: true });
  return { as, months: plan.months, totalCents: plan.totalCents, removed: plan.deleteIds.length, errors };
}

/** Create projects from the migrated rows' old app tags and tag those rows (idempotent). */
async function linkLegacyProjects(db) {
  const txns = await readCompany(db, 'ledgerTransactions', core.COMPANY);
  const existing = await readCompany(db, 'ledgerProjects', core.COMPANY);
  const plan = core.planLegacyProjects(txns, existing);
  await commitInChunks(db, [
    ...plan.create.map(({ id, data }) => (b) => b.set(db.collection('ledgerProjects').doc(id), { ...data, createdAt: FieldValue.serverTimestamp() })),
    ...plan.tag.map(({ id, projectId }) => (b) => b.set(db.collection('ledgerTransactions').doc(id), { projectId, legacyProjectLinked: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true })),
    ...(plan.mark || []).map((id) => (b) => b.set(db.collection('ledgerTransactions').doc(id), { legacyProjectLinked: true }, { merge: true })),
  ]);
  return { created: plan.create.length, tagged: plan.tag.length };
}

/** Old receipts live at expenses/<legacyId>/<file>; which migrated rows still have one. */
async function legacyReceipts(getBucket, migrated) {
  const withUrl = migrated.filter((t) => t.attachmentUrl && !t.attachmentPath && t.legacyExpenseId);
  let found = 0;
  if (!withUrl.length) return { withLink: 0, fileFound: 0, fileMissing: 0, missingIds: [] };
  const bucket = getBucket();
  const missing = [];
  for (const t of withUrl) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const [files] = await bucket.getFiles({ prefix: `expenses/${t.legacyExpenseId}/`, maxResults: 1 });
      if (files.length) found += 1; else missing.push(t.id);
    } catch (_) {
      missing.push(t.id);
    }
  }
  return { withLink: withUrl.length, fileFound: found, fileMissing: missing.length, missingIds: missing.slice(0, 50) };
}

/**
 * @param {FirebaseFirestore.Firestore} db  Admin Firestore
 * @param {object} opts { mode: 'dry-run'|'apply'|'rollback'|'settle'|'projects'|'legacy-report'|'legacy-notes'|'legacy-notes-undo', bucket?, as?: 'owner'|'equity', runId?: string }
 */
async function migrateExpenses(db, opts) {
  const mode = (opts && opts.mode) || 'dry-run';
  const expenses = await readAll(db, 'expenses');
  const statements = await readAll(db, 'importedStatements');
  const dalTxns = await readCompany(db, 'ledgerTransactions', core.COMPANY);
  const migrated = dalTxns.filter((t) => t.source === 'migration' && t.legacyExpenseId);
  const existingIds = new Set(dalTxns.map((t) => t.id));

  if (mode === 'projects') {
    return { mode, projects: await linkLegacyProjects(db) };
  }

  if (mode === 'legacy-report') {
    // Read-only.
    const report = core.legacyExpenseReport(expenses, dalTxns);
    report.receipts = opts.getBucket ? await legacyReceipts(opts.getBucket, migrated.filter((t) => !t.deleted)) : null;
    report.notesToAdd = core.planLegacyNotes(expenses, dalTxns).length;
    return { mode, report };
  }

  if (mode === 'legacy-notes') {
    // Memo-only changes: no money moves, so totals are untouched. Marked with
    // legacyNotesAdded so they can be undone.
    const updates = core.planLegacyNotes(expenses, dalTxns);
    await commitInChunks(db, updates.map((u) => (b) => b.set(db.collection('ledgerTransactions').doc(u.id), { memo: u.memo, legacyNotesAdded: u.legacyNotesAdded, updatedAt: FieldValue.serverTimestamp() }, { merge: true })));
    const projects = await linkLegacyProjects(db);
    return { mode, notesAdded: updates.length, projects };
  }

  if (mode === 'legacy-notes-undo') {
    const undo = core.planLegacyNotesUndo(dalTxns);
    await commitInChunks(db, undo.map((u) => (b) => b.set(db.collection('ledgerTransactions').doc(u.id), { ...(u.memo === null ? {} : { memo: u.memo }), legacyNotesAdded: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })));
    return { mode, notesRemoved: undo.filter((u) => u.memo !== null).length, markersCleared: undo.length };
  }

  if (mode === 'settle') {
    const settled = await settleHistory(db, { as: opts.as });
    const rebuilt = await rebuildMonthly(db, core.COMPANY);
    return { mode, settled, rebuilt };
  }

  if (mode === 'rollback') {
    // Migrated rows plus anything derived from them (transfer legs in DAL,
    // intercompany mirrors in Zerbiq) if they were recategorized since.
    const historical = dalTxns.filter((t) => t.source === core.HISTORICAL_SOURCE && (t.role || 'main') === 'main');
    const parentIds = new Set([...migrated, ...historical].map((t) => t.id));
    const zerbiqTxns = await readCompany(db, 'ledgerTransactions', 'zerbiq');
    const derived = [...dalTxns, ...zerbiqTxns].filter((t) => t.parentId && parentIds.has(t.parentId));
    const all = [...migrated, ...historical, ...derived];
    const locked = all.filter((t) => t.status === 'reconciled');
    if (locked.length) {
      const err = new Error(`${locked.length} migrated transactions are reconciled. Undo those reconciliations first.`);
      err.status = 409;
      throw err;
    }
    // Import records whose rows were attached to migrated rows must go too,
    // or re-importing that statement would be refused as "already imported".
    const touchedImports = new Set(all.map((t) => t.importId).filter(Boolean));
    const legacyImports = (await readCompany(db, 'ledgerImports', core.COMPANY)).filter((i) => i.legacy || touchedImports.has(i.id));
    await commitInChunks(db, [
      ...all.map((t) => (b) => b.delete(db.collection('ledgerTransactions').doc(t.id))),
      ...legacyImports.map((i) => (b) => b.delete(db.collection('ledgerImports').doc(i.id))),
    ]);
    const rebuilt = await rebuildMonthly(db, core.COMPANY);
    const rebuiltZerbiq = await rebuildMonthly(db, 'zerbiq');
    return { mode, deletedTransactions: migrated.length, deletedLinked: derived.length, deletedImports: legacyImports.length, rebuilt, rebuiltZerbiq };
  }

  const plan = core.planMigration(expenses, existingIds);
  const errorIds = new Set(plan.errors.map((e) => e.id));
  const summary = {
    mode,
    legacyExpenses: expenses.length,
    legacyStatements: statements.length,
    toWrite: plan.drafts.length,
    alreadyMigrated: plan.skipped.length,
    errors: plan.errors,
    legacyTotalCents: legacyTotalCents(expenses, errorIds),
  };
  if (mode === 'dry-run') return summary;
  if (mode !== 'apply') throw Object.assign(new Error('Unknown mode'), { status: 400 });

  // 1) Back up the source data first (server-only collection; immutable from clients).
  const runId = (opts && opts.runId) || `run_${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`;
  const backupRef = db.collection('ledgerMigrationBackups').doc(runId);
  await backupRef.set({ createdAt: FieldValue.serverTimestamp(), expenseCount: expenses.length, statementCount: statements.length, toWrite: plan.drafts.length });
  await commitInChunks(db, [
    ...expenses.map((e) => (b) => b.set(backupRef.collection('expenses').doc(e.id), e)),
    ...statements.map((s) => (b) => b.set(backupRef.collection('importedStatements').doc(s.id), s)),
  ]);

  // 2) Default books (create-if-missing). DAL's card opens the month of the first legacy expense.
  const firstDate = plan.drafts.map((d) => d.draft.date).concat(migrated.map((t) => t.date)).sort()[0];
  const openingDate = firstDate ? `${firstDate.slice(0, 7)}-01` : '2025-01-01';
  summary.seeded = (await seedDefaults(db, 'dal', { openingDate })) + (await seedDefaults(db, 'zerbiq', { openingDate: '2025-01-01' }));
  // Books set up from the UI before migrating may open later than the oldest
  // expense: open the card earlier when that changes nothing (no opening balance).
  const cardSnap = await db.collection('ledgerAccounts').doc(core.ACCOUNT).get();
  const card = cardSnap.exists ? cardSnap.data() : null;
  if (card && firstDate && card.openingDate > firstDate && !card.openingBalanceCents) {
    await db.collection('ledgerAccounts').doc(core.ACCOUNT).set({ openingDate }, { merge: true });
    summary.cardOpeningMovedTo = openingDate;
  }

  // 3) Transactions through the same planner the app uses (validation included).
  const { accounts, categories } = accountsAndCategories(
    [...(await readCompany(db, 'ledgerAccounts', 'dal')), ...(await readCompany(db, 'ledgerAccounts', 'zerbiq'))],
    [...(await readCompany(db, 'ledgerCategories', 'dal')), ...(await readCompany(db, 'ledgerCategories', 'zerbiq'))]
  );
  const ops = [];
  for (const { id, draft } of plan.drafts) {
    let p;
    try {
      p = core.planTransactionWrite({ id, draft, before: null, existing: {}, accounts, categories });
    } catch (e) {
      plan.errors.push({ id: draft.legacyExpenseId, error: e.message });
      continue;
    }
    p.sets.forEach(({ id: docId, data }) => {
      ops.push((b) => b.set(db.collection('ledgerTransactions').doc(docId), { ...data, migrationRunId: runId, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }));
    });
  }
  core.planLegacyImports(statements).forEach(({ id, data }) => {
    ops.push((b) => b.set(db.collection('ledgerImports').doc(id), { ...data, importedAt: FieldValue.serverTimestamp() }, { merge: true }));
  });
  await commitInChunks(db, ops);

  // 4) The migrated charges were paid long ago: clear the card for that history.
  summary.settled = await settleHistory(db, {});
  // 4b) Old app tags become projects (Sharmin's work per app, etc.).
  summary.projects = await linkLegacyProjects(db);

  // 5) Aggregates from scratch (self-healing, idempotent).
  summary.rebuilt = await rebuildMonthly(db, 'dal');

  // 5) Verify: every legacy dollar is in the ledger exactly once.
  const after = (await readCompany(db, 'ledgerTransactions', 'dal')).filter((t) => t.source === 'migration' && t.legacyExpenseId);
  summary.migratedCount = after.length;
  summary.migratedTotalCents = -after.reduce((s, t) => s + t.amountCents, 0);
  const finalErrorIds = new Set(plan.errors.map((e) => e.id));
  summary.errors = plan.errors;
  summary.legacyTotalCents = legacyTotalCents(expenses, finalErrorIds);
  summary.verified = summary.migratedTotalCents === summary.legacyTotalCents && after.length === expenses.length - plan.errors.length;
  summary.runId = runId;
  await backupRef.set({ result: { written: plan.drafts.length, verified: summary.verified } }, { merge: true });
  return summary;
}

module.exports = { migrateExpenses, rebuildMonthly, seedDefaults, settleHistory, linkLegacyProjects };
