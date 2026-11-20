// Cash-basis reports. P&L counts ONLY category lines whose category is income
// or expense. Excluded by construction:
//   - transfers (card payments, checking ↔ card) — they are transfer lines
//   - intercompany receivables — DAL's portion paid for Zerbiq is a transfer
//     line into "Due from Zerbiq" (Zerbiq books the expense via its mirror)
//   - equity (owner contributions / draws) — category kind 'equity'
//   - uncategorized lines — reported separately so they get fixed
// Month-aligned ranges use the cached monthly aggregates; custom ranges use a
// date-bounded transaction query and the same line logic.


const { UNCAT, contributions } = require('./aggregates');

// ── Dates (pure string math, UTC, no timezone drift) ──────────────────────
function parseDate(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function fmtDate(dt) {
  return dt.toISOString().slice(0, 10);
}
function addDays(s, n) {
  const dt = parseDate(s);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fmtDate(dt);
}
function lastDayOfMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function monthStart(s) {
  return `${String(s).slice(0, 7)}-01`;
}
function monthEnd(s) {
  const [y, m] = String(s).split('-').map(Number);
  return `${String(s).slice(0, 7)}-${String(lastDayOfMonth(y, m)).padStart(2, '0')}`;
}
function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}
function monthsBetween(fromMonth, toMonth) {
  const out = [];
  for (let m = fromMonth; m <= toMonth; m = addMonths(m, 1)) {
    out.push(m);
    if (out.length > 600) break;
  }
  return out;
}
function daysBetween(from, to) {
  return Math.round((parseDate(to) - parseDate(from)) / 86400000) + 1;
}

/** { from, to, label } for month | quarter | ytd | year relative to `anchor` (YYYY-MM-DD). */
function periodRange(kind, anchor) {
  const [y, m] = anchor.split('-').map(Number);
  if (kind === 'month') return { from: monthStart(anchor), to: monthEnd(anchor), kind };
  if (kind === 'quarter') {
    const qStart = Math.floor((m - 1) / 3) * 3 + 1;
    const from = `${y}-${String(qStart).padStart(2, '0')}-01`;
    const to = monthEnd(`${y}-${String(qStart + 2).padStart(2, '0')}-01`);
    return { from, to, kind };
  }
  if (kind === 'ytd') return { from: `${y}-01-01`, to: anchor, kind };
  if (kind === 'year') return { from: `${y}-01-01`, to: `${y}-12-31`, kind };
  throw new Error(`Unknown period ${kind}`);
}

/** The comparison period: previous month/quarter/year, same span last year for YTD, equal-length before a custom range. */
function priorRange(range) {
  const { from, to, kind } = range;
  if (kind === 'month') {
    const prev = addMonths(from.slice(0, 7), -1);
    return { from: `${prev}-01`, to: monthEnd(`${prev}-01`), kind };
  }
  if (kind === 'quarter') {
    const prev = addMonths(from.slice(0, 7), -3);
    return { from: `${prev}-01`, to: monthEnd(`${addMonths(prev, 2)}-01`), kind };
  }
  if (kind === 'ytd' || kind === 'year') {
    const shift = (s) => {
      const [y, mm, dd] = s.split('-').map(Number);
      const day = Math.min(dd, lastDayOfMonth(y - 1, mm));
      return `${y - 1}-${String(mm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    };
    return { from: shift(from), to: shift(to), kind };
  }
  const len = daysBetween(from, to);
  const prevTo = addDays(from, -1);
  return { from: addDays(prevTo, -(len - 1)), to: prevTo, kind: 'custom' };
}

function isMonthAligned(from, to) {
  return from === monthStart(from) && to === monthEnd(to);
}

// ── P&L ───────────────────────────────────────────────────────────────────
function pnlFromCatTotals(catTotals, categories) {
  const income = [];
  const expense = [];
  let uncategorizedCents = 0;
  let excludedEquityCents = 0;
  for (const [catId, cents] of Object.entries(catTotals)) {
    if (!cents) continue;
    if (catId === UNCAT) {
      uncategorizedCents += cents;
      continue;
    }
    const cat = categories[catId];
    const name = cat ? cat.name : 'Unknown category';
    if (!cat || cat.kind === 'equity') {
      if (cat) excludedEquityCents += cents;
      else uncategorizedCents += cents;
      continue;
    }
    if (cat.kind === 'income') income.push({ categoryId: catId, name, cents });
    else expense.push({ categoryId: catId, name, cents: -cents });
  }
  const byAmount = (a, b) => b.cents - a.cents || a.name.localeCompare(b.name);
  income.sort(byAmount);
  expense.sort(byAmount);
  const totalIncome = income.reduce((s, r) => s + r.cents, 0);
  const totalExpense = expense.reduce((s, r) => s + r.cents, 0);
  return {
    income,
    expense,
    totalIncome,
    totalExpense,
    net: totalIncome - totalExpense,
    uncategorizedCents,
    excludedEquityCents,
  };
}

function catTotalsFromMonthly(monthlyDocs, companyId, fromMonth, toMonth) {
  const totals = {};
  for (const m of monthlyDocs) {
    if (m.companyId !== companyId || m.month < fromMonth || m.month > toMonth) continue;
    for (const [k, v] of Object.entries(m.cat || {})) totals[k] = (totals[k] || 0) + v;
  }
  return totals;
}

function catTotalsFromTransactions(txns, companyId, from, to) {
  const totals = {};
  for (const t of txns) {
    if (t.companyId !== companyId || t.date < from || t.date > to) continue;
    const c = contributions(t);
    if (!c) continue;
    for (const [k, v] of Object.entries(c.cat)) totals[k] = (totals[k] || 0) + v;
  }
  return totals;
}

function pnlFromMonthly(monthlyDocs, categories, companyId, from, to) {
  if (!isMonthAligned(from, to)) throw new Error('pnlFromMonthly needs a month-aligned range');
  return pnlFromCatTotals(catTotalsFromMonthly(monthlyDocs, companyId, from.slice(0, 7), to.slice(0, 7)), categories);
}

function pnlFromTransactions(txns, categories, companyId, from, to) {
  return pnlFromCatTotals(catTotalsFromTransactions(txns, companyId, from, to), categories);
}

/** Line-level drill-down rows for one category (or '_uncat') in a range. */
function drillDown(txns, companyId, categoryId, from, to) {
  // eslint-disable-next-line global-require
  const { linesOf } = require('./transactions');
  const rows = [];
  for (const t of txns) {
    if (t.companyId !== companyId || t.deleted || t.role === 'leg' || t.date < from || t.date > to) continue;
    linesOf(t).forEach((line, i) => {
      if (line.transferAccountId) return;
      const key = line.categoryId || UNCAT;
      if (key !== categoryId) return;
      rows.push({ txnId: t.id, date: t.date, payee: t.payee, memo: line.memo || t.memo, accountId: t.accountId, cents: line.amountCents, line: i, split: Array.isArray(t.splits) && t.splits.length > 0 });
    });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.payee.localeCompare(b.payee));
}

/** Side-by-side current vs prior P&L rows. */
function comparePnl(current, prior) {
  const merge = (cur, pri) => {
    const map = new Map();
    cur.forEach((r) => map.set(r.categoryId, { categoryId: r.categoryId, name: r.name, cents: r.cents, priorCents: 0 }));
    pri.forEach((r) => {
      const row = map.get(r.categoryId) || { categoryId: r.categoryId, name: r.name, cents: 0, priorCents: 0 };
      row.priorCents = r.cents;
      map.set(r.categoryId, row);
    });
    return [...map.values()]
      .map((r) => ({ ...r, changeCents: r.cents - r.priorCents }))
      .sort((a, b) => b.cents - a.cents || b.priorCents - a.priorCents || a.name.localeCompare(b.name));
  };
  return {
    income: merge(current.income, prior.income),
    expense: merge(current.expense, prior.expense),
    totals: {
      income: [current.totalIncome, prior.totalIncome],
      expense: [current.totalExpense, prior.totalExpense],
      net: [current.net, prior.net],
    },
  };
}

// ── Series for charts ─────────────────────────────────────────────────────
function incomeVsExpenseByMonth(monthlyDocs, categories, companyId, fromMonth, toMonth) {
  return monthsBetween(fromMonth, toMonth).map((month) => {
    const p = pnlFromCatTotals(catTotalsFromMonthly(monthlyDocs, companyId, month, month), categories);
    return { month, income: p.totalIncome, expense: p.totalExpense, net: p.net };
  });
}

/** [{ month, [categoryId]: positive spend (expense) or income cents }] */
function categoryTrend(monthlyDocs, categories, companyId, categoryIds, fromMonth, toMonth) {
  return monthsBetween(fromMonth, toMonth).map((month) => {
    const totals = catTotalsFromMonthly(monthlyDocs, companyId, month, month);
    const row = { month };
    categoryIds.forEach((id) => {
      const cat = categories[id];
      const v = totals[id] || 0;
      row[id] = cat && cat.kind === 'expense' ? -v : v;
    });
    return row;
  });
}

/** Running balance of an account at the end of each month. */
function balanceSeries(monthlyDocs, account, accountId, companyId, fromMonth, toMonth) {
  let bal = (account && account.openingBalanceCents) || 0;
  const docs = monthlyDocs.filter((m) => m.companyId === companyId).sort((a, b) => a.month.localeCompare(b.month));
  for (const m of docs) if (m.month < fromMonth) bal += (m.acct && m.acct[accountId]) || 0;
  const byMonth = Object.fromEntries(docs.map((m) => [m.month, m]));
  return monthsBetween(fromMonth, toMonth).map((month) => {
    const m = byMonth[month];
    bal += (m && m.acct && m.acct[accountId]) || 0;
    return { month, balance: bal };
  });
}

module.exports = {
  parseDate,
  fmtDate,
  addDays,
  addMonths,
  monthStart,
  monthEnd,
  monthsBetween,
  daysBetween,
  periodRange,
  priorRange,
  isMonthAligned,
  pnlFromCatTotals,
  catTotalsFromMonthly,
  catTotalsFromTransactions,
  pnlFromMonthly,
  pnlFromTransactions,
  drillDown,
  comparePnl,
  incomeVsExpenseByMonth,
  categoryTrend,
  balanceSeries,
};
