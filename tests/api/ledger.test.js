const test = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, adminToken, setup } = require('../helpers');
const ledger = require('../../api/ledger');

const auth = (claims) => ({ authorization: `Bearer ${adminToken(claims)}` });
const call = async (route, body, headers = auth()) => {
  const res = mockRes();
  await ledger(mockReq({ method: 'POST', url: `/api/ledger/${route}`, headers, body }), res);
  return res;
};

function seed() {
  return {
    'ledgerReconciliations/dal_r1': { companyId: 'dal', accountId: 'dal_card', status: 'complete', statementDate: '2026-02-28', endingBalanceCents: -100 },
    'ledgerReconciliations/dal_r2': { companyId: 'dal', accountId: 'dal_card', status: 'complete', statementDate: '2026-03-31', endingBalanceCents: -300 },
    'ledgerTransactions/dal_a': { companyId: 'dal', accountId: 'dal_card', status: 'reconciled', reconciliationId: 'dal_r2', amountCents: -200 },
    'ledgerTransactions/dal_b': { companyId: 'dal', accountId: 'dal_card', status: 'reconciled', reconciliationId: 'dal_r2', amountCents: 0 },
    'ledgerTransactions/dal_c': { companyId: 'dal', accountId: 'dal_card', status: 'reconciled', reconciliationId: 'dal_r1', amountCents: -100 },
  };
}

test('ledger unreconcile: requires the admin', async () => {
  setup(seed());
  const res = await call('unreconcile', { companyId: 'dal', reconciliationId: 'dal_r2' }, {});
  assert.equal(res.statusCode, 401);
  const res2 = await call('unreconcile', { companyId: 'dal', reconciliationId: 'dal_r2' }, auth({ email: 'x@example.com' }));
  assert.equal(res2.statusCode, 403);
});

test('ledger unreconcile: audit-logged, unlocks only that statement, latest first', async () => {
  const db = setup(seed());
  // Older statement cannot be undone while a later one stands.
  const blocked = await call('unreconcile', { companyId: 'dal', reconciliationId: 'dal_r1' });
  assert.equal(blocked.statusCode, 409);
  // Cross-company id is refused.
  const cross = await call('unreconcile', { companyId: 'zerbiq', reconciliationId: 'dal_r2' });
  assert.equal(cross.statusCode, 400);

  const res = await call('unreconcile', { companyId: 'dal', reconciliationId: 'dal_r2' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.rows, 2);
  assert.equal(db.store.get('ledgerTransactions/dal_a').status, 'cleared');
  assert.equal(db.store.get('ledgerTransactions/dal_a').reconciliationId, null);
  assert.equal(db.store.get('ledgerTransactions/dal_c').status, 'reconciled', 'other statement untouched');
  assert.equal(db.store.get('ledgerReconciliations/dal_r2').status, 'undone');
  const audits = [...db.store.entries()].filter(([p]) => p.startsWith('auditLog/')).map(([, d]) => d);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].type, 'ledger_unreconcile');
  assert.equal(audits[0].target, 'ledgerReconciliations/dal_r2');
  assert.equal(audits[0].meta.rows, 2);

  // Twice → 409; now the older one can be undone.
  assert.equal((await call('unreconcile', { companyId: 'dal', reconciliationId: 'dal_r2' })).statusCode, 409);
  assert.equal((await call('unreconcile', { companyId: 'dal', reconciliationId: 'dal_r1' })).statusCode, 200);
});

test('ledger: input validation and unknown routes', async () => {
  setup(seed());
  assert.equal((await call('unreconcile', { companyId: 'acme', reconciliationId: 'dal_r2' })).statusCode, 400);
  assert.equal((await call('unreconcile', { companyId: 'dal', reconciliationId: 'dal_r2', extra: 1 })).statusCode, 400);
  assert.equal((await call('nope', {})).statusCode, 404);
  assert.equal((await call('receipt', { companyId: 'dal', txnId: 'dal_a', name: 'r.pdf', type: 'text/html', base64: 'AAAA' })).statusCode, 400);
});

// ── Migration (server job) ───────────────────────────────────────────────
function legacySeed() {
  return {
    'expenses/e1': { vendor: 'Vercel', amount: 20, date: '2026-01-05', category: 'Domain & Hosting', appId: 'Logabode', statementId: 'abc', source: 'import' },
    'expenses/e2': { vendor: 'Fiverr', amount: -15.5, date: '2026-01-06', category: 'Design', source: 'excel-import' },
    'expenses/e3': { vendor: 'Mystery', amount: 9.99, date: '2026-02-07', category: 'Uncategorized', source: 'manual' },
    'importedStatements/abc': { statementId: 'abc', fileName: 'march.pdf', billingStart: '2026-01-01', billingEnd: '2026-01-31', importedCount: 1 },
  };
}
const snapshot = (db, prefix) => JSON.stringify([...db.store.entries()].filter(([p]) => p.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b)).map(([p, d]) => [p, { ...d, createdAt: null, updatedAt: null, rebuiltAt: null, importedAt: null, migrationRunId: null }]));

test('migration: dry-run writes nothing; apply backs up, migrates, verifies; re-run is a no-op; rollback restores', async () => {
  const db = setup(legacySeed());
  const before = db.store.size;
  const dry = await call('migrate', { mode: 'dry-run' });
  assert.equal(dry.statusCode, 200);
  assert.equal(dry.body.summary.toWrite, 3);
  assert.equal(dry.body.summary.legacyTotalCents, 1449);
  assert.equal(db.store.size, before, 'dry run is read-only');

  const run1 = await call('migrate', { mode: 'apply' });
  assert.equal(run1.statusCode, 200, JSON.stringify(run1.body));
  const s1 = run1.body.summary;
  assert.equal(s1.toWrite, 3);
  assert.equal(s1.verified, true);
  assert.equal(s1.migratedTotalCents, 1449);
  // Backup exists before/with the migration and is complete.
  const backupDocs = [...db.store.keys()].filter((p) => p.startsWith(`ledgerMigrationBackups/${s1.runId}/expenses/`));
  assert.equal(backupDocs.length, 3);
  assert.equal(db.store.get('ledgerTransactions/dal_mig_e1').amountCents, -2000);
  assert.equal(db.store.get('ledgerTransactions/dal_mig_e2').amountCents, 1550);
  assert.equal(db.store.get('ledgerImports/dal_imp_abc').legacy, true);
  // Migrated charges (-20.00 + 15.50 credit) are cleared by the historical card payment: card owes 0.
  assert.equal(db.store.get('ledgerMonthly/dal_2026-01').acct.dal_card || 0, 0);
  assert.equal(db.store.get('ledgerMonthly/dal_2026-01').cat.dal_cat_hosting, -2000, 'expenses unchanged');
  assert.equal(db.store.get('ledgerMonthly/dal_2026-02').cat._uncat, -999);
  assert.ok(db.store.get('ledgerAccounts/dal_card'));
  assert.equal(db.store.get('ledgerAccounts/dal_card').openingDate, '2026-01-01');
  assert.ok(db.store.get('ledgerAccounts/zerbiq_ic_dal'));
  assert.ok(db.store.get('ledgerCategories/zerbiq_cat_supabase'));
  // Legacy data untouched.
  assert.equal(db.store.get('expenses/e1').amount, 20);
  const audits = [...db.store.entries()].filter(([p, d]) => p.startsWith('auditLog/') && d.type === 'ledger_migration');
  assert.equal(audits.length, 1);

  const txBefore = snapshot(db, 'ledgerTransactions/');
  const monBefore = snapshot(db, 'ledgerMonthly/');
  const run2 = await call('migrate', { mode: 'apply' });
  assert.equal(run2.body.summary.toWrite, 0, 'idempotent');
  assert.equal(run2.body.summary.alreadyMigrated, 3);
  assert.equal(run2.body.summary.verified, true);
  assert.equal(snapshot(db, 'ledgerTransactions/'), txBefore);
  assert.equal(snapshot(db, 'ledgerMonthly/'), monBefore);

  // User edits (e.g. opening balance) survive a re-run: seeding never overwrites.
  db.store.set('ledgerAccounts/dal_card', { ...db.store.get('ledgerAccounts/dal_card'), openingBalanceCents: -7777 });
  await call('migrate', { mode: 'apply' });
  assert.equal(db.store.get('ledgerAccounts/dal_card').openingBalanceCents, -7777);

  const rb = await call('migrate', { mode: 'rollback' });
  assert.equal(rb.statusCode, 200);
  assert.equal(rb.body.summary.deletedTransactions, 3);
  assert.equal([...db.store.keys()].filter((p) => p.startsWith('ledgerTransactions/dal_mig_')).length, 0);
  assert.equal(db.store.get('ledgerImports/dal_imp_abc'), undefined);
  assert.deepEqual(db.store.get('ledgerMonthly/dal_2026-01').acct, {});
  assert.equal(db.store.get('expenses/e3').amount, 9.99);
});

test('migration: rollback refuses while migrated rows are reconciled', async () => {
  const db = setup(legacySeed());
  await call('migrate', { mode: 'apply' });
  db.store.set('ledgerTransactions/dal_mig_e1', { ...db.store.get('ledgerTransactions/dal_mig_e1'), status: 'reconciled', reconciliationId: 'dal_r1' });
  const rb = await call('migrate', { mode: 'rollback' });
  assert.equal(rb.statusCode, 409);
  assert.ok(db.store.get('ledgerTransactions/dal_mig_e2'));
});

test('ledger unreconcile: needs a recent sign-in; orphaned locks (no record) can still be unlocked', async () => {
  const db = setup({
    ...seed(),
    'ledgerTransactions/dal_o1': { companyId: 'dal', accountId: 'dal_checking', status: 'reconciled', reconciliationId: 'dal_rec_lost', amountCents: -5 },
  });
  const stale = await call('unreconcile', { companyId: 'dal', reconciliationId: 'dal_r2' }, auth({ auth_time: Math.floor(Date.now() / 1000) - 3600 }));
  assert.equal(stale.statusCode, 401);
  assert.equal(stale.body.code, 'recent_auth_required');
  const res = await call('unreconcile', { companyId: 'dal', reconciliationId: 'dal_rec_lost' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.orphaned, true);
  assert.equal(db.store.get('ledgerTransactions/dal_o1').status, 'cleared');
  assert.equal((await call('unreconcile', { companyId: 'dal', reconciliationId: 'dal_nothing' })).statusCode, 404);
});

test('ledger receipt-url: only for a stored receipt path of that transaction', async () => {
  setup({ 'ledgerTransactions/dal_a': { companyId: 'dal', attachmentPath: 'ledgerReceipts/zerbiq/zerbiq_x/r.pdf' } });
  assert.equal((await call('receipt-url', { companyId: 'dal', txnId: 'dal_a' })).statusCode, 404);
  assert.equal((await call('receipt-url', { companyId: 'zerbiq', txnId: 'dal_a' })).statusCode, 400);
});

test('migration rollback also removes legs/mirrors derived from migrated rows and rebuilds both companies', async () => {
  const db = setup(legacySeed());
  await call('migrate', { mode: 'apply' });
  // Simulate the user recategorizing a migrated expense as "paid for Zerbiq".
  db.store.set('ledgerTransactions/dal_mig_e1__x0', { companyId: 'dal', accountId: 'dal_ic_zerbiq', date: '2026-01-05', amountCents: 2000, role: 'leg', parentId: 'dal_mig_e1', source: 'migration', status: 'uncleared', deleted: false, splits: [] });
  db.store.set('ledgerTransactions/zerbiq_m_mig_e1__0', { companyId: 'zerbiq', accountId: 'zerbiq_ic_dal', date: '2026-01-05', amountCents: -2000, role: 'mirror', parentId: 'dal_mig_e1', categoryId: 'zerbiq_cat_hosting', source: 'migration', status: 'uncleared', deleted: false, splits: [] });
  db.store.set('ledgerMonthly/zerbiq_2026-01', { companyId: 'zerbiq', month: '2026-01', acct: { zerbiq_ic_dal: -2000 }, cat: { zerbiq_cat_hosting: -2000 }, count: 1 });
  const rb = await call('migrate', { mode: 'rollback' });
  assert.equal(rb.statusCode, 200, JSON.stringify(rb.body));
  assert.equal(rb.body.summary.deletedLinked, 2);
  assert.equal(db.store.get('ledgerTransactions/zerbiq_m_mig_e1__0'), undefined);
  assert.deepEqual(db.store.get('ledgerMonthly/zerbiq_2026-01').cat, {});
});

test('migration rollback also removes import records attached to migrated rows (so the statement can be re-imported)', async () => {
  const db = setup(legacySeed());
  await call('migrate', { mode: 'apply' });
  db.store.set('ledgerTransactions/dal_mig_e3', { ...db.store.get('ledgerTransactions/dal_mig_e3'), importId: 'dal_imp_chase1', fingerprint: 'x' });
  db.store.set('ledgerImports/dal_imp_chase1', { companyId: 'dal', accountId: 'dal_card', fileName: 'chase.qfx' });
  db.store.set('ledgerImports/dal_imp_other', { companyId: 'dal', accountId: 'dal_card', fileName: 'unrelated.qfx' });
  const rb = await call('migrate', { mode: 'rollback' });
  assert.equal(rb.statusCode, 200);
  assert.equal(db.store.get('ledgerImports/dal_imp_chase1'), undefined);
  assert.ok(db.store.get('ledgerImports/dal_imp_other'), 'unrelated imports untouched');
});

// ── Historical card payments (migrated charges were paid before Books) ───
const core = require('../../src/ledger/core');
const txnsOf = (db, companyId) => [...db.store.entries()].filter(([p, d]) => p.startsWith('ledgerTransactions/') && d.companyId === companyId).map(([p, d]) => ({ id: p.split('/')[1], ...d }));
const balanceOf = (db, accountId) => (db.store.get(`ledgerAccounts/${accountId}`).openingBalanceCents || 0) + txnsOf(db, 'dal').filter((t) => t.accountId === accountId && !t.deleted).reduce((s, t) => s + t.amountCents, 0);
const monthlyOf = (db) => [...db.store.entries()].filter(([p]) => p.startsWith('ledgerMonthly/dal_')).map(([, d]) => d);
const categoriesOf = (db) => Object.fromEntries([...db.store.entries()].filter(([p]) => p.startsWith('ledgerCategories/')).map(([p, d]) => [p.split('/')[1], d]));

test('historical card payments: migrated card owes 0, P&L and checking unchanged, idempotent, switchable, balanced, rollback-safe', async () => {
  const db = setup({
    ...legacySeed(),
    'expenses/e4': { vendor: 'GitHub', amount: 4, date: '2025-11-03', category: 'Software & Subscriptions', source: 'import', statementId: 'old' },
  });
  const r1 = await call('migrate', { mode: 'apply' });
  assert.equal(r1.statusCode, 200, JSON.stringify(r1.body));
  assert.equal(r1.body.summary.settled.months, 3, 'Nov 2025, Jan 2026, Feb 2026');
  assert.equal(balanceOf(db, 'dal_card'), 0, 'card owes $0.00 for the migrated history');
  assert.equal(balanceOf(db, 'dal_checking'), 0, 'checking untouched');
  const hist = txnsOf(db, 'dal').filter((t) => t.source === 'historical_payment');
  assert.deepEqual(hist.map((t) => t.id).sort(), ['dal_hist_2025-11', 'dal_hist_2026-01', 'dal_hist_2026-02']);
  assert.ok(hist.every((t) => t.categoryId === 'dal_cat_owner_contribution' && t.type === 'equity'), 'default: owner contributions (paid personally)');
  assert.equal(db.store.get('ledgerTransactions/dal_hist_2026-01').date, '2026-01-06', 'dated the last migrated charge of the month');
  const cats = categoriesOf(db);

  // P&L counts the expenses exactly as before.
  const pnl = core.pnlFromMonthly(monthlyOf(db), cats, 'dal', '2026-01-01', '2026-01-31');
  assert.equal(pnl.totalExpense, 2000 - 1550);
  assert.equal(pnl.excludedEquityCents, 450);

  // Balance sheet still balances; owner report does not count these.
  const accounts = [...db.store.entries()].filter(([p]) => p.startsWith('ledgerAccounts/dal_')).map(([p, d]) => ({ id: p.split('/')[1], ...d }));
  const totals = core.totalsAsOf({ monthly: monthlyOf(db), monthTxns: [], companyId: 'dal', asOf: '2026-12-31' });
  const totalsBeforeFy = core.totalsAsOf({ monthly: monthlyOf(db), monthTxns: [], companyId: 'dal', asOf: '2025-12-31' });
  const bs = core.balanceSheet({ accounts, categories: cats, totals, totalsBeforeFy, companyId: 'dal', asOf: '2026-12-31' });
  assert.ok(bs.balanced);
  assert.equal(bs.liabilities.find((r) => r.accountId === 'dal_card').cents, 0);
  const owner = core.ownerEquityReport({ categories: cats, txns: txnsOf(db, 'dal'), companyId: 'dal', from: '2025-01-01', to: '2026-12-31', totalsBefore: { acct: {}, cat: {} } });
  assert.equal(owner.totals.contributions, 2000 - 1550 + 999 + 400, 'monthly owner contributions on the owner report');
  assert.deepEqual(owner.months.filter((m) => m.contributions).map((m) => m.month), ['2025-11', '2026-01', '2026-02']);

  // Idempotent: re-running apply or settle changes nothing.
  const snap = JSON.stringify(hist.map((t) => [t.id, t.amountCents, t.categoryId]).sort());
  await call('migrate', { mode: 'apply' });
  await call('migrate', { mode: 'settle' });
  assert.equal(JSON.stringify(txnsOf(db, 'dal').filter((t) => t.source === 'historical_payment').map((t) => [t.id, t.amountCents, t.categoryId]).sort()), snap);
  assert.equal(balanceOf(db, 'dal_card'), 0);

  // Switch to opening balance equity (paid from accounts outside Books); remembered on re-run.
  const sw = await call('migrate', { mode: 'settle', as: 'equity' });
  assert.equal(sw.statusCode, 200);
  assert.ok(txnsOf(db, 'dal').filter((t) => t.source === 'historical_payment').every((t) => t.categoryId === 'dal_cat_opening_equity'));
  assert.equal(categoriesOf(db).dal_cat_opening_equity.equityType, 'opening');
  await call('migrate', { mode: 'apply' });
  assert.ok(txnsOf(db, 'dal').filter((t) => t.source === 'historical_payment').every((t) => t.categoryId === 'dal_cat_opening_equity'), 'choice kept on re-run');
  const owner2 = core.ownerEquityReport({ categories: categoriesOf(db), txns: txnsOf(db, 'dal'), companyId: 'dal', from: '2025-01-01', to: '2026-12-31', totalsBefore: { acct: {}, cat: {} } });
  assert.equal(owner2.totals.contributions, 0, 'opening equity is not an owner contribution');
  assert.equal(balanceOf(db, 'dal_card'), 0);
  await call('migrate', { mode: 'settle', as: 'owner' });
  const audits = [...db.store.values()].filter((d) => d.type === 'ledger_migration' && d.meta && d.meta.mode === 'settle');
  assert.ok(audits.length >= 2, 'settle runs are audit-logged');

  // Someone re-books a historical entry as a transfer from checking (leg created), and soft-deletes another:
  // settle restores both as system entries, removes the leg, and checking/card come back to 0.
  const hId = 'dal_hist_2026-01';
  const h = db.store.get(`ledgerTransactions/${hId}`);
  db.store.set(`ledgerTransactions/${hId}`, { ...h, categoryId: null, transferAccountId: 'dal_checking', type: 'transfer' });
  db.store.set(`ledgerTransactions/${hId}__x0`, { companyId: 'dal', accountId: 'dal_checking', date: h.date, amountCents: -h.amountCents, role: 'leg', parentId: hId, parentLine: 0, transferAccountId: 'dal_card', source: 'historical_payment', status: 'uncleared', deleted: false, splits: [], payee: h.payee });
  db.store.set('ledgerTransactions/dal_hist_2026-02', { ...db.store.get('ledgerTransactions/dal_hist_2026-02'), deleted: true });
  const fix = await call('migrate', { mode: 'settle' });
  assert.equal(fix.statusCode, 200, JSON.stringify(fix.body));
  assert.deepEqual(fix.body.summary.settled.errors, []);
  assert.equal(db.store.get(`ledgerTransactions/${hId}__x0`), undefined, 'leg removed');
  assert.equal(db.store.get(`ledgerTransactions/${hId}`).transferAccountId, null);
  assert.equal(db.store.get('ledgerTransactions/dal_hist_2026-02').deleted, false, 'undeleted');
  assert.equal(balanceOf(db, 'dal_card'), 0);
  assert.equal(balanceOf(db, 'dal_checking'), 0);

  // A migrated row deleted later shrinks that month's payment; rollback removes everything.
  db.store.set('ledgerTransactions/dal_mig_e4', { ...db.store.get('ledgerTransactions/dal_mig_e4'), deleted: true });
  await call('migrate', { mode: 'settle' });
  assert.equal(db.store.get('ledgerTransactions/dal_hist_2025-11'), undefined);
  assert.equal(balanceOf(db, 'dal_card'), 0);
  const rb = await call('migrate', { mode: 'rollback' });
  assert.equal(rb.statusCode, 200);
  assert.equal(txnsOf(db, 'dal').filter((t) => t.source === 'historical_payment').length, 0);
});

test('migration legacy-report is read-only; legacy-notes adds only dropped notes (audited, undoable)', async () => {
  const seed = legacySeed();
  seed['expenses/e3'] = { ...seed['expenses/e3'], notes: 'RV Vault icons', description: 'April invoice' };
  const db = setup(seed);
  await call('migrate', { mode: 'apply' });
  const before = snapshot(db, '');
  const r = await call('migrate', { mode: 'legacy-report' });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(snapshot(db, ''), before, 'report writes nothing');
  const rep = r.body.summary.report;
  assert.equal(rep.legacy.total, 3);
  assert.equal(rep.legacy.droppedNotes, 1);
  assert.equal(rep.notesToAdd, 1);
  assert.equal(rep.books.migrated, 3);
  assert.deepEqual(rep.receipts, { withLink: 0, fileFound: 0, fileMissing: 0, missingIds: [] });
  const add = await call('migrate', { mode: 'legacy-notes' });
  assert.equal(add.statusCode, 200);
  assert.equal(add.body.summary.notesAdded, 1);
  assert.equal(db.store.get('ledgerTransactions/dal_mig_e3').memo, 'April invoice · RV Vault icons');
  assert.equal((await call('migrate', { mode: 'legacy-notes' })).body.summary.notesAdded, 0, 'idempotent');
  const undo = await call('migrate', { mode: 'legacy-notes-undo' });
  assert.equal(undo.body.summary.notesRemoved, 1);
  assert.equal(db.store.get('ledgerTransactions/dal_mig_e3').memo, 'April invoice');
  assert.ok([...db.store.keys()].some((k) => k.startsWith('auditLog/')), 'audited');
});

test('ledger receipt-url: old Expenses receipts get a fresh link to their own file only', async () => {
  const firebaseAdmin = require('../../api/_lib/firebaseAdmin');
  const signed = [];
  const bucket = {
    file: (name) => ({ getSignedUrl: async () => { signed.push(name); return [`https://signed/${name}`]; } }),
    getFiles: async ({ prefix }) => [prefix === 'expenses/e9/' ? [{ name: 'expenses/e9/scan.pdf' }] : []],
  };
  const db = setup({
    'ledgerTransactions/dal_mig_e1': { companyId: 'dal', source: 'migration', legacyExpenseId: 'e1', attachmentUrl: 'https://storage.googleapis.com/b/expenses/e1/receipt%201.pdf?GoogleAccessId=x' },
    'ledgerTransactions/dal_mig_e2': { companyId: 'dal', source: 'migration', legacyExpenseId: 'e2', attachmentUrl: 'https://storage.googleapis.com/b/expenses/other/receipt.pdf?x' },
    'ledgerTransactions/dal_mig_e3': { companyId: 'dal', source: 'migration', legacyExpenseId: 'e3', attachmentUrl: '' },
    'ledgerTransactions/dal_mig_e9': { companyId: 'dal', source: 'migration', legacyExpenseId: 'e9', attachmentUrl: 'https://weird.example/x' },
    'ledgerTransactions/dal_mig_bad': { companyId: 'dal', source: 'migration', legacyExpenseId: '../x', attachmentUrl: 'https://storage.googleapis.com/b/expenses/../x/a.pdf' },
  });
  firebaseAdmin.__setTestOverrides({ db, auth: require('../helpers').fakeAuth, bucket });
  const ok = await call('receipt-url', { companyId: 'dal', txnId: 'dal_mig_e1' });
  assert.equal(ok.statusCode, 200);
  assert.equal(signed.pop(), 'expenses/e1/receipt 1.pdf', 'the file named in the stored link');
  assert.equal((await call('receipt-url', { companyId: 'dal', txnId: 'dal_mig_e2' })).statusCode, 404, "another expense's file is never served");
  assert.equal((await call('receipt-url', { companyId: 'dal', txnId: 'dal_mig_e3' })).statusCode, 404, 'cleared receipt');
  assert.equal((await call('receipt-url', { companyId: 'dal', txnId: 'dal_mig_e9' })).statusCode, 200, 'unparseable link: listed by prefix');
  assert.equal(signed.pop(), 'expenses/e9/scan.pdf');
  assert.equal((await call('receipt-url', { companyId: 'dal', txnId: 'dal_mig_bad' })).statusCode, 404);
  assert.equal(ledger.legacyReceiptPath('https://s/b/expenses/e1/..', 'e1'), null);
  assert.equal(ledger.legacyReceiptPath('https://s/b/expenses/e1/a%2Fb.pdf', 'e1'), null);
});
