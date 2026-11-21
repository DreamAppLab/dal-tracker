// Projects / apps, notes and "make this a fixed asset" (core logic).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeLedger, core } = require('./memLedger');

const cat = (c, slug) => core.ids.category(c, slug);
const P = (slug) => `dal_proj_${slug}`;
const projects = {
  [P('logabode')]: { companyId: 'dal', name: 'Logabode' },
  [P('rvvault')]: { companyId: 'dal', name: 'RV Vault' },
};

test('projects: on transactions and split lines; validated per company', () => {
  const L = makeLedger();
  const id = L.add('dal', {
    accountId: 'dal_card', date: '2026-04-03', amountCents: -300000, payee: 'Sharmin Shepu', memo: 'April sprint',
    splits: [
      { lineId: 'a', categoryId: cat('dal', 'contractors'), amountCents: -200000, projectId: P('logabode'), memo: 'Logabode onboarding' },
      { lineId: 'b', categoryId: cat('dal', 'contractors'), amountCents: -100000, projectId: P('rvvault') },
    ],
  });
  assert.equal(L.txns[id].splits[0].projectId, P('logabode'));
  assert.equal(L.txns[id].projectId, null);
  const one = L.add('dal', { accountId: 'dal_card', date: '2026-04-04', amountCents: -5000, payee: 'Fiverr', categoryId: cat('dal', 'contractors'), projectId: P('rvvault') });
  assert.equal(L.txns[one].projectId, P('rvvault'));
  assert.throws(() => L.add('dal', { accountId: 'dal_card', date: '2026-04-04', amountCents: -1, categoryId: cat('dal', 'software'), projectId: 'zerbiq_proj_x' }), /other company/);
  assert.throws(() => L.add('dal', { accountId: 'dal_card', date: '2026-04-04', amountCents: -2, splits: [
    { categoryId: cat('dal', 'software'), amountCents: -1, projectId: 'zerbiq_proj_x' }, { categoryId: cat('dal', 'software'), amountCents: -1 },
  ] }), /other company/);
  // Transfer legs and intercompany mirrors never carry a project.
  const pay = L.add('dal', { accountId: 'dal_checking', date: '2026-04-05', amountCents: -1000, payee: 'Card', transferAccountId: 'dal_card', projectId: P('rvvault') });
  assert.equal(L.txns[core.ids.leg(pay, '0')].projectId, null);
});

test('by-project report: split lines win, untagged → No project, transfers/equity excluded, drill lines', () => {
  const L = makeLedger();
  L.add('dal', { accountId: 'dal_card', date: '2026-04-03', amountCents: -300000, payee: 'Sharmin Shepu', projectId: P('rvvault'), splits: [
    { lineId: 'a', categoryId: cat('dal', 'contractors'), amountCents: -200000, projectId: P('logabode') },
    { lineId: 'b', categoryId: cat('dal', 'contractors'), amountCents: -100000 }, // falls back to the txn's project
  ] });
  L.add('dal', { accountId: 'dal_checking', date: '2026-04-10', amountCents: 500000, payee: 'Client', categoryId: cat('dal', 'client_projects'), projectId: P('logabode') });
  L.add('dal', { accountId: 'dal_card', date: '2026-04-11', amountCents: -2000, payee: 'GitHub', categoryId: cat('dal', 'software') });
  L.add('dal', { accountId: 'dal_checking', date: '2026-04-12', amountCents: -50000, payee: 'Card', transferAccountId: 'dal_card' });
  L.add('dal', { accountId: 'dal_checking', date: '2026-04-13', amountCents: -10000, payee: 'Eddie', categoryId: cat('dal', 'owner_draw'), projectId: P('logabode') });
  const r = core.projectReport({ txns: L.txnList(), categories: L.categories, projects, companyId: 'dal', from: '2026-04-01', to: '2026-04-30' });
  const by = Object.fromEntries(r.rows.map((x) => [x.projectId, x]));
  assert.deepEqual([by[P('logabode')].income, by[P('logabode')].expense, by[P('logabode')].net], [500000, 200000, 300000]);
  assert.equal(by[P('rvvault')].expense, 100000);
  assert.equal(by._none.name, 'No project');
  assert.equal(by._none.expense, 2000);
  assert.equal(r.rows[r.rows.length - 1].projectId, '_none', 'No project listed last');
  assert.deepEqual(r.totals, { income: 500000, expense: 302000, net: 198000 });
  assert.equal(by[P('logabode')].lines.length, 2);
  // Matches the P&L (same cash-basis lines).
  const pnl = core.pnlFromMonthly(L.monthlyList(), L.categories, 'dal', '2026-04-01', '2026-04-30');
  assert.equal(pnl.totalExpense, r.totals.expense);
  assert.equal(pnl.totalIncome, r.totals.income);
});

test('vendor rules can carry a default project', () => {
  const rules = [{ id: 'r1', pattern: 'SHARMIN', categoryId: cat('dal', 'contractors'), projectId: P('logabode') }, { id: 'r2', pattern: 'GITHUB', categoryId: cat('dal', 'software') }];
  assert.equal(core.matchVendorRule('Sharmin Shepu', rules).projectId, P('logabode'));
  assert.equal(core.matchVendorRule('GITHUB INC', rules).projectId, undefined);
  assert.equal(core.applyVendorRules('Sharmin Shepu', rules), cat('dal', 'contractors'));
});

test('old Expenses app tags become projects (idempotent; DAL General is overhead)', () => {
  const txns = [
    { id: 'dal_mig_1', companyId: 'dal', role: 'main', project: 'Logabode' },
    { id: 'dal_mig_2', companyId: 'dal', role: 'main', project: 'RV Vault' },
    { id: 'dal_mig_3', companyId: 'dal', role: 'main', project: 'Logabode' },
    { id: 'dal_mig_4', companyId: 'dal', role: 'main', project: 'DAL General' },
    { id: 'dal_mig_5', companyId: 'dal', role: 'main', project: 'Logabode', projectId: P('rvvault') },
  ];
  const p1 = core.planLegacyProjects(txns, []);
  assert.deepEqual(p1.create.map((c) => [c.id, c.data.name]).sort(), [['dal_proj_logabode', 'Logabode'], ['dal_proj_rv_vault', 'RV Vault']]);
  assert.deepEqual(p1.tag.map((t) => t.id), ['dal_mig_1', 'dal_mig_2', 'dal_mig_3']);
  const p2 = core.planLegacyProjects(txns.map((t) => ({ ...t, projectId: t.projectId || (p1.tag.find((x) => x.id === t.id) || {}).projectId })), p1.create.map((c) => ({ id: c.id, ...c.data })));
  assert.deepEqual([p2.create.length, p2.tag.length], [0, 0]);
  assert.deepEqual(p1.mark, ['dal_mig_5'], 'a row the user already tagged is only marked as handled');
  // A project added by hand under the same name is reused, not duplicated.
  const p3 = core.planLegacyProjects(txns.slice(0, 1), [{ id: 'dal_proj_logabode_x7k2', companyId: 'dal', name: 'Logabode' }]);
  assert.deepEqual([p3.create.length, p3.tag[0].projectId], [0, 'dal_proj_logabode_x7k2']);
  // Once handled, a row the user set back to "No project" is never re-tagged.
  const p4 = core.planLegacyProjects([{ id: 'dal_mig_1', companyId: 'dal', role: 'main', project: 'Logabode', projectId: null, legacyProjectLinked: true }], []);
  assert.deepEqual([p4.create.length, p4.tag.length], [0, 0]);
});

test('a split saved with one line keeps the project of that line', () => {
  const L = makeLedger();
  const id = L.add('dal', { accountId: 'dal_card', date: '2026-04-03', amountCents: -1000, payee: 'Sharmin Shepu', splits: [
    { lineId: 'a', categoryId: cat('dal', 'contractors'), amountCents: -1000, projectId: P('logabode') },
  ] });
  assert.equal(L.txns[id].projectId, P('logabode'));
  assert.equal(L.txns[id].categoryId, cat('dal', 'contractors'));
});

test('by-project drill lines carry a unique line index per split line', () => {
  const L = makeLedger();
  L.add('dal', { accountId: 'dal_card', date: '2026-04-03', amountCents: -300, payee: 'X', splits: [
    { lineId: 'a', categoryId: cat('dal', 'contractors'), amountCents: -100 }, { lineId: 'b', categoryId: cat('dal', 'software'), amountCents: -200 },
  ] });
  const r = core.projectReport({ txns: L.txnList(), categories: L.categories, projects, companyId: 'dal', from: '2026-04-01', to: '2026-04-30' });
  const keys = r.rows[0].lines.map((l) => `${l.txnId}-${l.line}`);
  assert.equal(new Set(keys).size, 2);
  assert.ok(r.rows[0].lines.every((l) => l.split));
});

test('"make this a fixed asset": re-booked off the P&L onto an asset; undo restores the expense', () => {
  const L = makeLedger();
  const id = L.add('dal', { accountId: 'dal_card', date: '2026-06-25', amountCents: -311749, payee: 'Best Buy', memo: 'MacBook Pro for app builds', categoryId: cat('dal', 'hardware') });
  L.accounts.dal_fa_bb = { companyId: 'dal', kind: 'fixed_asset', name: 'MacBook Pro', openingBalanceCents: 0, openingDate: '2026-06-25', inServiceDate: '2026-06-25', lifeMonths: 36, depreciationCategoryId: cat('dal', 'depreciation') };
  const before = L.txns[id];
  L.save(id, { ...before, categoryId: null, transferAccountId: 'dal_fa_bb', convertedFromCategoryId: before.categoryId });
  assert.equal(L.balance('dal_fa_bb'), 311749);
  assert.equal(L.txns[id].convertedFromCategoryId, cat('dal', 'hardware'));
  let pnl = core.pnlFromMonthly(L.monthlyList(), L.categories, 'dal', '2026-06-01', '2026-06-30');
  assert.equal(pnl.totalExpense, 0, 'no longer an expense');
  core.depreciationToPost({ id: 'dal_fa_bb', ...L.accounts.dal_fa_bb }, L.txnList(), '2026-08-31').forEach((e) => L.save(e.id, e.draft));
  assert.ok(L.txnList().some((t) => t.source === 'depreciation'));
  // Undo: remove its depreciation, restore the original category.
  L.txnList().filter((t) => t.source === 'depreciation').forEach((t) => L.softDelete(t.id, true));
  L.save(id, { ...L.txns[id], transferAccountId: null, categoryId: L.txns[id].convertedFromCategoryId, convertedFromCategoryId: null });
  assert.equal(L.balance('dal_fa_bb'), 0);
  pnl = core.pnlFromMonthly(L.monthlyList(), L.categories, 'dal', '2026-06-01', '2026-08-31');
  assert.equal(pnl.totalExpense, 311749, 'back to a Hardware expense, no depreciation left');
  assert.equal(L.txns[id].memo, 'MacBook Pro for app builds', 'notes kept');
});
