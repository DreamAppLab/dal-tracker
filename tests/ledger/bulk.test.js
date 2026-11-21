// Bulk "change category" and its undo (core logic).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeLedger, core } = require('./memLedger');

const cat = (c, slug) => core.ids.category(c, slug);

function run(L, changes, direction) {
  const by = core.changesByTxn(changes);
  let n = 0;
  for (const [id, list] of Object.entries(by)) {
    const before = { ...L.txns[id] };
    delete before.id;
    const draft = core.applyCategoryChanges(before, list, direction);
    if (draft) { L.save(id, draft); n += 1; }
  }
  return n;
}

function seed() {
  const L = makeLedger();
  L.accounts.dal_card.openingDate = '2024-01-01'; // migrated history goes back years
  const a = L.add('dal', { accountId: 'dal_card', date: '2025-03-03', amountCents: -100000, payee: 'Sharmin Shepu', categoryId: cat('dal', 'professional') });
  const b = L.add('dal', { accountId: 'dal_checking', date: '2026-02-03', amountCents: -50000, payee: 'SHARMIN  SHEPU (Fiverr)', categoryId: cat('dal', 'professional') });
  const c = L.add('dal', { accountId: 'dal_card', date: '2026-04-03', amountCents: -30000, payee: 'Sharmin Shepu', splits: [
    { lineId: 'a', categoryId: cat('dal', 'professional'), amountCents: -20000 },
    { lineId: 'b', categoryId: cat('dal', 'software'), amountCents: -10000 },
  ] });
  const d = L.add('dal', { accountId: 'dal_card', date: '2026-04-05', amountCents: -7000, payee: 'Sharmin Shepu' }); // uncategorized
  const e = L.add('dal', { accountId: 'dal_checking', date: '2026-04-06', amountCents: -9000, payee: 'Sharmin Shepu', transferAccountId: 'dal_card' }); // transfer: never touched
  const f = L.add('dal', { accountId: 'dal_card', date: '2026-04-07', amountCents: -4000, payee: 'Legal Zoom', categoryId: cat('dal', 'professional') });
  const g = L.add('zerbiq', { accountId: 'zerbiq_card', date: '2026-04-07', amountCents: -4000, payee: 'Sharmin Shepu', categoryId: cat('zerbiq', 'professional') });
  return { L, a, b, c, d, e, f, g };
}

test('bulk recategorize: any category → Contractors for one payee, all years, split lines, never transfers or the other company', () => {
  const { L, a, b, c, d, e, f, g } = seed();
  const plan = core.planBulkRecategorize(L.txnList(), { companyId: 'dal', payeeContains: 'sharmin shepu', fromCategoryId: '*', toCategoryId: cat('dal', 'contractors') });
  assert.equal(plan.txnCount, 4);
  assert.equal(plan.changes.length, 5, 'both lines of the split, plus the uncategorized row');
  assert.equal(plan.totalCents, -(100000 + 50000 + 20000 + 10000 + 7000));
  assert.equal(run(L, plan.changes, 'apply'), 4);
  [a, b, d].forEach((id) => assert.equal(L.txns[id].categoryId, cat('dal', 'contractors')));
  assert.deepEqual(L.txns[c].splits.map((s) => s.categoryId), [cat('dal', 'contractors'), cat('dal', 'contractors')]);
  assert.equal(L.txns[e].transferAccountId, 'dal_card');
  assert.equal(L.txns[f].categoryId, cat('dal', 'professional'));
  assert.equal(L.txns[g].categoryId, cat('zerbiq', 'professional'));
  const pnl = core.pnlFromMonthly(L.monthlyList(), L.categories, 'dal', '2025-01-01', '2026-12-31');
  const by = Object.fromEntries(pnl.expense.map((x) => [x.categoryId, x.cents]));
  assert.equal(by[cat('dal', 'professional')], 4000, 'Legal & accounting keeps only Legal Zoom');
  assert.equal(by[cat('dal', 'contractors')], 187000);
  assert.equal(L.balance('dal_card'), L.balanceFromTxns('dal_card'), 'balances untouched');
});

test('bulk recategorize: "from" filter limits the lines; undo restores only untouched lines', () => {
  const { L, a, b, c } = seed();
  const plan = core.planBulkRecategorize(L.txnList(), { companyId: 'dal', payeeContains: 'Sharmin', fromCategoryId: cat('dal', 'professional'), toCategoryId: cat('dal', 'contractors') });
  assert.equal(plan.changes.length, 3);
  run(L, plan.changes, 'apply');
  assert.deepEqual(L.txns[c].splits.map((s) => s.categoryId), [cat('dal', 'contractors'), cat('dal', 'software')]);
  // The user later moves one row by hand; undo must not overwrite it.
  L.save(b, { ...L.txns[b], categoryId: cat('dal', 'marketing') });
  assert.equal(run(L, plan.changes, 'undo'), 2);
  assert.equal(L.txns[a].categoryId, cat('dal', 'professional'));
  assert.equal(L.txns[b].categoryId, cat('dal', 'marketing'));
  assert.equal(L.txns[c].splits[0].categoryId, cat('dal', 'professional'));
  const pnl = core.pnlFromMonthly(L.monthlyList(), L.categories, 'dal', '2025-01-01', '2026-12-31');
  assert.equal(pnl.expense.find((x) => x.categoryId === cat('dal', 'contractors')), undefined);
});

test('bulk recategorize: validation and older splits without line ids', () => {
  const { L } = seed();
  assert.throws(() => core.planBulkRecategorize(L.txnList(), { companyId: 'dal', payeeContains: ' ', toCategoryId: cat('dal', 'contractors') }), /payee/);
  assert.throws(() => core.planBulkRecategorize(L.txnList(), { companyId: 'dal', payeeContains: 'x', toCategoryId: cat('zerbiq', 'contractors') }), /category/);
  const before = { companyId: 'dal', role: 'main', splits: [{ categoryId: cat('dal', 'professional'), amountCents: -1 }, { categoryId: cat('dal', 'professional'), amountCents: -1 }] };
  const out = core.applyCategoryChanges(before, [{ line: 1, lineId: null, from: cat('dal', 'professional'), to: cat('dal', 'contractors') }]);
  assert.deepEqual(out.splits.map((s) => s.categoryId), [cat('dal', 'professional'), cat('dal', 'contractors')]);
});
