// Financial statements & fixed assets: balance sheet, trial balance, general
// ledger, owner equity report, straight-line depreciation.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeLedger, core } = require('./memLedger');

const cat = (c, slug) => core.ids.category(c, slug);

function richLedger() {
  const L = makeLedger();
  Object.assign(L.accounts.dal_checking, { openingBalanceCents: 100000, openingDate: '2025-01-01' });
  Object.assign(L.accounts.dal_card, { openingBalanceCents: -20000, openingDate: '2025-01-01' }); // owed at opening
  L.accounts.dal_ic_zerbiq.openingDate = '2025-01-01';
  L.accounts.zerbiq_ic_dal.openingDate = '2025-01-01';
  L.accounts.dal_fa_mac = { companyId: 'dal', kind: 'fixed_asset', name: 'MacBook Pro', openingBalanceCents: 0, openingDate: '2025-06-01', inServiceDate: '2025-06-01', lifeMonths: 36, salvageCents: 0, depreciationCategoryId: cat('dal', 'depreciation') };
  L.add('dal', { accountId: 'dal_checking', date: '2025-03-01', amountCents: 500000, payee: 'Eddie', categoryId: cat('dal', 'owner_contribution') });
  L.add('dal', { accountId: 'dal_checking', date: '2025-04-10', amountCents: 300000, payee: 'Client', categoryId: cat('dal', 'client_projects') });
  L.add('dal', { accountId: 'dal_card', date: '2025-06-01', amountCents: -360000, payee: 'APPLE STORE', transferAccountId: 'dal_fa_mac' });
  L.add('dal', { accountId: 'dal_card', date: '2025-07-02', amountCents: -4999, payee: 'VERCEL', categoryId: cat('dal', 'hosting') });
  L.add('dal', { accountId: 'dal_card', date: '2025-08-03', amountCents: -12000, payee: 'SUPABASE', transferAccountId: 'dal_ic_zerbiq', icCategoryId: cat('zerbiq', 'supabase') });
  L.add('dal', { accountId: 'dal_checking', date: '2025-09-20', amountCents: -100000, payee: 'CHASE CARD', transferAccountId: 'dal_card' });
  L.add('dal', { accountId: 'dal_checking', date: '2025-12-15', amountCents: -50000, payee: 'Eddie', categoryId: cat('dal', 'owner_draw') });
  L.add('dal', { accountId: 'dal_card', date: '2026-02-10', amountCents: -777, payee: 'MYSTERY' });
  L.add('dal', { accountId: 'dal_checking', date: '2026-02-14', amountCents: 250000, payee: 'Client', categoryId: cat('dal', 'client_projects') });
  core.depreciationToPost({ id: 'dal_fa_mac', ...L.accounts.dal_fa_mac }, L.txnList(), '2026-03-31').forEach((e) => L.save(e.id, e.draft));
  return L;
}

function sheetsAt(L, companyId, asOf) {
  const fyStart = `${asOf.slice(0, 4)}-01-01`;
  const monthly = L.monthlyList();
  const txns = L.txnList();
  const totals = core.totalsAsOf({ monthly, monthTxns: txns, companyId, asOf });
  const totalsBeforeFy = core.totalsAsOf({ monthly, monthTxns: txns, companyId, asOf: core.addDays(fyStart, -1) });
  const accounts = Object.entries(L.accounts).map(([id, a]) => ({ id, ...a }));
  return {
    bs: core.balanceSheet({ accounts, categories: L.categories, totals, totalsBeforeFy, companyId, asOf }),
    tb: core.trialBalance({ accounts, categories: L.categories, totals, totalsBeforeFy, companyId }),
  };
}

test('balance sheet balances (assets = liabilities + equity) and trial balance debits = credits, any date, both companies', () => {
  const L = richLedger();
  for (const asOf of ['2025-05-31', '2025-08-17', '2025-12-31', '2026-02-12', '2026-03-31']) {
    for (const c of ['dal', 'zerbiq']) {
      const { bs, tb } = sheetsAt(L, c, asOf);
      assert.ok(bs.balanced, `${c} ${asOf} balance sheet: ${JSON.stringify(bs.totals)}`);
      assert.ok(tb.balanced, `${c} ${asOf} trial balance: ${JSON.stringify(tb.totals)}`);
    }
  }
  const { bs } = sheetsAt(L, 'dal', '2026-03-31');
  const row = (list, id) => list.find((r) => r.accountId === id || r.key === id);
  // Checking: 1000 + 5000 + 3000 − 1000 − 500 + 2500 = 10000.00
  assert.equal(row(bs.assets, 'dal_checking').cents, 1000000);
  // Mac: 3600 cost, 10 months (Jun 2025 – Mar 2026) × 100.00 depreciation.
  assert.equal(row(bs.assets, 'dal_fa_mac').cents, 260000);
  assert.equal(row(bs.assets, 'dal_ic_zerbiq').cents, 12000, 'due from Zerbiq is an asset');
  // Card owed: 200 + 3600 + 49.99 + 120 − 1000 + 7.77 = 2977.76
  assert.equal(row(bs.liabilities, 'dal_card').cents, 297776);
  assert.equal(row(bs.equity, 'opening').cents, 80000);
  assert.equal(row(bs.equity, cat('dal', 'owner_contribution')).cents, 500000);
  assert.equal(row(bs.equity, cat('dal', 'owner_draw')).cents, -50000);
  // 2025 net: 3000 − 49.99 − 7 months depreciation (Jun–Dec) 700 = 2250.01
  assert.equal(row(bs.equity, 'retained').cents, 225001);
  // 2026 YTD: 2500 − 3 months depreciation 300 = 2200
  assert.equal(row(bs.equity, 'net').cents, 220000);
  assert.equal(row(bs.equity, '_uncat').cents, -777);
  // Zerbiq: payable to DAL with the matching expense in its retained earnings.
  const z = sheetsAt(L, 'zerbiq', '2026-03-31').bs;
  assert.equal(z.liabilities.find((r) => r.accountId === 'zerbiq_ic_dal').cents, 12000);
  assert.equal(z.equity.find((r) => r.key === 'retained').cents, -12000);
  assert.ok(!z.assets.some((r) => r.accountId.startsWith('dal_')), 'no DAL accounts on Zerbiq sheet');
});

test('depreciation: straight-line, exact total, idempotent, recalculates after added cost', () => {
  const L = makeLedger();
  L.accounts.dal_fa_cam = { companyId: 'dal', kind: 'fixed_asset', name: 'Camera', openingBalanceCents: 100000, openingDate: '2026-01-01', inServiceDate: '2026-01-15', lifeMonths: 7, salvageCents: 1000, depreciationCategoryId: cat('dal', 'depreciation') };
  const acct = { id: 'dal_fa_cam', ...L.accounts.dal_fa_cam };
  const first = core.depreciationToPost(acct, L.txnList(), '2026-03-31');
  assert.deepEqual(first.map((e) => e.draft.date), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.deepEqual(first.map((e) => e.id), ['dal_fa_cam_dep_2026-01', 'dal_fa_cam_dep_2026-02', 'dal_fa_cam_dep_2026-03']);
  first.forEach((e) => L.save(e.id, e.draft));
  assert.deepEqual(core.depreciationToPost(acct, L.txnList(), '2026-03-31'), [], 'nothing new to post');
  const rest = core.depreciationToPost(acct, L.txnList(), '2027-12-31');
  assert.equal(rest.length, 4);
  rest.forEach((e) => L.save(e.id, e.draft));
  const s = core.assetSummary(acct, L.txnList(), '2027-12-31');
  assert.equal(s.accumulatedCents, 99000, 'cost − salvage exactly');
  assert.equal(s.bookValueCents, 1000);
  assert.equal(L.balance('dal_fa_cam'), 1000);
  const pnl = core.pnlFromMonthly(L.monthlyList(), L.categories, 'dal', '2026-01-01', '2026-12-31');
  assert.equal(pnl.expense.find((r) => r.categoryId === cat('dal', 'depreciation')).cents, 99000);

  // Cost added mid-life is spread over the remaining months.
  const L2 = makeLedger();
  L2.accounts.dal_fa_srv = { companyId: 'dal', kind: 'fixed_asset', name: 'Server', openingBalanceCents: 120000, openingDate: '2026-01-01', inServiceDate: '2026-01-01', lifeMonths: 12, salvageCents: 0, depreciationCategoryId: cat('dal', 'depreciation') };
  const srv = () => ({ id: 'dal_fa_srv', ...L2.accounts.dal_fa_srv });
  core.depreciationToPost(srv(), L2.txnList(), '2026-06-30').forEach((e) => L2.save(e.id, e.draft));
  L2.add('dal', { accountId: 'dal_checking', date: '2026-07-01', amountCents: -60000, payee: 'RAM upgrade', transferAccountId: 'dal_fa_srv' });
  core.depreciationToPost(srv(), L2.txnList(), '2026-12-31').forEach((e) => L2.save(e.id, e.draft));
  const s2 = core.assetSummary(srv(), L2.txnList(), '2026-12-31');
  assert.equal(s2.costCents, 180000);
  assert.equal(s2.accumulatedCents, 180000);
  assert.equal(L2.balance('dal_fa_srv'), 0);
  // Buying the asset is a transfer: not an expense.
  assert.equal(core.pnlFromMonthly(L2.monthlyList(), L2.categories, 'dal', '2026-07-01', '2026-07-31').expense.find((r) => r.name === 'Hosting & domains'), undefined);
});

test('general ledger: opening + lines + running balance per account and category; owner equity report', () => {
  const L = richLedger();
  const monthly = L.monthlyList();
  const txns = L.txnList();
  const from = '2025-09-01';
  const to = '2025-12-31';
  const totalsBefore = core.totalsAsOf({ monthly, monthTxns: txns, companyId: 'dal', asOf: core.addDays(from, -1) });
  const totalsBeforeFyOfFrom = core.totalsAsOf({ monthly, monthTxns: txns, companyId: 'dal', asOf: '2024-12-31' });
  const accounts = Object.entries(L.accounts).map(([id, a]) => ({ id, ...a }));
  const gl = core.generalLedger({ accounts, categories: L.categories, totalsBefore, totalsBeforeFyOfFrom, txns, companyId: 'dal', from, to });
  const chk = gl.accounts.find((s) => s.id === 'dal_checking');
  assert.equal(chk.opening, 900000);
  assert.deepEqual(chk.lines.map((l) => l.cents), [-100000, -50000]);
  assert.equal(chk.closing, 750000);
  assert.equal(chk.lines[1].balance, 750000);
  const dep = gl.categories.find((s) => s.id === cat('dal', 'depreciation'));
  assert.equal(dep.opening, -30000, 'Jun–Aug depreciation before the period, same fiscal year');
  assert.equal(dep.lines.length, 4);
  assert.equal(dep.closing, -70000);
  assert.ok(!gl.accounts.some((s) => s.id.startsWith('zerbiq_')), 'no other-company sections');

  const owner = core.ownerEquityReport({
    categories: L.categories, txns, companyId: 'dal', from: '2025-01-01', to: '2025-12-31',
    totalsBefore: core.totalsAsOf({ monthly, monthTxns: txns, companyId: 'dal', asOf: '2024-12-31' }),
  });
  assert.deepEqual(owner.totals, { contributions: 500000, distributions: 50000, net: 450000 });
  assert.equal(owner.months.length, 12);
  assert.equal(owner.months[2].contributions, 500000);
  assert.equal(owner.months[11].distributions, 50000);
  assert.equal(owner.closingNetCents, 450000);
});

// ── Review fixes (third review) ──────────────────────────────────────────
function assetLedger(asset) {
  const L = makeLedger();
  L.accounts.dal_checking.openingDate = '2020-01-01';
  L.accounts.dal_fa_x = { companyId: 'dal', kind: 'fixed_asset', name: 'Asset', depreciationCategoryId: cat('dal', 'depreciation'), salvageCents: 0, ...asset };
  const acct = () => ({ id: 'dal_fa_x', ...L.accounts.dal_fa_x });
  const post = (through) => core.depreciationToPost(acct(), L.txnList(), through).forEach((e) => L.save(e.id, e.draft));
  return { L, acct, post };
}

test('depreciation uses each month\'s own cost basis; later additions do not inflate earlier months', () => {
  const { L, acct, post } = assetLedger({ openingBalanceCents: 0, openingDate: '2026-01-01', inServiceDate: '2026-01-01', lifeMonths: 12 });
  L.add('dal', { accountId: 'dal_checking', date: '2026-01-01', amountCents: -120000, payee: 'Buy', transferAccountId: 'dal_fa_x' });
  L.add('dal', { accountId: 'dal_checking', date: '2026-06-15', amountCents: -60000, payee: 'Improvement', transferAccountId: 'dal_fa_x' });
  post('2026-02-28'); // back-filled after the June improvement was entered
  assert.deepEqual(L.txnList().filter((t) => t.source === 'depreciation').map((t) => t.amountCents), [-10000, -10000]);
  post('2026-12-31');
  const s = core.assetSummary(acct(), L.txnList(), '2026-12-31');
  assert.equal(s.accumulatedCents, 180000);
  assert.equal(s.pastLifeRemainingCents, 0);
  // An addition after the life ended is flagged instead of silently ignored.
  L.add('dal', { accountId: 'dal_checking', date: '2027-03-01', amountCents: -5000, payee: 'Late part', transferAccountId: 'dal_fa_x' });
  assert.equal(core.assetSummary(acct(), L.txnList(), '2027-03-31').pastLifeRemainingCents, 5000);
});

test('asset owned before the books: opens at book value, no back-filled years', () => {
  const { L, acct, post } = assetLedger({ openingCostCents: 360000, openingAccumulatedCents: 240000, openingBalanceCents: 120000, openingDate: '2026-01-01', inServiceDate: '2024-01-01', lifeMonths: 36 });
  post('2026-12-31');
  const dep = L.txnList().filter((t) => t.source === 'depreciation');
  assert.equal(dep.length, 12, 'only 2026 months');
  assert.equal(dep[0].date, '2026-01-31');
  const s = core.assetSummary(acct(), L.txnList(), '2026-12-31');
  assert.equal(s.costCents, 360000);
  assert.equal(s.accumulatedCents, 360000);
  assert.equal(s.bookValueCents, 0);
  assert.equal(L.balance('dal_fa_x'), 0);
  assert.equal(core.assetSummary(acct(), L.txnList(), '2025-06-30').costCents, 0, 'not on the books before its opening date');
});

test('positive Depreciation corrections count as depreciation, not cost; ids decide posted/skipped months', () => {
  const { L, acct, post } = assetLedger({ openingBalanceCents: 100000, openingDate: '2026-01-01', inServiceDate: '2026-01-01', lifeMonths: 10 });
  post('2026-02-28');
  L.add('dal', { accountId: 'dal_fa_x', date: '2026-02-28', amountCents: 5000, payee: 'Reversal', categoryId: cat('dal', 'depreciation') });
  const s = core.assetSummary(acct(), L.txnList(), '2026-02-28');
  assert.equal(s.costCents, 100000);
  assert.equal(s.accumulatedCents, 15000);
  // Moving an auto entry's date does not make its month "due" again.
  const jan = 'dal_fa_x_dep_2026-01';
  L.save(jan, { ...L.txns[jan], date: '2026-02-10' });
  assert.equal(core.depreciationToPost(acct(), L.txnList(), '2026-02-28').length, 0);
  // A deleted auto entry is respected, and the skip list survives a purge.
  L.softDelete('dal_fa_x_dep_2026-02', true);
  assert.equal(core.depreciationToPost(acct(), L.txnList(), '2026-02-28').length, 0);
  L.accounts.dal_fa_x.depreciationSkipMonths = ['2026-02'];
  delete L.txns['dal_fa_x_dep_2026-02'];
  assert.equal(core.depreciationToPost(acct(), L.txnList(), '2026-02-28').length, 0);
  assert.equal(core.depreciationToPost(acct(), L.txnList(), '2026-03-31').length, 1);
});

test('disposal: sale books proceeds and gain, clears the asset, stops depreciation; balance sheet stays balanced', () => {
  const { L, acct, post } = assetLedger({ openingBalanceCents: 120000, openingDate: '2026-01-01', inServiceDate: '2026-01-01', lifeMonths: 12 });
  post('2026-06-30'); // 6 × 100 → book value 600
  const bv = core.assetSummary(acct(), L.txnList(), '2026-07-15').bookValueCents;
  assert.equal(bv, 60000);
  const draft = core.disposalDraft({ account: acct(), bookValueCents: bv, date: '2026-07-15', proceedsCents: 80000, proceedsAccountId: 'dal_checking', gainLossCategoryId: cat('dal', 'asset_gain_loss') });
  L.save('dal_fa_x_disposal', draft);
  assert.equal(L.balance('dal_fa_x'), 0);
  assert.equal(L.balance('dal_checking'), 80000);
  const pnl = core.pnlFromMonthly(L.monthlyList(), L.categories, 'dal', '2026-07-01', '2026-07-31');
  assert.equal(pnl.income.find((r) => r.categoryId === cat('dal', 'asset_gain_loss')).cents, 20000, 'gain 800 − 600');
  const s = core.assetSummary(acct(), L.txnList(), '2026-12-31');
  assert.equal(s.disposedDate, '2026-07-15');
  assert.equal(s.bookValueCents, 0);
  assert.deepEqual(core.depreciationToPost(acct(), L.txnList(), '2026-12-31'), [], 'no depreciation after disposal');
  const totals = core.totalsAsOf({ monthly: L.monthlyList(), monthTxns: L.txnList(), companyId: 'dal', asOf: '2026-12-31' });
  const totalsBeforeFy = core.totalsAsOf({ monthly: L.monthlyList(), monthTxns: [], companyId: 'dal', asOf: '2025-12-31' });
  const accounts = Object.entries(L.accounts).map(([id, a]) => ({ id, ...a }));
  assert.ok(core.balanceSheet({ accounts, categories: L.categories, totals, totalsBeforeFy, companyId: 'dal', asOf: '2026-12-31' }).balanced);
  // A loss on write-off (no proceeds).
  const w = assetLedger({ openingBalanceCents: 50000, openingDate: '2026-01-01', inServiceDate: '2026-01-01', lifeMonths: 10 });
  w.L.save('dal_fa_x_disposal', core.disposalDraft({ account: w.acct(), bookValueCents: 50000, date: '2026-01-10', proceedsCents: 0, proceedsAccountId: 'dal_checking', gainLossCategoryId: cat('dal', 'asset_gain_loss') }));
  assert.equal(w.L.balance('dal_fa_x'), 0);
  assert.equal(core.pnlFromMonthly(w.L.monthlyList(), w.L.categories, 'dal', '2026-01-01', '2026-01-31').income[0].cents, -50000);
});

test('general ledger resets income/expense running balances at the fiscal year boundary', () => {
  const L = makeLedger();
  L.accounts.dal_checking.openingDate = '2025-01-01';
  L.add('dal', { accountId: 'dal_checking', date: '2025-11-10', amountCents: 10000, payee: 'A', categoryId: cat('dal', 'client_projects') });
  L.add('dal', { accountId: 'dal_checking', date: '2026-01-05', amountCents: 3000, payee: 'B', categoryId: cat('dal', 'client_projects') });
  const monthly = L.monthlyList();
  const accounts = Object.entries(L.accounts).map(([id, a]) => ({ id, ...a }));
  const gl = core.generalLedger({
    accounts, categories: L.categories, txns: L.txnList(), companyId: 'dal', from: '2025-11-01', to: '2026-02-28',
    totalsBefore: core.totalsAsOf({ monthly, monthTxns: [], companyId: 'dal', asOf: '2025-10-31' }),
    totalsBeforeFyOfFrom: core.totalsAsOf({ monthly, monthTxns: [], companyId: 'dal', asOf: '2024-12-31' }),
  });
  const inc = gl.categories.find((s) => s.id === cat('dal', 'client_projects'));
  assert.deepEqual(inc.lines.map((l) => [l.balance, l.yearStart]), [[10000, false], [3000, true]]);
  assert.equal(inc.closing, 3000);
  const chk = gl.accounts.find((s) => s.id === 'dal_checking');
  assert.equal(chk.closing, 13000, 'balance-sheet accounts keep running');
});
