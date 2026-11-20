// Cached monthly aggregates: one doc per company per month
//   ledgerMonthly/{companyId}_{YYYY-MM} = {
//     companyId, month,
//     acct: { [accountId]: netCents },      // account activity (balances)
//     cat:  { [categoryId|'_uncat']: cents }, // category line totals (P&L)
//     count
//   }
// Every transaction write applies monthlyDeltas(before, after) with atomic
// increments in the SAME batch, so balances and reports never need a
// full-collection read. rebuildMonthly() recomputes them from scratch.


const { ids, monthOf } = require('./constants');

const UNCAT = '_uncat';

function contributions(doc) {
  // eslint-disable-next-line global-require
  const { linesOf } = require('./transactions');
  if (!doc || doc.deleted) return null;
  const month = monthOf(doc.date);
  const out = { companyId: doc.companyId, month, acct: {}, cat: {}, count: 1 };
  out.acct[doc.accountId] = doc.amountCents;
  if (doc.role === 'leg') return out;
  for (const line of linesOf(doc)) {
    if (line.transferAccountId) continue;
    const key = line.categoryId || UNCAT;
    out.cat[key] = (out.cat[key] || 0) + line.amountCents;
  }
  return out;
}

function addInto(target, c, sign) {
  const key = ids.monthly(c.companyId, c.month);
  if (!target[key]) target[key] = { companyId: c.companyId, month: c.month, acct: {}, cat: {}, count: 0 };
  const t = target[key];
  for (const [k, v] of Object.entries(c.acct)) t.acct[k] = (t.acct[k] || 0) + sign * v;
  for (const [k, v] of Object.entries(c.cat)) t.cat[k] = (t.cat[k] || 0) + sign * v;
  t.count += sign * c.count;
}

function prune(deltas) {
  for (const [key, d] of Object.entries(deltas)) {
    for (const m of ['acct', 'cat']) {
      for (const [k, v] of Object.entries(d[m])) if (v === 0) delete d[m][k];
    }
    if (!Object.keys(d.acct).length && !Object.keys(d.cat).length && d.count === 0) delete deltas[key];
  }
  return deltas;
}

/** { [monthlyDocId]: { companyId, month, acct, cat, count } } increments. */
function monthlyDeltas(beforeDocs, afterDocs) {
  const out = {};
  for (const b of beforeDocs || []) {
    const c = contributions(b);
    if (c) addInto(out, c, -1);
  }
  for (const a of afterDocs || []) {
    const c = contributions(a);
    if (c) addInto(out, c, 1);
  }
  return prune(out);
}

function mergeDeltas(list) {
  const out = {};
  for (const deltas of list) {
    for (const d of Object.values(deltas || {})) addInto(out, d, 1);
  }
  return prune(out);
}

/** Recompute all monthly docs for a set of transactions (rebuild / migration / tests). */
function rebuildMonthly(txns) {
  return monthlyDeltas([], txns);
}

/** Apply deltas to an in-memory monthly map (tests, optimistic UI). */
function applyDeltas(monthlyById, deltas) {
  const out = { ...monthlyById };
  for (const [key, d] of Object.entries(deltas)) {
    const cur = out[key] ? { ...out[key], acct: { ...out[key].acct }, cat: { ...out[key].cat } } : { companyId: d.companyId, month: d.month, acct: {}, cat: {}, count: 0 };
    for (const [k, v] of Object.entries(d.acct)) cur.acct[k] = (cur.acct[k] || 0) + v;
    for (const [k, v] of Object.entries(d.cat)) cur.cat[k] = (cur.cat[k] || 0) + v;
    cur.count += d.count;
    out[key] = cur;
  }
  return out;
}

/** Account balance from opening balance + all monthly activity (optionally before a month). */
function accountBalance(account, accountId, monthlyDocs, opts) {
  const o = opts || {};
  let bal = (account && account.openingBalanceCents) || 0;
  for (const m of monthlyDocs) {
    if (o.beforeMonth && m.month >= o.beforeMonth) continue;
    if (o.throughMonth && m.month > o.throughMonth) continue;
    bal += (m.acct && m.acct[accountId]) || 0;
  }
  return bal;
}

module.exports = {
  UNCAT,
  contributions,
  monthlyDeltas,
  mergeDeltas,
  rebuildMonthly,
  applyDeltas,
  accountBalance,
};
