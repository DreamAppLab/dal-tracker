// Ledger (Books) Firestore rules tests — run against the emulator via
//   npm run test:rules
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, collection, query, where, writeBatch, increment,
} from 'firebase/firestore';

const require = createRequire(import.meta.url);
const core = require('../../src/ledger/core/index.js');

const PROJECT_ID = 'demo-dal-mission-control';
const ADMIN = { email: 'lab@dreamapplab.com', email_verified: true };
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') },
  });
});
after(async () => { await env.cleanup(); });

const admin = () => env.authenticatedContext('eddie-uid', ADMIN).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const intruder = () => env.authenticatedContext('intruder', { email: 'intruder@example.com', email_verified: true }).firestore();

function txn(over = {}) {
  return {
    companyId: 'dal', accountId: 'dal_card', date: '2026-03-02', amountCents: -1999, payee: 'GITHUB', memo: '',
    status: 'uncleared', reconciliationId: null, type: 'expense', categoryId: 'dal_cat_software',
    transferAccountId: null, icCategoryId: null, splits: [], needsCategory: false, deleted: false,
    parentId: null, parentLine: null, role: 'main', settlementId: null, fingerprint: null, importId: null,
    source: 'manual', project: null, attachmentUrl: null, checkNumber: null, legacyExpenseId: null,
    ...over,
  };
}

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const c of core.COMPANY_IDS) {
      for (const a of core.defaultAccountDocs(c, { openingDate: '2026-01-01' })) await setDoc(doc(db, 'ledgerAccounts', a.id), a.data);
    }
    await setDoc(doc(db, 'ledgerTransactions', 'dal_t1'), txn());
    await setDoc(doc(db, 'ledgerTransactions', 'dal_rec1'), txn({ status: 'reconciled', reconciliationId: 'dal_r1' }));
    await setDoc(doc(db, 'ledgerTransactions', 'zerbiq_t1'), txn({ companyId: 'zerbiq', accountId: 'zerbiq_card', categoryId: 'zerbiq_cat_supabase' }));
    await setDoc(doc(db, 'ledgerReconciliations', 'dal_r1'), { companyId: 'dal', accountId: 'dal_card', status: 'complete', statementDate: '2026-03-31', startingBalanceCents: 0, endingBalanceCents: -1999, difference: 0 });
    await setDoc(doc(db, 'expenses', 'legacy1'), { vendor: 'Vercel', amount: 20 });
  });
});

test('ledger: anonymous and non-allowlisted users get nothing', async () => {
  for (const db of [anon(), intruder()]) {
    await assertFails(getDoc(doc(db, 'ledgerTransactions', 'dal_t1')));
    await assertFails(getDocs(query(collection(db, 'ledgerTransactions'), where('companyId', '==', 'dal'))));
    await assertFails(setDoc(doc(db, 'ledgerTransactions', 'dal_x'), txn()));
    await assertFails(getDoc(doc(db, 'ledgerAccounts', 'dal_card')));
  }
});

test('ledger: admin reads are company-scoped queries', async () => {
  const db = admin();
  await assertSucceeds(getDoc(doc(db, 'ledgerTransactions', 'dal_t1')));
  await assertSucceeds(getDoc(doc(db, 'ledgerTransactions', 'does_not_exist')));
  await assertSucceeds(getDocs(query(collection(db, 'ledgerTransactions'), where('companyId', '==', 'dal'))));
  await assertSucceeds(getDocs(query(collection(db, 'ledgerAccounts'), where('companyId', '==', 'zerbiq'))));
  // Unscoped collection reads are refused: every query must name its company.
  await assertFails(getDocs(collection(db, 'ledgerTransactions')));
});

test('ledger: valid transaction writes succeed', async () => {
  const db = admin();
  await assertSucceeds(setDoc(doc(db, 'ledgerTransactions', 'dal_t2'), txn()));
  await assertSucceeds(updateDoc(doc(db, 'ledgerTransactions', 'dal_t2'), { memo: 'note', status: 'cleared' }));
  await assertSucceeds(setDoc(doc(db, 'ledgerTransactions', 'zerbiq_t2'), txn({ companyId: 'zerbiq', accountId: 'zerbiq_checking', categoryId: 'zerbiq_cat_supabase' })));
});

test('ledger: no cross-company references or ids', async () => {
  const db = admin();
  // DAL transaction pointing at Zerbiq's card / category / transfer account.
  await assertFails(setDoc(doc(db, 'ledgerTransactions', 'dal_t3'), txn({ accountId: 'zerbiq_card' })));
  await assertFails(setDoc(doc(db, 'ledgerTransactions', 'dal_t3'), txn({ categoryId: 'zerbiq_cat_supabase' })));
  await assertFails(setDoc(doc(db, 'ledgerTransactions', 'dal_t3'), txn({ transferAccountId: 'zerbiq_checking' })));
  // Id prefix must match companyId.
  await assertFails(setDoc(doc(db, 'ledgerTransactions', 'zerbiq_t3'), txn()));
  await assertFails(setDoc(doc(db, 'ledgerTransactions', 't3'), txn()));
  // Unknown company.
  await assertFails(setDoc(doc(db, 'ledgerTransactions', 'acme_t3'), txn({ companyId: 'acme', accountId: 'acme_card', categoryId: null })));
  // companyId is immutable.
  await assertFails(updateDoc(doc(db, 'ledgerTransactions', 'dal_t1'), { companyId: 'zerbiq' }));
  // Accounts/categories/rules follow the same convention.
  await assertFails(setDoc(doc(db, 'ledgerAccounts', 'dal_new'), { companyId: 'zerbiq', kind: 'checking', name: 'x', openingBalanceCents: 0, openingDate: '2026-01-01' }));
  await assertFails(setDoc(doc(db, 'ledgerVendorRules', 'dal_rule_x'), { companyId: 'dal', pattern: 'SUPABASE', categoryId: 'zerbiq_cat_supabase' }));
  await assertSucceeds(setDoc(doc(db, 'ledgerVendorRules', 'dal_rule_x'), { companyId: 'dal', pattern: 'SUPABASE', categoryId: 'dal_cat_hosting' }));
});

test('ledger: money must be integer cents; dates and enums validated', async () => {
  const db = admin();
  await assertFails(setDoc(doc(db, 'ledgerTransactions', 'dal_t4'), txn({ amountCents: -19.99 })));
  await assertFails(setDoc(doc(db, 'ledgerTransactions', 'dal_t4'), txn({ amountCents: '1999' })));
  await assertFails(setDoc(doc(db, 'ledgerTransactions', 'dal_t4'), txn({ date: '03/02/2026' })));
  await assertFails(setDoc(doc(db, 'ledgerTransactions', 'dal_t4'), txn({ status: 'approved' })));
  await assertFails(setDoc(doc(db, 'ledgerTransactions', 'dal_t4'), txn({ type: 'magic' })));
  await assertFails(setDoc(doc(db, 'ledgerAccounts', 'dal_x'), { companyId: 'dal', kind: 'checking', name: 'x', openingBalanceCents: 1.5, openingDate: '2026-01-01' }));
});

test('ledger: reconciled rows are locked and cannot be deleted by a client', async () => {
  const db = admin();
  const ref = doc(db, 'ledgerTransactions', 'dal_rec1');
  await assertFails(deleteDoc(ref));
  await assertFails(updateDoc(ref, { amountCents: -1 }));
  await assertFails(updateDoc(ref, { date: '2026-03-03' }));
  await assertFails(updateDoc(ref, { status: 'cleared', reconciliationId: null }));
  await assertFails(updateDoc(ref, { deleted: true }));
  await assertFails(updateDoc(ref, { accountId: 'dal_checking' }));
  // Recategorizing / memo edits keep the lock intact and are allowed.
  await assertSucceeds(updateDoc(ref, { memo: 'annual plan', categoryId: 'dal_cat_hosting' }));
  // Creating rows already reconciled is refused; unreconciled rows can be deleted.
  await assertFails(setDoc(doc(db, 'ledgerTransactions', 'dal_t5'), txn({ status: 'reconciled', reconciliationId: 'dal_r1' })));
  await assertSucceeds(deleteDoc(doc(db, 'ledgerTransactions', 'dal_t1')));
  // Finishing a reconciliation: tick rows to reconciled + create the record (difference must be 0).
  const batch = writeBatch(db);
  batch.set(doc(db, 'ledgerTransactions', 'dal_t6'), txn({ status: 'cleared' }));
  await batch.commit();
  const fin = writeBatch(db);
  fin.update(doc(db, 'ledgerTransactions', 'dal_t6'), { status: 'reconciled', reconciliationId: 'dal_r2' });
  fin.set(doc(db, 'ledgerReconciliations', 'dal_r2'), { companyId: 'dal', accountId: 'dal_card', status: 'complete', statementDate: '2026-04-30', startingBalanceCents: -1999, endingBalanceCents: -3998, difference: 0 });
  await assertSucceeds(fin.commit());
  await assertFails(setDoc(doc(db, 'ledgerReconciliations', 'dal_r3'), { companyId: 'dal', accountId: 'dal_card', status: 'complete', statementDate: '2026-05-31', startingBalanceCents: 0, endingBalanceCents: 5, difference: 5 }));
  // Reconciliation records are immutable from a browser (undo is server-side).
  await assertFails(updateDoc(doc(db, 'ledgerReconciliations', 'dal_r1'), { status: 'undone' }));
  await assertFails(deleteDoc(doc(db, 'ledgerReconciliations', 'dal_r1')));
});

test('ledger: monthly aggregates use increments and company-bound ids', async () => {
  const db = admin();
  await assertSucceeds(setDoc(doc(db, 'ledgerMonthly', 'dal_2026-03'), { companyId: 'dal', month: '2026-03', acct: { dal_card: increment(-1999) }, cat: { dal_cat_software: increment(-1999) }, count: increment(1) }, { merge: true }));
  await assertSucceeds(setDoc(doc(db, 'ledgerMonthly', 'dal_2026-03'), { companyId: 'dal', month: '2026-03', acct: { dal_card: increment(1999) }, count: increment(-1) }, { merge: true }));
  await assertFails(setDoc(doc(db, 'ledgerMonthly', 'dal_2026-04'), { companyId: 'zerbiq', month: '2026-04', acct: {} }));
  await assertFails(setDoc(doc(db, 'ledgerMonthly', 'dal_2026-04'), { companyId: 'dal', month: '2026-05', acct: {} }));
  await assertFails(deleteDoc(doc(db, 'ledgerMonthly', 'dal_2026-03')));
});

test('ledger: prefs are per user; backups are server-only; legacy expenses are read-only', async () => {
  const db = admin();
  await assertSucceeds(setDoc(doc(db, 'ledgerPrefs', 'eddie-uid'), { companyId: 'zerbiq' }));
  await assertSucceeds(getDoc(doc(db, 'ledgerPrefs', 'eddie-uid')));
  await assertFails(setDoc(doc(db, 'ledgerPrefs', 'someone-else'), { companyId: 'dal' }));
  await assertFails(setDoc(doc(db, 'ledgerPrefs', 'eddie-uid'), { companyId: 'acme' }));
  await assertFails(getDoc(doc(db, 'ledgerMigrationBackups', 'run1')));
  await assertFails(setDoc(doc(db, 'ledgerMigrationBackups', 'run1'), { x: 1 }));
  await assertSucceeds(getDoc(doc(db, 'expenses', 'legacy1')));
  await assertFails(setDoc(doc(db, 'expenses', 'legacy2'), { vendor: 'x', amount: 1 }));
  await assertFails(updateDoc(doc(db, 'expenses', 'legacy1'), { amount: 2 }));
  await assertFails(deleteDoc(doc(db, 'expenses', 'legacy1')));
  await assertFails(setDoc(doc(db, 'importedStatements', 's1'), { x: 1 }));
});

test('ledger: categories and accounts cannot be deleted (archive instead)', async () => {
  const db = admin();
  await assertSucceeds(setDoc(doc(db, 'ledgerCategories', 'dal_cat_new'), { companyId: 'dal', name: 'New', kind: 'expense', archived: false }));
  await assertSucceeds(updateDoc(doc(db, 'ledgerCategories', 'dal_cat_new'), { archived: true }));
  await assertFails(deleteDoc(doc(db, 'ledgerCategories', 'dal_cat_new')));
  await assertFails(deleteDoc(doc(db, 'ledgerAccounts', 'dal_card')));
  await assertFails(updateDoc(doc(db, 'ledgerAccounts', 'dal_card'), { kind: 'checking' }));
  await assertSucceeds(updateDoc(doc(db, 'ledgerAccounts', 'dal_card'), { openingBalanceCents: -12345, name: 'Capital One Spark' }));
});

test('ledger: a full planner write set (transfer + intercompany + aggregates) passes the rules as one batch', async () => {
  const db = admin();
  const accounts = {};
  const categories = {};
  for (const c of core.COMPANY_IDS) {
    core.defaultAccountDocs(c, { openingDate: '2026-01-01' }).forEach((a) => { accounts[a.id] = a.data; });
    core.defaultCategoryDocs(c).forEach((x) => { categories[x.id] = x.data; });
  }
  const plan = core.mergePlans([
    core.planTransactionWrite({ id: 'dal_p1', draft: { companyId: 'dal', accountId: 'dal_checking', date: '2026-03-20', amountCents: -50000, payee: 'CAPITAL ONE', transferAccountId: 'dal_card' }, before: null, existing: {}, accounts, categories }),
    core.planTransactionWrite({ id: 'dal_p2', draft: { companyId: 'dal', accountId: 'dal_card', date: '2026-03-21', amountCents: -15000, payee: 'SUPABASE', splits: [
      { categoryId: 'dal_cat_software', amountCents: -5000 },
      { transferAccountId: 'dal_ic_zerbiq', icCategoryId: 'zerbiq_cat_supabase', amountCents: -10000 },
    ] }, before: null, existing: {}, accounts, categories }),
  ]);
  const batch = writeBatch(db);
  plan.sets.forEach(({ id, data }) => batch.set(doc(db, 'ledgerTransactions', id), data));
  Object.entries(plan.deltas).forEach(([id, d]) => {
    const inc = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, increment(v)]));
    const payload = { companyId: d.companyId, month: d.month, count: increment(d.count) };
    if (Object.keys(d.acct).length) payload.acct = inc(d.acct);
    if (Object.keys(d.cat).length) payload.cat = inc(d.cat);
    batch.set(doc(db, 'ledgerMonthly', id), payload, { merge: true });
  });
  await assertSucceeds(batch.commit());
  const mirror = await getDoc(doc(db, 'ledgerTransactions', core.ids.mirror('dal_p2', 1)));
  assert.equal(mirror.data().companyId, 'zerbiq');
  const zm = await getDoc(doc(db, 'ledgerMonthly', 'zerbiq_2026-03'));
  assert.equal(zm.data().cat.zerbiq_cat_supabase, -10000);
});

test('ledger: monthly increments must omit empty maps (an empty merged map wipes the totals)', async () => {
  const db = admin();
  const ref = doc(db, 'ledgerMonthly', 'dal_2026-05');
  await assertSucceeds(setDoc(ref, { companyId: 'dal', month: '2026-05', acct: { dal_card: increment(-500) }, cat: { dal_cat_software: increment(-500) }, count: increment(1) }, { merge: true }));
  // What src/ledger/ledgerStore.js monthlyPayload() sends for a pure transfer: no `cat` key.
  await assertSucceeds(setDoc(ref, { companyId: 'dal', month: '2026-05', acct: { dal_checking: increment(-500), dal_card: increment(500) }, count: increment(2) }, { merge: true }));
  assert.equal((await getDoc(ref)).data().cat.dal_cat_software, -500);
  // The bug this guards against: sending `cat: {}` replaces the map.
  await assertSucceeds(setDoc(ref, { companyId: 'dal', month: '2026-05', cat: {} }, { merge: true }));
  assert.deepEqual((await getDoc(ref)).data().cat, {});
});

test('ledger: fixed-asset accounts and their depreciation entries are valid; kinds stay fixed', async () => {
  const db = admin();
  const asset = { companyId: 'dal', kind: 'fixed_asset', name: 'MacBook Pro', openingBalanceCents: 0, openingDate: '2026-01-01', inServiceDate: '2026-01-01', lifeMonths: 36, salvageCents: 0, depreciationCategoryId: 'dal_cat_depreciation' };
  await assertSucceeds(setDoc(doc(db, 'ledgerAccounts', 'dal_fa_mac'), asset));
  await assertFails(setDoc(doc(db, 'ledgerAccounts', 'dal_fa_bad'), { ...asset, kind: 'savings' }));
  await assertFails(updateDoc(doc(db, 'ledgerAccounts', 'dal_fa_mac'), { kind: 'checking' }));
  await assertFails(setDoc(doc(db, 'ledgerAccounts', 'dal_fa_x'), { ...asset, companyId: 'zerbiq' }));
  await assertSucceeds(setDoc(doc(db, 'ledgerTransactions', 'dal_fa_mac_dep_2026-01'), txn({ accountId: 'dal_fa_mac', date: '2026-01-31', amountCents: -10000, payee: 'Depreciation', categoryId: 'dal_cat_depreciation', source: 'depreciation', status: 'cleared' })));
  await assertFails(setDoc(doc(db, 'ledgerTransactions', 'dal_fa_mac_dep_2026-02'), txn({ accountId: 'zerbiq_fa_mac', date: '2026-02-28', amountCents: -10000, categoryId: 'dal_cat_depreciation' })));
});

test('ledger: projects are company-scoped, archived not deleted; transactions and rules reference own projects only', async () => {
  const db = admin();
  await assertSucceeds(setDoc(doc(db, 'ledgerProjects', 'dal_proj_logabode'), { companyId: 'dal', name: 'Logabode', archived: false }));
  await assertSucceeds(updateDoc(doc(db, 'ledgerProjects', 'dal_proj_logabode'), { archived: true }));
  await assertFails(deleteDoc(doc(db, 'ledgerProjects', 'dal_proj_logabode')));
  await assertFails(setDoc(doc(db, 'ledgerProjects', 'dal_proj_x'), { companyId: 'zerbiq', name: 'X' }));
  await assertFails(setDoc(doc(db, 'ledgerProjects', 'dal_proj_y'), { companyId: 'dal', name: '' }));
  await assertSucceeds(getDocs(query(collection(db, 'ledgerProjects'), where('companyId', '==', 'dal'))));
  await assertFails(getDocs(collection(db, 'ledgerProjects')));
  await assertFails(getDocs(query(collection(anon(), 'ledgerProjects'), where('companyId', '==', 'dal'))));
  await assertSucceeds(setDoc(doc(db, 'ledgerTransactions', 'dal_p1'), txn({ projectId: 'dal_proj_logabode', memo: 'April sprint for Logabode' })));
  await assertFails(setDoc(doc(db, 'ledgerTransactions', 'dal_p2'), txn({ projectId: 'zerbiq_proj_x' })));
  await assertSucceeds(setDoc(doc(db, 'ledgerVendorRules', 'dal_rule_sharmin'), { companyId: 'dal', pattern: 'SHARMIN', categoryId: 'dal_cat_contractors', projectId: 'dal_proj_logabode' }));
  await assertFails(setDoc(doc(db, 'ledgerVendorRules', 'dal_rule_bad'), { companyId: 'dal', pattern: 'X', categoryId: 'dal_cat_contractors', projectId: 'zerbiq_proj_x' }));
});
