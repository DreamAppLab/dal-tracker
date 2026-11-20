// Ledger core tests (node:test): money math, transfers, intercompany in both
// directions, reconciliation, P&L exclusions, import dedupe, migration.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeLedger, core } = require('./memLedger');

const cat = (c, slug) => core.ids.category(c, slug);

// ── Money ────────────────────────────────────────────────────────────────
test('money: parses statement and user formats to integer cents without float drift', () => {
  const P = core.parseMoneyToCents;
  assert.equal(P('1,234.56'), 123456);
  assert.equal(P('$12'), 1200);
  assert.equal(P('-4.5'), -450);
  assert.equal(P('(12.30)'), -1230);
  assert.equal(P('12.30-'), -1230);
  assert.equal(P('0.1'), 10);
  assert.equal(P(0.1 + 0.2), 30);
  assert.equal(P(19.999), 2000);
  assert.equal(P(-2.675), -268);
  assert.equal(P('12.345'), 1235);
  assert.equal(P('abc'), null);
  assert.equal(P(''), null);
  assert.equal(core.dollarsToCents(129.99), 12999);
  assert.equal(core.formatCents(-123456), '-$1,234.56');
  assert.equal(core.formatCents(5), '$0.05');
  assert.equal(core.formatCents(-5, { parens: true }), '($0.05)');
  assert.equal(core.centsToDecimalString(-1005), '-10.05');
  assert.throws(() => core.sumCents([1, 2.5]));
});

test('money: allocation always sums exactly to the total', () => {
  for (const total of [100, 101, -1001, 99999, 1]) {
    const parts = core.allocateCents(total, [1, 1, 1]);
    assert.equal(parts.reduce((a, b) => a + b, 0), total);
    parts.forEach((p) => assert.ok(Number.isInteger(p)));
  }
  assert.deepEqual(core.allocateCents(100, [1, 1, 1]), [34, 33, 33]);
});

// ── Basic entries + aggregates ───────────────────────────────────────────
test('expenses and deposits update balances and monthly aggregates consistently', () => {
  const L = makeLedger();
  L.add('dal', { accountId: 'dal_card', date: '2026-03-02', amountCents: -1999, payee: 'GITHUB', categoryId: cat('dal', 'software') });
  L.add('dal', { accountId: 'dal_checking', date: '2026-03-05', amountCents: 500000, payee: 'Client A', categoryId: cat('dal', 'client_projects') });
  assert.equal(L.balance('dal_card'), -1999);
  assert.equal(L.balance('dal_checking'), 500000);
  assert.equal(L.balance('dal_card'), L.balanceFromTxns('dal_card'));
  const pnl = core.pnlFromMonthly(L.monthlyList(), L.categories, 'dal', '2026-03-01', '2026-03-31');
  assert.equal(pnl.totalIncome, 500000);
  assert.equal(pnl.totalExpense, 1999);
  assert.equal(pnl.net, 498001);
});

test('validation: wrong-company references, bad splits and float amounts are rejected', () => {
  const L = makeLedger();
  assert.throws(() => L.add('dal', { accountId: 'zerbiq_card', date: '2026-03-02', amountCents: -100 }), /account in this company/);
  assert.throws(() => L.add('dal', { accountId: 'dal_card', date: '2026-03-02', amountCents: -100, categoryId: cat('zerbiq', 'supabase') }), /other company/);
  assert.throws(() => L.add('dal', { accountId: 'dal_card', date: '2026-03-02', amountCents: -10.5 }), /integer/);
  assert.throws(() => L.add('dal', { accountId: 'dal_card', date: '2026-03-02', amountCents: -1000, splits: [
    { categoryId: cat('dal', 'software'), amountCents: -600 }, { categoryId: cat('dal', 'hosting'), amountCents: -300 },
  ] }), /Split lines add up/);
  assert.throws(() => L.add('dal', { accountId: 'dal_checking', date: '2026-03-02', amountCents: -100, transferAccountId: 'zerbiq_card' }), /same company/);
  assert.throws(() => L.add('dal', { accountId: 'dal_ic_zerbiq', date: '2026-03-02', amountCents: -100 }), /automatically/);
});

// ── Transfers ────────────────────────────────────────────────────────────
test('transfer: paying the card from checking creates two linked legs and no expense', () => {
  const L = makeLedger();
  L.add('dal', { accountId: 'dal_card', date: '2026-03-02', amountCents: -50000, payee: 'VERCEL', categoryId: cat('dal', 'hosting') });
  const pay = L.add('dal', { accountId: 'dal_checking', date: '2026-03-20', amountCents: -50000, payee: 'CAPITAL ONE PAYMENT', transferAccountId: 'dal_card' });
  const leg = L.txns[core.ids.leg(pay, 0)];
  assert.ok(leg, 'leg exists');
  assert.equal(leg.accountId, 'dal_card');
  assert.equal(leg.amountCents, 50000);
  assert.equal(leg.transferAccountId, 'dal_checking');
  assert.equal(leg.type, 'transfer');
  assert.equal(L.txns[pay].type, 'transfer');
  assert.equal(L.balance('dal_card'), 0, 'card paid off');
  assert.equal(L.balance('dal_checking'), -50000);
  const pnl = core.pnlFromMonthly(L.monthlyList(), L.categories, 'dal', '2026-03-01', '2026-03-31');
  assert.equal(pnl.totalExpense, 50000, 'only the Vercel charge is an expense — the payment is not double counted');
  assert.equal(pnl.uncategorizedCents, 0);

  // Edit amount → leg follows.
  L.save(pay, { ...L.txns[pay], amountCents: -30000 });
  assert.equal(L.txns[core.ids.leg(pay, 0)].amountCents, 30000);
  assert.equal(L.balance('dal_card'), -20000);
  // Soft delete → both legs gone from balances; restore brings them back.
  L.softDelete(pay, true);
  assert.equal(L.txns[core.ids.leg(pay, 0)].deleted, true);
  assert.equal(L.balance('dal_card'), -50000);
  assert.equal(L.balance('dal_checking'), 0);
  L.softDelete(pay, false);
  assert.equal(L.balance('dal_checking'), -30000);
  assert.equal(L.balance('dal_card'), L.balanceFromTxns('dal_card'));
});

test('transfer: a reconciled leg locks amount/date changes from the other side', () => {
  const L = makeLedger();
  const pay = L.add('dal', { accountId: 'dal_checking', date: '2026-03-20', amountCents: -50000, payee: 'CAPITAL ONE', transferAccountId: 'dal_card' });
  const legId = core.ids.leg(pay, 0);
  L.txns[legId] = { ...L.txns[legId], status: 'reconciled', reconciliationId: 'dal_rec_1' };
  assert.throws(() => L.save(pay, { ...L.txns[pay], amountCents: -1 }), /reconciled/);
  assert.throws(() => L.softDelete(pay, true), /reconciled/);
  // Memo-only edits are fine and the leg keeps its reconciled status.
  L.save(pay, { ...L.txns[pay], memo: 'March payment' });
  assert.equal(L.txns[legId].status, 'reconciled');
  assert.equal(L.txns[legId].reconciliationId, 'dal_rec_1');
});

test('transfer: owner contributions are equity — excluded from P&L', () => {
  const L = makeLedger();
  L.add('zerbiq', { accountId: 'zerbiq_checking', date: '2026-02-01', amountCents: 1000000, payee: 'Eddie', categoryId: cat('zerbiq', 'owner_contribution') });
  L.add('zerbiq', { accountId: 'zerbiq_checking', date: '2026-02-15', amountCents: -200000, payee: 'Eddie', categoryId: cat('zerbiq', 'owner_draw') });
  const t = Object.values(L.txns)[0];
  assert.equal(t.type, 'equity');
  const pnl = core.pnlFromMonthly(L.monthlyList(), L.categories, 'zerbiq', '2026-02-01', '2026-02-28');
  assert.equal(pnl.totalIncome, 0);
  assert.equal(pnl.totalExpense, 0);
  assert.equal(pnl.excludedEquityCents, 800000);
  assert.equal(L.balance('zerbiq_checking'), 800000);
});

test('stripe payout: gross revenue and Stripe fee split on one deposit', () => {
  const L = makeLedger();
  L.add('zerbiq', { accountId: 'zerbiq_checking', date: '2026-04-03', amountCents: 9680, payee: 'STRIPE PAYOUT', splits: [
    { categoryId: cat('zerbiq', 'zerbiq_subscriptions'), amountCents: 10000 },
    { categoryId: cat('zerbiq', 'stripe_fees'), amountCents: -320 },
  ] });
  const pnl = core.pnlFromMonthly(L.monthlyList(), L.categories, 'zerbiq', '2026-04-01', '2026-04-30');
  assert.equal(pnl.totalIncome, 10000);
  assert.equal(pnl.totalExpense, 320);
  assert.equal(pnl.net, 9680);
  assert.equal(L.balance('zerbiq_checking'), 9680);
});

// ── Intercompany ─────────────────────────────────────────────────────────
test('intercompany: DAL card pays a Zerbiq expense (split) → receivable/payable mirror, P&L correct both sides', () => {
  const L = makeLedger();
  const id = L.add('dal', { accountId: 'dal_card', date: '2026-05-02', amountCents: -15000, payee: 'SUPABASE + GITHUB', splits: [
    { categoryId: cat('dal', 'software'), amountCents: -5000 },
    { transferAccountId: 'dal_ic_zerbiq', icCategoryId: cat('zerbiq', 'supabase'), amountCents: -10000 },
  ] });
  const mirror = L.txns[core.ids.mirror(id, 1)];
  assert.ok(mirror, 'mirror exists in Zerbiq books');
  assert.equal(mirror.companyId, 'zerbiq');
  assert.equal(mirror.accountId, 'zerbiq_ic_dal');
  assert.equal(mirror.categoryId, cat('zerbiq', 'supabase'));
  assert.equal(mirror.amountCents, -10000);

  assert.equal(L.balance('dal_card'), -15000);
  assert.equal(L.balance('dal_ic_zerbiq'), 10000, 'Due from Zerbiq');
  assert.equal(L.balance('zerbiq_ic_dal'), -10000, 'Due to Dream App Lab');
  assert.ok(core.balancesAgree(L.balance('dal_ic_zerbiq'), L.balance('zerbiq_ic_dal')));

  const dal = core.pnlFromMonthly(L.monthlyList(), L.categories, 'dal', '2026-05-01', '2026-05-31');
  assert.equal(dal.totalExpense, 5000, 'DAL P&L excludes the Zerbiq portion');
  const zb = core.pnlFromMonthly(L.monthlyList(), L.categories, 'zerbiq', '2026-05-01', '2026-05-31');
  assert.equal(zb.totalExpense, 10000, 'Zerbiq P&L includes it');
  assert.equal(zb.expense[0].categoryId, cat('zerbiq', 'supabase'));

  // Zerbiq reimburses part (partial payment) → balances move toward zero.
  const drafts = core.settlementDrafts({
    settlementId: 'zerbiq_s1', payer: 'zerbiq', payerTxnId: 'zerbiq_s1a', receiverTxnId: 'dal_s1b',
    payerAccountId: 'zerbiq_checking', receiverAccountId: 'dal_checking', amountCents: 6000, date: '2026-05-20',
  });
  drafts.forEach((d) => L.save(d.id, d.draft));
  assert.equal(L.balance('dal_ic_zerbiq'), 4000);
  assert.equal(L.balance('zerbiq_ic_dal'), -4000);
  assert.equal(L.balance('dal_checking'), 6000);
  assert.equal(L.balance('zerbiq_checking'), -6000);
  // Settlements never touch P&L.
  assert.equal(core.pnlFromMonthly(L.monthlyList(), L.categories, 'dal', '2026-05-01', '2026-05-31').net, -5000);
  assert.equal(core.pnlFromMonthly(L.monthlyList(), L.categories, 'zerbiq', '2026-05-01', '2026-05-31').net, -10000);

  // Open items: one charge, 40.00 still open.
  const dalEntries = L.txnList().filter((t) => t.accountId === 'dal_ic_zerbiq');
  const oi = core.openItems(dalEntries);
  assert.equal(oi.balance, 4000);
  assert.equal(oi.open.length, 1);
  assert.equal(oi.open[0].remainingCents, 4000);
  assert.equal(oi.totals.paidForThem, 10000);
  assert.equal(oi.totals.settledIn, 6000);

  // Pay the rest → fully settled.
  core.settlementDrafts({
    settlementId: 'zerbiq_s2', payer: 'zerbiq', payerTxnId: 'zerbiq_s2a', receiverTxnId: 'dal_s2b',
    payerAccountId: 'zerbiq_checking', receiverAccountId: 'dal_checking', amountCents: 4000, date: '2026-05-28',
  }).forEach((d) => L.save(d.id, d.draft));
  assert.equal(L.balance('dal_ic_zerbiq'), 0);
  assert.equal(core.openItems(L.txnList().filter((t) => t.accountId === 'dal_ic_zerbiq')).open.length, 0);
});

test('intercompany: reverse direction — Zerbiq pays a DAL expense, DAL settles', () => {
  const L = makeLedger();
  const id = L.add('zerbiq', { accountId: 'zerbiq_card', date: '2026-06-01', amountCents: -2500, payee: 'FIGMA', transferAccountId: 'zerbiq_ic_dal', icCategoryId: cat('dal', 'software') });
  assert.equal(L.txns[id].type, 'intercompany');
  assert.equal(L.balance('zerbiq_ic_dal'), 2500, 'Zerbiq: Due from DAL');
  assert.equal(L.balance('dal_ic_zerbiq'), -2500, 'DAL: Due to Zerbiq');
  assert.equal(core.pnlFromMonthly(L.monthlyList(), L.categories, 'zerbiq', '2026-06-01', '2026-06-30').totalExpense, 0);
  assert.equal(core.pnlFromMonthly(L.monthlyList(), L.categories, 'dal', '2026-06-01', '2026-06-30').totalExpense, 2500);
  core.settlementDrafts({
    settlementId: 'dal_s9', payer: 'dal', payerTxnId: 'dal_s9a', receiverTxnId: 'zerbiq_s9b',
    payerAccountId: 'dal_checking', receiverAccountId: 'zerbiq_checking', amountCents: 2500, date: '2026-06-10',
  }).forEach((d) => L.save(d.id, d.draft));
  assert.equal(L.balance('zerbiq_ic_dal'), 0);
  assert.equal(L.balance('dal_ic_zerbiq'), 0);

  // Editing the original (changing Zerbiq's category for DAL) re-plans the mirror; deleting removes it.
  L.save(id, { ...L.txns[id], icCategoryId: cat('dal', 'hosting') });
  assert.equal(L.txns[core.ids.mirror(id, 0)].categoryId, cat('dal', 'hosting'));
  L.softDelete(id, true);
  assert.equal(L.balance('dal_ic_zerbiq'), 2500, 'only the settlement remains: DAL overpaid');
  assert.equal(core.pnlFromMonthly(L.monthlyList(), L.categories, 'dal', '2026-06-01', '2026-06-30').totalExpense, 0);
});

test('intercompany: netting both directions with FIFO open items', () => {
  const L = makeLedger();
  L.add('dal', { accountId: 'dal_card', date: '2026-07-01', amountCents: -10000, payee: 'TELNYX', transferAccountId: 'dal_ic_zerbiq', icCategoryId: cat('zerbiq', 'sms_telnyx') });
  L.add('zerbiq', { accountId: 'zerbiq_card', date: '2026-07-05', amountCents: -3000, payee: 'NOTION', transferAccountId: 'zerbiq_ic_dal', icCategoryId: cat('dal', 'software') });
  const oi = core.openItems(L.txnList().filter((t) => t.accountId === 'dal_ic_zerbiq'));
  assert.equal(oi.balance, 7000);
  assert.equal(oi.open.length, 1);
  assert.equal(oi.open[0].remainingCents, 7000);
  assert.equal(oi.totals.paidForThem, 10000);
  assert.equal(oi.totals.paidForUs, 3000);
  assert.equal(L.balance('zerbiq_ic_dal'), -7000);
});

// ── Reconciliation ───────────────────────────────────────────────────────
test('reconciliation: live difference and finish only at zero', () => {
  const txns = [
    { id: 'a', amountCents: -1000 },
    { id: 'b', amountCents: -2550 },
    { id: 'c', amountCents: 50000 },
  ];
  const s1 = core.reconcileSummary({ startCents: 10000, statementEndingCents: 56450, txns, clearedIds: ['a', 'b'] });
  assert.equal(s1.clearedBalance, 6450);
  assert.equal(s1.difference, 50000);
  assert.equal(s1.canFinish, false);
  const s2 = core.reconcileSummary({ startCents: 10000, statementEndingCents: 56450, txns, clearedIds: new Set(['a', 'b', 'c']) });
  assert.equal(s2.difference, 0);
  assert.equal(s2.canFinish, true);
  assert.equal(s2.paymentCount, 2);
  assert.equal(s2.deposits, 50000);
  // Starting balance chains from the last completed (not undone) reconciliation.
  const recs = [
    { accountId: 'dal_card', status: 'complete', statementDate: '2026-01-31', endingBalanceCents: -1200 },
    { accountId: 'dal_card', status: 'undone', statementDate: '2026-02-28', endingBalanceCents: -9999 },
    { accountId: 'dal_checking', status: 'complete', statementDate: '2026-03-31', endingBalanceCents: 777 },
  ];
  assert.equal(core.startingBalance({ openingBalanceCents: 5 }, recs, 'dal_card'), -1200);
  assert.equal(core.startingBalance({ openingBalanceCents: 5 }, [], 'dal_card'), 5);
});

// ── Reports ──────────────────────────────────────────────────────────────
test('P&L: excludes transfers, equity and intercompany receivable portions; aggregates == transactions', () => {
  const L = makeLedger();
  L.add('dal', { accountId: 'dal_checking', date: '2026-01-10', amountCents: 300000, payee: 'Client', categoryId: cat('dal', 'client_projects') });
  L.add('dal', { accountId: 'dal_card', date: '2026-01-12', amountCents: -4500, payee: 'VERCEL', categoryId: cat('dal', 'hosting') });
  L.add('dal', { accountId: 'dal_card', date: '2026-01-13', amountCents: -9000, payee: 'SUPABASE', transferAccountId: 'dal_ic_zerbiq', icCategoryId: cat('zerbiq', 'supabase') });
  L.add('dal', { accountId: 'dal_checking', date: '2026-01-25', amountCents: -13500, payee: 'CAPITAL ONE', transferAccountId: 'dal_card' });
  L.add('dal', { accountId: 'dal_checking', date: '2026-01-26', amountCents: -100000, payee: 'Owner draw', categoryId: cat('dal', 'owner_draw') });
  L.add('dal', { accountId: 'dal_card', date: '2026-01-27', amountCents: 1500, payee: 'VERCEL REFUND', categoryId: cat('dal', 'hosting') });
  L.add('dal', { accountId: 'dal_card', date: '2026-01-28', amountCents: -700, payee: 'MYSTERY' });

  const fromAgg = core.pnlFromMonthly(L.monthlyList(), L.categories, 'dal', '2026-01-01', '2026-01-31');
  const fromTx = core.pnlFromTransactions(L.txnList(), L.categories, 'dal', '2026-01-01', '2026-01-31');
  assert.deepEqual(fromAgg, fromTx);
  assert.equal(fromAgg.totalIncome, 300000);
  assert.equal(fromAgg.totalExpense, 3000, 'hosting 45.00 − 15.00 refund; no transfer, no draw, no Zerbiq portion');
  assert.equal(fromAgg.uncategorizedCents, -700);
  assert.equal(fromAgg.excludedEquityCents, -100000);

  const drill = core.drillDown(L.txnList(), 'dal', cat('dal', 'hosting'), '2026-01-01', '2026-01-31');
  assert.equal(drill.length, 2);
  assert.equal(drill.reduce((s, r) => s + r.cents, 0), -3000);

  const series = core.incomeVsExpenseByMonth(L.monthlyList(), L.categories, 'dal', '2025-12', '2026-02');
  assert.deepEqual(series.map((r) => r.month), ['2025-12', '2026-01', '2026-02']);
  assert.equal(series[1].net, 297000);
  const trend = core.categoryTrend(L.monthlyList(), L.categories, 'dal', [cat('dal', 'hosting')], '2026-01', '2026-01');
  assert.equal(trend[0][cat('dal', 'hosting')], 3000);
  const ic = core.balanceSeries(L.monthlyList(), L.accounts.dal_ic_zerbiq, 'dal_ic_zerbiq', 'dal', '2026-01', '2026-02');
  assert.deepEqual(ic.map((r) => r.balance), [9000, 9000]);

  // No cross-company leakage: Zerbiq sees only its mirror.
  const zb = core.pnlFromMonthly(L.monthlyList(), L.categories, 'zerbiq', '2026-01-01', '2026-01-31');
  assert.equal(zb.totalIncome, 0);
  assert.equal(zb.totalExpense, 9000);
});

test('periods: month/quarter/ytd/custom and their prior periods', () => {
  assert.deepEqual(core.periodRange('quarter', '2026-05-14'), { from: '2026-04-01', to: '2026-06-30', kind: 'quarter' });
  assert.deepEqual(core.priorRange(core.periodRange('month', '2026-03-09')), { from: '2026-02-01', to: '2026-02-28', kind: 'month' });
  assert.deepEqual(core.priorRange(core.periodRange('quarter', '2026-02-01')), { from: '2025-10-01', to: '2025-12-31', kind: 'quarter' });
  assert.deepEqual(core.priorRange(core.periodRange('ytd', '2028-02-29')), { from: '2027-01-01', to: '2027-02-28', kind: 'ytd' });
  assert.deepEqual(core.priorRange({ from: '2026-03-10', to: '2026-03-19', kind: 'custom' }), { from: '2026-02-28', to: '2026-03-09', kind: 'custom' });
  assert.equal(core.isMonthAligned('2026-02-01', '2026-02-28'), true);
  assert.equal(core.isMonthAligned('2026-02-01', '2026-02-27'), false);
});

// ── Import ───────────────────────────────────────────────────────────────
test('import: re-importing the same statement is a no-op; identical rows keep distinct fingerprints', () => {
  const rows = [
    { date: '2026-03-01', payee: 'STARBUCKS #1234', amountCents: -500 },
    { date: '2026-03-01', payee: 'STARBUCKS #1234', amountCents: -500 },
    { date: '2026-03-02', payee: 'GITHUB', amountCents: -400 },
  ];
  const fp = core.withFingerprints('dal_card', rows);
  assert.notEqual(fp[0].fingerprint, fp[1].fingerprint);
  assert.equal(core.withFingerprints('dal_card', rows)[1].fingerprint, fp[1].fingerprint, 'stable across runs');
  assert.notEqual(core.withFingerprints('dal_checking', rows)[0].fingerprint, fp[0].fingerprint, 'scoped by account');

  const first = core.classifyRows(fp, []);
  assert.deepEqual(first.map((r) => r.status), ['new', 'new', 'new']);
  const existing = fp.map((r, i) => ({ id: `dal_x${i}`, ...r }));
  const again = core.classifyRows(core.withFingerprints('dal_card', rows), existing);
  assert.deepEqual(again.map((r) => r.status), ['duplicate', 'duplicate', 'duplicate']);
  assert.equal(again.filter((r) => r.selected).length, 0);

  // A third Starbucks charge on the next statement is new, not a duplicate.
  const more = core.classifyRows(core.withFingerprints('dal_card', [...rows, rows[0]]), existing);
  assert.deepEqual(more.map((r) => r.status), ['duplicate', 'duplicate', 'duplicate', 'possible']);
});

test('import: rows match existing transfer legs / manual entries instead of duplicating them', () => {
  const L = makeLedger();
  const pay = L.add('dal', { accountId: 'dal_card', date: '2026-03-20', amountCents: 50000, payee: 'PAYMENT THANK YOU', transferAccountId: 'dal_checking' });
  const legId = core.ids.leg(pay, 0);
  const checkingTxns = L.txnList().filter((t) => t.accountId === 'dal_checking');
  const incoming = core.withFingerprints('dal_checking', [{ date: '2026-03-21', payee: 'CAPITAL ONE CRCARDPMT', amountCents: -50000 }]);
  const out = core.classifyRows(incoming, checkingTxns);
  assert.equal(out[0].status, 'match');
  assert.equal(out[0].matchTxnId, legId);
});

test('import: card-payment detection suggests linking to an existing opposite entry', () => {
  const card = [{ id: 'dal_c1', role: 'main', date: '2026-03-20', amountCents: 50000, payee: 'PAYMENT THANK YOU', transferAccountId: null, splits: [] }];
  const s = core.suggestTransfer({ date: '2026-03-21', payee: 'CAPITAL ONE ONLINE PMT', amountCents: -50000 }, 'checking', 'dal_card', card, new Set());
  assert.deepEqual(s, { transferAccountId: 'dal_card', pairTxnId: 'dal_c1' });
  const none = core.suggestTransfer({ date: '2026-03-21', payee: 'GITHUB', amountCents: -400 }, 'checking', 'dal_card', card, new Set());
  assert.equal(none, null);
  assert.equal(core.isLikelyCardPayment({ payee: 'PAYMENT - THANK YOU', amountCents: 1000 }, 'credit_card'), true);
  assert.equal(core.isLikelyCardPayment({ payee: 'AMAZON REFUND', amountCents: 1000 }, 'credit_card'), false);
});

test('import: vendor rules (longest match wins) and CSV mappings', () => {
  const rules = [
    { id: 'r1', pattern: 'GOOGLE', categoryId: 'dal_cat_other_expense' },
    { id: 'r2', pattern: 'GOOGLE ADS', categoryId: 'dal_cat_marketing' },
  ];
  assert.equal(core.applyVendorRules('Google Ads 1234567', rules), 'dal_cat_marketing');
  assert.equal(core.applyVendorRules('GOOGLE *CLOUD', rules), 'dal_cat_other_expense');
  assert.equal(core.applyVendorRules('Unknown', rules), null);

  const csv = 'Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\n2026-03-01,2026-03-02,1234,"VERCEL, INC.",Software,20.00,\n2026-03-05,2026-03-05,1234,PAYMENT THANK YOU,Payment,,500.00\n';
  const table = core.parseCsvText(csv);
  assert.equal(table[1][3], 'VERCEL, INC.');
  const preset = core.detectPreset(table[0]);
  assert.equal(preset, 'capone_card');
  const { rows, errors } = core.applyMapping(table, core.PRESETS[preset].mapping);
  assert.deepEqual(errors, []);
  assert.deepEqual(rows.map((r) => r.amountCents), [-2000, 50000]);

  const bank = 'Account Number,Transaction Description,Transaction Date,Transaction Type,Transaction Amount,Balance\n1234,STRIPE TRANSFER,03/04/26,Credit,96.80,1096.80\n1234,CAPITAL ONE CRCARDPMT,03/21/26,Debit,500.00,596.80';
  const t2 = core.parseCsvText(bank);
  const r2 = core.applyMapping(t2, core.PRESETS[core.detectPreset(t2[0])].mapping);
  assert.deepEqual(r2.rows.map((r) => [r.date, r.amountCents]), [['2026-03-04', 9680], ['2026-03-21', -50000]]);
  assert.equal(core.parseFlexibleDate('Mar 5, 2026'), '2026-03-05');
  assert.equal(core.parseFlexibleDate(46082), '2026-03-01');
  assert.equal(core.parseFlexibleDate('05/03/2026', 'DMY'), '2026-03-05');
});

// ── Migration ────────────────────────────────────────────────────────────
test('migration: maps legacy expenses to DAL card transactions and is idempotent', () => {
  const L = makeLedger();
  const legacy = [
    { id: 'e1', vendor: 'Vercel', amount: 20, date: '2026-01-05', category: 'Domain & Hosting', appId: 'Logabode', statementId: 'abc', source: 'import' },
    { id: 'e2', vendor: 'Fiverr', amount: -15.5, date: '2026-01-06', category: 'Design', appId: 'DAL', source: 'excel-import' },
    { id: 'e3', vendor: 'Mystery', amount: 9.99, date: '2026-01-07', category: 'Uncategorized', source: 'manual', attachmentUrl: 'https://x/receipt.pdf' },
    { id: 'e4', vendor: 'Broken', amount: 1, date: 'not a date', category: 'Other' },
    { id: 'e5', vendor: 'Starbucks', amount: 5, date: '2026-01-08', category: 'Travel & Meals', statementId: 'abc' },
    { id: 'e6', vendor: 'Starbucks', amount: 5, date: '2026-01-08', category: 'Travel & Meals', statementId: 'abc' },
  ];
  const run = () => {
    const plan = core.planMigration(legacy, new Set(Object.keys(L.txns)));
    plan.drafts.forEach(({ id, draft }) => L.save(id, draft));
    return plan;
  };
  const p1 = run();
  assert.equal(p1.drafts.length, 5);
  assert.deepEqual(p1.errors.map((e) => e.id), ['e4']);
  const t1 = L.txns.dal_mig_e1;
  assert.equal(t1.accountId, 'dal_card');
  assert.equal(t1.amountCents, -2000);
  assert.equal(t1.categoryId, cat('dal', 'hosting'));
  assert.equal(t1.status, 'cleared');
  assert.equal(t1.project, 'Logabode');
  assert.equal(L.txns.dal_mig_e2.amountCents, 1550, 'credit becomes a card credit');
  assert.equal(L.txns.dal_mig_e2.categoryId, cat('dal', 'contractors'));
  assert.equal(L.txns.dal_mig_e3.categoryId, null);
  assert.equal(L.txns.dal_mig_e3.needsCategory, true);
  assert.equal(L.txns.dal_mig_e3.attachmentUrl, 'https://x/receipt.pdf');
  assert.notEqual(L.txns.dal_mig_e5.fingerprint, L.txns.dal_mig_e6.fingerprint);
  const balance1 = L.balance('dal_card');
  const monthly1 = JSON.stringify(L.monthly);

  const p2 = run();
  assert.equal(p2.drafts.length, 0, 'second run writes nothing');
  assert.equal(p2.skipped.length, 5);
  assert.equal(L.balance('dal_card'), balance1);
  assert.equal(JSON.stringify(L.monthly), monthly1);
  // Rebuilding aggregates from the transactions gives the same numbers.
  assert.deepEqual(core.rebuildMonthly(L.txnList()), L.monthly);

  // Re-importing the original statement rows is a no-op thanks to fingerprints.
  const reimport = core.classifyRows(core.withFingerprints('dal_card', [
    { date: '2026-01-08', payee: 'Starbucks', amountCents: -500 },
    { date: '2026-01-08', payee: 'Starbucks', amountCents: -500 },
    { date: '2026-01-05', payee: 'Vercel', amountCents: -2000 },
  ]), L.txnList());
  assert.deepEqual(reimport.map((r) => r.status), ['duplicate', 'duplicate', 'duplicate']);
  assert.equal(core.planLegacyImports([{ id: 'abc', statementId: 'abc', importedCount: 3 }])[0].id, 'dal_imp_abc');
});

// ── Review fixes ─────────────────────────────────────────────────────────
test('splits: legs keep their own status when other split lines are removed (stable line ids)', () => {
  const L = makeLedger();
  const id = L.add('dal', { accountId: 'dal_checking', date: '2026-03-20', amountCents: -60000, payee: 'MIXED', splits: [
    { lineId: 'a1', categoryId: cat('dal', 'software'), amountCents: -10000 },
    { lineId: 'b2', transferAccountId: 'dal_card', amountCents: -50000 },
  ] });
  const legId = core.ids.leg(id, 'b2');
  assert.ok(L.txns[legId]);
  // Remove the OTHER line: the transfer leg keeps its key, status and fingerprint.
  const id2 = L.add('dal', { accountId: 'dal_checking', date: '2026-03-21', amountCents: -60000, payee: 'MIXED2', splits: [
    { lineId: 'a1', categoryId: cat('dal', 'software'), amountCents: -10000 },
    { lineId: 'b2', transferAccountId: 'dal_card', amountCents: -40000 },
    { lineId: 'c3', categoryId: cat('dal', 'hosting'), amountCents: -10000 },
  ] });
  const leg2 = core.ids.leg(id2, 'b2');
  L.txns[leg2] = { ...L.txns[leg2], status: 'cleared', fingerprint: 'fp2' };
  L.save(id2, { ...L.txns[id2], amountCents: -50000, splits: L.txns[id2].splits.filter((s) => s.lineId !== 'a1') });
  assert.equal(L.txns[leg2].status, 'cleared');
  assert.equal(L.txns[leg2].fingerprint, 'fp2');
  assert.throws(() => L.add('dal', { accountId: 'dal_checking', date: '2026-03-21', amountCents: -2, splits: [
    { lineId: 'x', categoryId: cat('dal', 'software'), amountCents: -1 }, { lineId: 'x', categoryId: cat('dal', 'hosting'), amountCents: -1 },
  ] }), /unique/);
  assert.equal(L.balance('dal_card'), L.balanceFromTxns('dal_card'));
});

test('opening date: transactions before an account opens are refused', () => {
  const L = makeLedger();
  assert.throws(() => L.add('dal', { accountId: 'dal_card', date: '2025-12-31', amountCents: -100 }), /opens on 2026-01-01/);
  assert.throws(() => L.add('dal', { accountId: 'dal_checking', date: '2025-12-31', amountCents: -100, transferAccountId: 'dal_card' }), /opens on/);
});

test('settlements: only transfer to the intercompany account; peer ids pair both companies', () => {
  const L = makeLedger();
  const { payerTxnId, receiverTxnId } = core.settlementTxnIds('abc1', 'zerbiq');
  assert.equal(payerTxnId, 'zerbiq_set_abc1_p');
  assert.equal(receiverTxnId, 'dal_set_abc1_r');
  assert.equal(core.settlementPeerId(payerTxnId), receiverTxnId);
  assert.equal(core.settlementPeerId(receiverTxnId), payerTxnId);
  assert.equal(core.settlementPeerId('dal_t1'), null);
  core.settlementDrafts({ settlementId: 'set_abc1', payer: 'zerbiq', payerTxnId, receiverTxnId, payerAccountId: 'zerbiq_checking', receiverAccountId: 'dal_checking', amountCents: 500, date: '2026-04-01' })
    .forEach((d) => L.save(d.id, d.draft));
  assert.throws(() => L.save(receiverTxnId, { ...L.txns[receiverTxnId], transferAccountId: null, categoryId: cat('dal', 'other_income') }), /reimbursement/);
});

test('import: a deleted imported row is a duplicate, not new', () => {
  const rows = core.withFingerprints('dal_card', [{ date: '2026-03-01', payee: 'GITHUB', amountCents: -400 }]);
  const out = core.classifyRows(rows, [{ id: 'dal_card_x', ...rows[0], deleted: true }]);
  assert.equal(out[0].status, 'duplicate');
});

test('import: Chase CSV presets (checking + credit card) and card-payment pairing wording', () => {
  const card = 'Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n11/18/2026,11/19/2026,SUPABASE,Shopping,Sale,-25.00,\n11/20/2026,11/20/2026,Payment Thank You-Mobile,,Payment,500.00,\n11/21/2026,11/22/2026,AMAZON MKTPL,Shopping,Return,12.99,\n';
  const t1 = core.parseCsvText(card);
  assert.equal(core.detectPreset(t1[0]), 'chase_card');
  const r1 = core.applyMapping(t1, core.PRESETS.chase_card.mapping).rows;
  assert.deepEqual(r1.map((r) => [r.date, r.amountCents]), [['2026-11-18', -2500], ['2026-11-20', 50000], ['2026-11-21', 1299]]);
  assert.equal(core.isLikelyCardPayment(r1[1], 'credit_card'), true);
  // Chase checking rows carry a trailing comma (one more cell than the header).
  const bank = 'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\nCREDIT,11/19/2026,"STRIPE TRANSFER ST-ABC123",96.80,ACH_CREDIT,1096.80,,\nDEBIT,11/21/2026,"CHASE CREDIT CRD AUTOPAY PPD ID: 4760039224",-500.00,ACH_DEBIT,596.80,,\nCHECK,11/22/2026,"CHECK 1042",-75.00,CHECK_PAID,521.80,1042,\n';
  const t2 = core.parseCsvText(bank);
  assert.equal(core.detectPreset(t2[0]), 'chase_bank');
  const r2 = core.applyMapping(t2, core.PRESETS.chase_bank.mapping).rows;
  assert.deepEqual(r2.map((r) => [r.date, r.amountCents, r.memo]), [['2026-11-19', 9680, ''], ['2026-11-21', -50000, ''], ['2026-11-22', -7500, '1042']]);
  assert.equal(core.isLikelyCardPayment(r2[1], 'checking'), true);
  assert.equal(core.isLikelyCardPayment(r2[0], 'checking'), false);
});

test('import: Chase QFX/OFX (SGML) parses signed amounts and dedupes exactly by FITID', () => {
  const qfx = [
    'OFXHEADER:100', 'DATA:OFXSGML', 'VERSION:102', '', '<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>USD',
    '<CCACCTFROM><ACCTID>4111222233334444</CCACCTFROM><BANKTRANLIST><DTSTART>20261101',
    '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261118120000[0:GMT]<TRNAMT>-25.00<FITID>2026111824692161234<NAME>SUPABASE</STMTTRN>',
    '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261118<TRNAMT>-25.00<FITID>2026111824692161235<NAME>SUPABASE</STMTTRN>',
    '<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261120<TRNAMT>500.00<FITID>2026112000000000001<NAME>Payment Thank You-Mobile<MEMO>AUTOPAY</STMTTRN>',
    '</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>',
  ].join('\r\n');
  const parsed = core.parseOfx(qfx);
  assert.equal(parsed.accountType, 'credit_card');
  assert.equal(parsed.last4, '4444');
  assert.deepEqual(parsed.rows.map((r) => [r.date, r.amountCents, r.payee]), [['2026-11-18', -2500, 'SUPABASE'], ['2026-11-18', -2500, 'SUPABASE'], ['2026-11-20', 50000, 'Payment Thank You-Mobile']]);
  assert.equal(parsed.rows[2].memo, 'AUTOPAY');
  const fp = core.withFingerprints('zerbiq_card', parsed.rows);
  assert.notEqual(fp[0].fingerprint, fp[1].fingerprint);
  const again = core.classifyRows(core.withFingerprints('zerbiq_card', core.parseOfx(qfx).rows), fp.map((r, i) => ({ id: `zerbiq_x${i}`, ...r })));
  assert.deepEqual(again.map((r) => r.status), ['duplicate', 'duplicate', 'duplicate']);
  assert.deepEqual(core.parseOfx('not ofx').rows, []);
});

// ── Second review fixes ──────────────────────────────────────────────────
test('import pairing never adopts a categorized or non-payment entry (rent of the same amount)', () => {
  const checking = [
    { id: 'dal_rent', role: 'main', date: '2026-03-18', amountCents: -50000, payee: 'Landlord', categoryId: 'dal_cat_other_expense', transferAccountId: null, splits: [] },
    { id: 'dal_unc', role: 'main', date: '2026-03-19', amountCents: -50000, payee: 'MISC', categoryId: null, transferAccountId: null, splits: [] },
  ];
  const s = core.suggestTransfer({ date: '2026-03-21', payee: 'AUTOPAY PAYMENT THANK YOU', amountCents: 50000 }, 'credit_card', 'dal_checking', checking, new Set());
  assert.deepEqual(s, { transferAccountId: 'dal_checking', pairTxnId: null }, 'creates a new transfer instead of re-booking rent or an unrelated row');
  const pay = [...checking, { id: 'dal_pay', role: 'main', date: '2026-03-20', amountCents: -50000, payee: 'CHASE CREDIT CRD AUTOPAY', categoryId: null, transferAccountId: null, splits: [] }];
  assert.equal(core.suggestTransfer({ date: '2026-03-21', payee: 'Payment Thank You-Mobile', amountCents: 50000 }, 'credit_card', 'dal_checking', pay, new Set()).pairTxnId, 'dal_pay');
});

test('collapsing a split to one line keeps that line\'s leg (no recreate, reconciled leg stays valid)', () => {
  const L = makeLedger();
  const id = L.add('dal', { accountId: 'dal_checking', date: '2026-03-20', amountCents: -35000, payee: 'MIXED', splits: [
    { lineId: 'a1', transferAccountId: 'dal_card', amountCents: -30000 },
    { lineId: 'b2', categoryId: cat('dal', 'office'), amountCents: -5000 },
  ] });
  const legId = core.ids.leg(id, 'a1');
  L.txns[legId] = { ...L.txns[legId], status: 'reconciled', reconciliationId: 'dal_r1', fingerprint: 'fpX' };
  const t = L.txns[id];
  L.save(id, { ...t, amountCents: -30000, splits: t.splits.filter((l) => l.lineId === 'a1') });
  assert.equal(L.txns[id].lineId, 'a1');
  assert.equal(L.txns[id].transferAccountId, 'dal_card');
  assert.ok(L.txns[legId], 'same leg id');
  assert.equal(L.txns[legId].status, 'reconciled');
  assert.equal(L.txns[legId].fingerprint, 'fpX');
  assert.equal(L.txns[core.ids.leg(id, '0')], undefined);
  // Later plain edits (memo) keep the key too.
  L.save(id, { ...L.txns[id], memo: 'card payment' });
  assert.ok(L.txns[legId]);
});

test('import: the same charge from QFX (short name, posted date) after a CSV import is a possible duplicate', () => {
  const csv = core.withFingerprints('dal_checking', [{ date: '2026-10-03', payee: 'ORIG CO NAME:STRIPE ORIG ID:1800948598 DESC DATE:251003 CO ENTRY DESCR:TRANSFER', amountCents: 9680 }]);
  const existing = csv.map((r) => ({ id: 'dal_c1', ...r }));
  const qfx = core.withFingerprints('dal_checking', [{ date: '2026-10-04', payee: 'ORIG CO NAME:STRIPE ORIG ID:180', amountCents: 9680, fitid: 'F1' }]);
  const out = core.classifyRows(qfx, existing);
  assert.equal(out[0].status, 'possible');
  assert.equal(out[0].selected, false);
  // A genuinely different payment of the same amount stays new.
  const other = core.classifyRows(core.withFingerprints('dal_checking', [{ date: '2026-10-04', payee: 'ACME CLIENT', amountCents: 9680, fitid: 'F2' }]), existing);
  assert.equal(other[0].status, 'new');
});
