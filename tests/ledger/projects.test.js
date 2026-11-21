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

test('old Expenses report: fields, app tags, notes, and rows still missing both; dropped notes come over once and undo cleanly', () => {
  const expenses = [
    { id: 'e1', date: '2025-05-01', vendor: 'Sharmin Shepu', amount: 300, category: 'Professional Services', appId: 'Logabode', notes: 'Logabode onboarding', description: 'Logabode onboarding' },
    { id: 'e2', date: '2025-05-02', vendor: 'Fiverr', amount: 50, category: 'Development', appId: 'DAL', notes: 'FO123', description: 'FO123', source: 'excel-import', statementId: 's1' },
    { id: 'e3', date: '2025-05-03', vendor: 'Best Buy', amount: 99, category: 'Office', appId: 'DAL General', notes: '', description: '' },
    { id: 'e4', date: '2025-05-04', vendor: 'Sharmin Shepu', amount: 120, category: 'Professional Services', appId: 'DAL General', notes: 'RV Vault icons', description: 'April invoice', attachmentUrl: 'https://x' },
  ];
  const txns = expenses.map((e) => ({ id: core.migratedId(e.id), legacyExpenseId: e.id, ...core.mapLegacyExpense(e), role: 'main' }));
  const r = core.legacyExpenseReport(expenses, txns);
  assert.equal(r.legacy.total, 4);
  assert.equal(r.legacy.withApp, 1);
  assert.equal(r.legacy.withNotes, 3);
  assert.equal(r.legacy.droppedNotes, 1);
  assert.equal(r.legacy.withReceipt, 1);
  assert.ok(r.legacy.fields.some((f) => f.name === 'appId' && f.count === 4));
  assert.equal(r.legacy.examples.length, 3, 'Sharmin and Fiverr rows');
  assert.equal(r.books.appTagNotLinked, 1);
  assert.deepEqual([r.books.neither.count, r.books.neither.totalCents], [1, -9900]);
  // Bring over the dropped note (e4) — only while the memo is what the migration wrote.
  const plan = core.planLegacyNotes(expenses, txns);
  assert.deepEqual(plan, [{ id: 'dal_mig_e4', memo: 'April invoice · RV Vault icons', legacyNotesAdded: 'RV Vault icons' }]);
  const edited = txns.map((t) => (t.id === 'dal_mig_e4' ? { ...t, memo: 'my own words' } : t));
  assert.equal(core.planLegacyNotes(expenses, edited).length, 0, 'never over a user edit');
  const after = txns.map((t) => (t.id === 'dal_mig_e4' ? { ...t, memo: plan[0].memo, legacyNotesAdded: plan[0].legacyNotesAdded } : t));
  assert.equal(core.planLegacyNotes(expenses, after).length, 0, 'idempotent');
  assert.deepEqual(core.planLegacyNotesUndo(after), [{ id: 'dal_mig_e4', memo: 'April invoice' }]);
});

test('a purchase paid personally can become a fixed asset: still an owner contribution, off the P&L, depreciated', () => {
  const L = makeLedger();
  L.accounts.dal_personal.openingDate = '2026-01-01';
  const id = L.add('dal', { accountId: 'dal_personal', date: '2026-06-25', amountCents: -311749, payee: 'Best Buy', memo: 'ASUS laptop', categoryId: cat('dal', 'hardware') });
  L.accounts.dal_fa_laptop = { companyId: 'dal', kind: 'fixed_asset', name: 'ASUS laptop', openingBalanceCents: 0, openingDate: '2026-06-25', inServiceDate: '2026-06-25', lifeMonths: 60, salvageCents: 0, depreciationCategoryId: cat('dal', 'depreciation') };
  L.save(id, { ...L.txns[id], categoryId: null, transferAccountId: 'dal_fa_laptop', convertedFromCategoryId: cat('dal', 'hardware') });
  core.depreciationToPost({ id: 'dal_fa_laptop', ...L.accounts.dal_fa_laptop }, L.txnList(), '2026-11-21').forEach((e) => L.save(e.id, e.draft));
  const pnl = core.pnlFromMonthly(L.monthlyList(), L.categories, 'dal', '2026-01-01', '2026-12-31');
  assert.equal(pnl.expense.find((x) => x.categoryId === cat('dal', 'hardware')), undefined);
  assert.equal(pnl.expense.find((x) => x.categoryId === cat('dal', 'depreciation')).cents, 5 * 5196);
  assert.equal(L.balance('dal_fa_laptop'), 311749 - 5 * 5196, 'book value');
  assert.equal(L.balance('dal_personal'), -311749, 'the owners still paid it');
  const accounts = Object.entries(L.accounts).map(([aid, a]) => ({ id: aid, ...a }));
  const owner = core.ownerEquityReport({ accounts, categories: L.categories, txns: L.txnList(), companyId: 'dal', from: '2026-01-01', to: '2026-12-31', totalsBefore: { acct: {}, cat: {} } });
  assert.equal(owner.totals.contributions, 311749);
  const totals = core.totalsAsOf({ monthly: L.monthlyList(), monthTxns: [], companyId: 'dal', asOf: '2026-12-31' });
  const bs = core.balanceSheet({ accounts, categories: L.categories, totals, totalsBeforeFy: { acct: {}, cat: {} }, companyId: 'dal', asOf: '2026-12-31' });
  assert.ok(bs.balanced);
});

test('paid personally: refunds reduce contributions; covered amount on a payment is clamped to the payment', () => {
  const L = makeLedger();
  L.accounts.dal_personal.openingDate = '2026-01-01';
  L.add('dal', { accountId: 'dal_personal', date: '2026-03-01', amountCents: -10000, payee: 'Store', categoryId: cat('dal', 'office') });
  L.add('dal', { accountId: 'dal_personal', date: '2026-03-05', amountCents: 2500, payee: 'Store refund', categoryId: cat('dal', 'office') });
  const accounts = Object.entries(L.accounts).map(([id, a]) => ({ id, ...a }));
  const r = core.ownerEquityReport({ accounts, categories: L.categories, txns: L.txnList(), companyId: 'dal', from: '2026-01-01', to: '2026-12-31', totalsBefore: { acct: {}, cat: {} } });
  assert.deepEqual([r.totals.contributions, r.totals.distributions], [7500, 0]);
  const p = L.add('dal', { accountId: 'dal_card', date: '2026-03-09', amountCents: 5000, payee: 'PAYMENT', categoryId: cat('dal', 'owner_contribution'), coversHistoricalCents: 9000 });
  assert.equal(L.txns[p].coversHistoricalCents, 5000);
  L.save(p, { ...L.txns[p], amountCents: 3000 });
  assert.equal(L.txns[p].coversHistoricalCents, 3000, 'editing the amount down never fails');
});

test('vendor rules: date/account-limited intercompany rules (Zerbiq vendors from 2026-08-28 on the DAL card)', () => {
  const rules = [
    { id: 'd1', pattern: 'VERCEL', categoryId: cat('dal', 'hosting') },
    { id: 'd2', pattern: 'EXPO', categoryId: cat('dal', 'software') },
    { id: 'z1', pattern: 'VERCEL', fromDate: '2026-08-28', accountId: 'dal_card', icCategoryId: cat('zerbiq', 'hosting'), categoryId: cat('dal', 'hosting') },
    { id: 'z2', pattern: 'EXPO', wholeWord: true, fromDate: '2026-08-28', accountId: 'dal_card', icCategoryId: cat('zerbiq', 'software'), categoryId: cat('dal', 'software') },
  ];
  const m = (payee, date, accountId) => core.rulePick(core.matchVendorRule(payee, rules, { date, accountId }));
  assert.equal(m('VERCEL INC', '2026-09-03', 'dal_card'), `ic:${cat('zerbiq', 'hosting')}`);
  assert.equal(m('VERCEL DOMAINS', '2026-08-28', 'dal_card'), `ic:${cat('zerbiq', 'hosting')}`, 'from the start date');
  assert.equal(m('VERCEL INC', '2026-08-27', 'dal_card'), `cat:${cat('dal', 'hosting')}`, 'earlier: DAL');
  assert.equal(m('VERCEL INC', '2026-09-03', 'dal_checking'), `cat:${cat('dal', 'hosting')}`, 'other account: DAL');
  assert.equal(m('EXPO.DEV', '2026-09-03', 'dal_card'), `ic:${cat('zerbiq', 'software')}`);
  assert.equal(m('EXPORT HUB', '2026-09-03', 'dal_card'), `cat:${cat('dal', 'software')}`, 'whole word: EXPORT is not EXPO');
  assert.equal(core.applyVendorRules('VERCEL INC', rules), cat('dal', 'hosting'), 'no date → dated rules ignored');
  // Booked as "Paid for Zerbiq": Zerbiq expense, DAL receivable, DAL P&L excludes it.
  const L = makeLedger();
  const id = L.add('dal', { accountId: 'dal_card', date: '2026-09-03', amountCents: -2000, payee: 'VERCEL INC', transferAccountId: 'dal_ic_zerbiq', icCategoryId: cat('zerbiq', 'hosting') });
  assert.ok(L.txns[id]);
  assert.equal(L.balance('dal_ic_zerbiq'), 2000, 'due from Zerbiq');
  assert.equal(L.balance('dal_card'), -2000, 'still owed on the card');
  assert.equal(core.pnlFromMonthly(L.monthlyList(), L.categories, 'dal', '2026-09-01', '2026-09-30').totalExpense, 0);
  assert.equal(core.pnlFromMonthly(L.monthlyList(), L.categories, 'zerbiq', '2026-09-01', '2026-09-30').totalExpense, 2000);
});

test('Zerbiq charges on the DAL card: Vercel plan split + overage, settled through the owners (no open intercompany balance)', () => {
  const L = makeLedger();
  for (const c of ['dal', 'zerbiq']) L.accounts[`${c}_personal`].openingDate = '2026-01-01';
  const rule = { pattern: 'VERCEL', categoryId: cat('dal', 'hosting'), icCategoryId: cat('zerbiq', 'hosting'), settleThroughOwners: true, fromDate: '2026-08-28', accountId: 'dal_card', splitPlan: { planCents: 2000, ownCents: 1000, overageMemo: 'Vercel overage: Zerbiq builds/previews' } };
  // Longer general DAL rule loses to the limited Zerbiq rule.
  const picked = core.matchVendorRule('VERCEL INC PRO PLAN', [{ pattern: 'VERCEL INC PRO', categoryId: cat('dal', 'hosting') }, rule], { date: '2026-09-03', accountId: 'dal_card' });
  assert.equal(picked, rule);
  assert.equal(core.rulePick(rule), `cat:${cat('dal', 'hosting')}`, 'outside the importer a split rule falls back to our category');
  const lines = core.ruleSplitLines(rule, -2350, 'dal');
  assert.deepEqual(lines.map((l) => l.amountCents), [-1000, -1000, -350]);
  const id = L.add('dal', { accountId: 'dal_card', date: '2026-09-03', amountCents: -2350, payee: 'VERCEL INC', splits: lines });
  const anth = L.add('dal', { accountId: 'dal_card', date: '2026-09-05', amountCents: -2000, payee: 'ANTHROPIC', transferAccountId: 'dal_ic_zerbiq', icCategoryId: cat('zerbiq', 'ai_apis') });
  assert.equal(L.balance('dal_ic_zerbiq'), 1350 + 2000);
  for (const [key, amt, date] of [[id, 1350, '2026-09-03'], [anth, 2000, '2026-09-05']]) {
    core.ownersSettlementDrafts({ paidBy: 'dal', key, amountCents: amt, date }).forEach((d) => L.save(d.id, d.draft));
  }
  // Idempotent ids.
  assert.equal(core.ownersSettlementDrafts({ paidBy: 'dal', key: id, amountCents: 1350, date: '2026-09-03' })[0].id, core.ownersSettlementDrafts({ paidBy: 'dal', key: id, amountCents: 1, date: '2026-09-03' })[0].id);
  assert.equal(L.balance('dal_ic_zerbiq'), 0, 'Due from Zerbiq cleared');
  assert.equal(L.balance('zerbiq_ic_dal'), 0, 'Due to DAL cleared');
  assert.equal(L.balance('dal_card'), -4350, 'card still owes the statement amounts');
  const pnl = (c) => core.pnlFromMonthly(L.monthlyList(), L.categories, c, '2026-09-01', '2026-09-30').totalExpense;
  assert.equal(pnl('dal'), 1000, 'DAL keeps only its $10 plan share');
  assert.equal(pnl('zerbiq'), 1000 + 350 + 2000);
  const accounts = Object.entries(L.accounts).map(([aid, a]) => ({ id: aid, ...a }));
  const owner = (c) => core.ownerEquityReport({ accounts, categories: L.categories, txns: L.txnList(), companyId: c, from: '2026-01-01', to: '2026-12-31', totalsBefore: { acct: {}, cat: {} } }).totals.net;
  assert.equal(owner('zerbiq'), 3350, 'Zerbiq: the owners funded its share');
  assert.equal(owner('dal'), -3350, 'DAL: its owner money is reduced by the Zerbiq share (card payments add it back when imported)');
  for (const c of ['dal', 'zerbiq']) {
    const totals = core.totalsAsOf({ monthly: L.monthlyList(), monthTxns: [], companyId: c, asOf: '2026-12-31' });
    assert.ok(core.balanceSheet({ accounts, categories: L.categories, totals, totalsBeforeFy: { acct: {}, cat: {} }, companyId: c, asOf: '2026-12-31' }).balanced, c);
  }
});

test('owners settlement: refunds reverse it, legs carry the kind, ids come from the charge, bad split plans are ignored', () => {
  const L = makeLedger();
  for (const c of ['dal', 'zerbiq']) L.accounts[`${c}_personal`].openingDate = '2026-01-01';
  const charge = L.add('dal', { accountId: 'dal_card', date: '2026-09-05', amountCents: -2000, payee: 'ANTHROPIC', transferAccountId: 'dal_ic_zerbiq', icCategoryId: cat('zerbiq', 'ai_apis') });
  core.ownersSettlementDrafts({ paidBy: 'dal', key: `dal_card_${charge}`, amountCents: 2000, date: '2026-09-05' }).forEach((d) => L.save(d.id, d.draft));
  const refund = L.add('dal', { accountId: 'dal_card', date: '2026-09-09', amountCents: 500, payee: 'ANTHROPIC REFUND', transferAccountId: 'dal_ic_zerbiq', icCategoryId: cat('zerbiq', 'ai_apis') });
  assert.equal(L.balance('dal_ic_zerbiq'), -500, 'refund: DAL now owes Zerbiq');
  // Reverse settlement: paid by the other company.
  core.ownersSettlementDrafts({ paidBy: 'zerbiq', key: `dal_card_${refund}`, amountCents: 500, date: '2026-09-09' }).forEach((d) => L.save(d.id, d.draft));
  assert.equal(L.balance('dal_ic_zerbiq'), 0);
  assert.equal(L.balance('zerbiq_ic_dal'), 0);
  assert.equal(core.pnlFromMonthly(L.monthlyList(), L.categories, 'zerbiq', '2026-09-01', '2026-09-30').totalExpense, 1500);
  const legs = L.txnList().filter((t) => t.role === 'leg' && t.settlementId);
  assert.ok(legs.length && legs.every((t) => t.settlementKind === 'owners'));
  const ids = core.ownersSettlementDrafts({ paidBy: 'dal', key: 'dal_card_abc123def', amountCents: 1, date: '2026-09-05' }).map((d) => d.id);
  assert.deepEqual(ids, ['zerbiq_set_owndalcardabc123def_p', 'dal_set_owndalcardabc123def_r']);
  assert.equal(core.settlementPeerId(ids[0]), ids[1]);
  assert.equal(core.ruleSplitLines({ splitPlan: { planCents: 2000, ownCents: 3000 }, icCategoryId: 'x', categoryId: 'y' }, -2500, 'dal'), null);
});

test('Zerbiq rules: St Augustine law and State of Florida spellings; year typos are refused', () => {
  const rule = (pattern, zslug) => ({ pattern, fromDate: '2026-08-28', accountId: 'dal_card', icCategoryId: cat('zerbiq', zslug), categoryId: cat('dal', zslug), settleThroughOwners: true });
  const rules = [{ ...rule('AUGUSTINE LAW', 'professional'), wholeWord: true }, ...['STATE OF FLORIDA', 'FL DEPT OF STATE', 'FLORIDA DEPARTMENT OF STATE', 'FLORIDA DEPT OF STATE', 'FLA DEPT OF STATE', 'SUNBIZ', 'DIVISION OF CORPORATI', 'FL DIV OF CORP'].map((p) => rule(p, 'taxes_licenses'))];
  const m = (payee) => core.rulePick(core.matchVendorRule(payee, rules, { date: '2026-10-01', accountId: 'dal_card' }));
  for (const p of ['ST AUGUSTINE LAW', 'ST. AUGUSTINE LAW PLLC', 'SAINT AUGUSTINE LAW GROUP']) assert.equal(m(p), `ic:${cat('zerbiq', 'professional')}`, p);
  for (const p of ['STATE OF FLORIDA SUNBIZ', 'FL DEPT OF STATE 850-245', 'FLORIDA DEPARTMENT OF STATE', 'SUNBIZ.ORG', 'DIVISION OF CORPORATIONS TALLAHASSEE']) assert.equal(m(p), `ic:${cat('zerbiq', 'taxes_licenses')}`, p);
  assert.equal(m('AUGUSTINE BAKERY'), '');
  assert.equal(m('ST AUGUSTINE LAWN CARE'), '', 'whole word: LAWN is not LAW');
  assert.equal(m('DOS*DIVISION OF CORPORATI'), `ic:${cat('zerbiq', 'taxes_licenses')}`, 'truncated descriptor');
  assert.equal(m('FLA DEPT OF STATE'), `ic:${cat('zerbiq', 'taxes_licenses')}`);
  const L = makeLedger();
  assert.throws(() => L.add('dal', { accountId: 'dal_card', date: '0226-03-29', amountCents: -35000, payee: 'Sharmin Shepu', categoryId: cat('dal', 'contractors') }), /Check the year/);
  assert.throws(() => core.mapLegacyExpense({ id: 'x', date: '0226-03-29', amount: 350, vendor: 'Sharmin Shepu', category: 'Other' }), /year typo/);
  const plan = core.planMigration([{ id: 'x', date: '0226-03-29', amount: 350, vendor: 'S', category: 'Other' }], new Set(['dal_mig_x']));
  assert.deepEqual([plan.errors.length, plan.drafts.length, plan.skipped.length], [0, 0, 1], 'already migrated (and fixed in Books): counted as skipped, no error');
});

test('card statement cut-over: migrated charges up to the date are covered except the owed balance; later ones are paid by real payments', () => {
  const t = (id, date, amountCents) => ({ id, companyId: 'dal', accountId: 'dal_card', date, amountCents, source: 'migration', legacyExpenseId: id, role: 'main' });
  const txns = [t('a', '2026-05-20', -40000), t('b', '2026-06-10', -21534), t('c', '2026-06-20', -100000), t('d', '2026-08-01', -50000)];
  const plan = core.planHistoricalPayments(txns, [], 'dal_cat_owner_contribution', { date: '2026-06-14', owedCents: 61534 });
  const total = plan.upserts.reduce((s, u) => s + u.draft.amountCents, 0);
  assert.equal(total, 40000 + 21534 - 61534, 'only charges up to 06/14, minus what stays owed');
  assert.equal(plan.leftOwedCents, 61534);
  // Card owed after: 615.34 + later migrated charges; real payments (owner contributions) then match each statement.
  const owed = -(txns.reduce((s, x) => s + x.amountCents, 0) + total);
  assert.equal(owed, 61534 + 100000 + 50000);
  assert.equal(core.planHistoricalPayments(txns, [], 'x').totalCents, 211534, 'without a cut-over everything is covered');
});

test('import matching: migrated card rows (old fingerprints) match statement rows once; plan charge pick; personal category', () => {
  const existing = [{ id: 'dal_mig_1', source: 'migration', fingerprint: 'oldfp', date: '2026-07-02', amountCents: -1999, payee: 'GITHUB', role: 'main' }];
  const rows = core.withFingerprints('dal_card', [{ date: '2026-07-03', amountCents: -1999, payee: 'GITHUB, INC. SAN FRANCISCO CA' }]);
  assert.equal(core.classifyRows(rows, existing)[0].status, 'match');
  assert.notEqual(core.classifyRows(rows, [{ ...existing[0], importMatched: true }])[0].status, 'match', 'already matched once');
  const month = [{ date: '2026-11-01', amountCents: -30007 }, { date: '2026-11-04', amountCents: -12733 }, { date: '2026-11-12', amountCents: -30020 }];
  assert.equal(core.pickPlanCharge(month, 4).date, '2026-11-04');
  assert.equal(core.pickPlanCharge([{ date: '2026-10-04', amountCents: -5139 }, { date: '2026-10-22', amountCents: -10002 }], 4).date, '2026-10-04');
  const cats = core.defaultCategoryDocs('dal').map((d) => d.data);
  const personal = cats.find((c) => c.slug === 'personal_spending');
  assert.deepEqual([personal.kind, personal.equityType, personal.name], ['equity', 'personal', 'Personal (not business)']);
});

test('review fixes: duplicates use up migrated rows; matched migrated rows leave the cut-over coverage; plan pick by amount and rule start', () => {
  const mig = { id: 'dal_mig_s1', source: 'migration', date: '2026-08-14', amountCents: -50000, payee: 'SHARMIN SHEPU', role: 'main' };
  const [dupRow] = core.withFingerprints('dal_card', [{ date: '2026-08-14', amountCents: -50000, payee: 'SHARMIN SHEPU' }]);
  mig.fingerprint = dupRow.fingerprint;
  const later = core.withFingerprints('dal_card', [{ date: '2026-08-15', amountCents: -50000, payee: 'SHARMIN SHEPU' }]);
  const out = core.classifyRows([dupRow, ...later], [mig]);
  assert.deepEqual(out.map((r) => r.status), ['duplicate', 'new'], 'the later $500 is not swallowed');
  assert.equal(out[0].dupOfMigrated, true);
  // A charge made 06/13 (migrated) that posts on the Jul statement: once matched, no longer covered.
  const t = (id, date, amountCents, extra = {}) => ({ id, companyId: 'dal', accountId: 'dal_card', date, amountCents, source: 'migration', legacyExpenseId: id, role: 'main', ...extra });
  const rows = [t('a', '2026-06-01', -100000), t('b', '2026-06-13', -5000, { importMatched: true })];
  const plan = core.planHistoricalPayments(rows, [], 'x', { date: '2026-06-14', owedCents: 100000 - 0 });
  assert.equal(plan.totalCents, 0, 'only the unmatched $1,000 is in the cut-over, and it stays owed');
  // Plan pick: the $20+ charge near the 4th, not a small usage charge on the 3rd; nothing before the rule starts.
  assert.equal(core.pickPlanCharge([{ date: '2026-10-03', amountCents: -512 }, { date: '2026-10-05', amountCents: -2000 }], 4, 2000).date, '2026-10-05');
  assert.equal(core.pickPlanCharge([{ date: '2026-08-29', amountCents: -4000 }], 4, 2000, '2026-08-28'), null, 'August plan was billed before the rule');
});

test('card duplicates: the six production receipt/statement pairs pair up; off-card Fiverr rows do not', () => {
  const row = (id, date, cents, payee, extra = {}) => ({ id, companyId: 'dal', accountId: 'dal_card', date, amountCents: -cents, payee, role: 'main', ...extra });
  const rec = { source: 'migration', attachmentUrl: 'u', legacyExpenseId: 'x', status: 'cleared' };
  const imp = { source: 'import', fingerprint: 'f' };
  const txns = [
    row('r1', '2026-06-27', 3900, 'ASO.DEV LLP', rec), row('s1', '2026-06-27', 3900, 'ASO.DEV* TRIAL OVER LONDON', imp),
    row('r2', '2026-06-29', 1900, '650 Industries, Inc. (Expo)', rec), row('s2', '2026-06-30', 1900, '650 INDUSTRIES (EXPO) PALO ALTO', imp),
    row('r3', '2026-07-05', 597, 'Vercel Inc.', rec), row('s3', '2026-07-06', 597, 'VERCEL DOMAINS COVINA CA', imp),
    row('r4', '2026-07-29', 4800, '650 Industries, Inc. (Expo)', rec), row('s4', '2026-07-29', 4800, '650 INDUSTRIES (EXPO) BURLINGAME', imp),
    row('r5', '2026-08-08', 12248, '650 Industries, Inc. (Expo)', rec), row('s5', '2026-08-09', 12248, '650 INDUSTRIES (EXPO) BURLINGAME', imp),
    row('r6', '2026-08-13', 926, 'Mailgun Technologies, Inc.', rec), row('s6', '2026-08-13', 926, 'SINCH MAILGUN SAN ANTONIO TX', imp),
    row('f1', '2026-08-03', 5625, 'Fiverr FI58988418276', { source: 'migration', legacyExpenseId: 'y', status: 'cleared' }),
    row('x1', '2026-08-03', 5625, 'GITHUB INC', imp),
  ];
  const pairs = core.findCardDuplicates(txns, 'dal_card');
  assert.deepEqual(pairs.map((p) => `${p.dropId}>${p.keepId}`), ['r1>s1', 'r2>s2', 'r3>s3', 'r4>s4', 'r5>s5', 'r6>s6']);
  assert.equal(pairs.reduce((s, p) => s - p.amountCents, 0), 24371, '$243.71');
});

test('card duplicates review: closest pairing, merged rows not re-merged, possible duplicates held back, undo keeps later edits', () => {
  const row = (id, date, cents, payee, extra = {}) => ({ id, companyId: 'dal', accountId: 'dal_card', date, amountCents: -cents, payee, role: 'main', ...extra });
  const rec = { source: 'migration', attachmentUrl: 'u', legacyExpenseId: 'x', status: 'cleared' };
  const imp = { source: 'import', fingerprint: 'f' };
  // Greedy-by-date would pair Ra with S1 and strand Rb; closest-gap pairs both.
  const txns = [row('Ra', '2026-07-28', 1000, 'ACME TOOLS', rec), row('Rb', '2026-07-30', 1000, 'ACME TOOLS', rec), row('S1', '2026-07-29', 1000, 'ACME TOOLS INC', imp), row('S2', '2026-07-26', 1000, 'ACME TOOLS INC', imp)];
  assert.equal(core.findCardDuplicates(txns, 'dal_card').length, 2);
  // A statement row already merged into is not offered again.
  assert.equal(core.findCardDuplicates([txns[0], { ...txns[2], mergedFrom: 'old' }], 'dal_card').length, 0);
  // Off-card move: only up to the last imported statement; a same-amount twin is held back.
  const mig = (id, date, cents) => row(id, date, cents, `V${id}`, { source: 'migration', legacyExpenseId: id, status: 'cleared', importId: 'dal_imp_legacy' });
  const plan = core.planPersonalMove([mig('m1', '2026-08-03', 5625), mig('m2', '2026-08-10', 10900), row('s9', '2026-08-11', 10900, 'OTHER', imp), mig('m3', '2026-12-02', 700)], '2026-06-14', '2026-11-14');
  assert.deepEqual(plan.map((t) => [t.id, !!t.holdBack]), [['m1', false], ['m2', true]]);
  // Undo keeps a category set after the merge.
  const keep = row('K', '2026-07-29', 1000, 'ACME', { ...imp, memo: '', categoryId: null, transferAccountId: null, icCategoryId: null, splits: [] });
  const merged = core.mergedKeep(keep, { id: 'R', memo: 'receipt', categoryId: 'dal_cat_software', attachmentUrl: 'u' });
  const back = core.unmergedKeep({ ...merged, categoryId: 'dal_cat_hosting' });
  assert.equal(back.categoryId, 'dal_cat_hosting', 'later recategorization kept');
  assert.equal(back.attachmentUrl, null);
  assert.equal(back.memo, '');
});

test('intercompany totals: owners settlements are not "reimbursed" (no money moved)', () => {
  const r = core.openItems([
    { id: 'a', date: '2026-09-01', amountCents: 71321, role: 'leg' },
    { id: 'b', date: '2026-09-01', amountCents: -71321, role: 'leg', settlementId: 'set_owndalcardx', settlementKind: 'owners' },
    { id: 'c', date: '2026-10-22', amountCents: -14, role: 'mirror' },
    { id: 'd', date: '2026-10-22', amountCents: 14, role: 'leg', settlementId: 'set_owndalcardy' },
    { id: 'e', date: '2026-11-01', amountCents: 500, role: 'leg' },
    { id: 'f', date: '2026-11-02', amountCents: -500, role: 'leg', settlementId: 'set_abc123' },
  ]);
  assert.deepEqual(r.totals, { paidForThem: 71821, paidForUs: 14, settledIn: 500, settledOut: 0, ownersIn: 71321, ownersOut: 14 });
  assert.equal(r.balance, 0);
});
