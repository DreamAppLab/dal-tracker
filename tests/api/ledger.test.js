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
  assert.equal(db.store.get('ledgerMonthly/dal_2026-01').acct.dal_card, -450);
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
