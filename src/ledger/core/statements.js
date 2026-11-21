// Financial statements (pure): balance sheet, trial balance, general ledger
// and the owner contributions & distributions report.
//
// Why the books always balance: every account balance is its opening balance
// plus its transactions, and every transaction's money is either a category
// line or a transfer line (whose leg cancels it). So
//   Σ account balances = Σ opening balances + Σ category lines
// and equity = opening-balance equity + net income (income/expense lines)
//            + owner contributions/draws (equity lines) + uncategorized lines.

const { UNCAT, contributions } = require('./aggregates');
const { catTotalsFromMonthly, pnlFromCatTotals, monthStart, monthEnd, addMonths, addDays: core_addDays } = require('./reports');

/** acct/cat totals for all activity with date ≤ asOf (month docs before asOf's month + that month's txns). */
function totalsAsOf({ monthly, monthTxns, companyId, asOf }) {
  const acct = {};
  const cat = {};
  const add = (target, src) => { for (const [k, v] of Object.entries(src || {})) target[k] = (target[k] || 0) + v; };
  const month = asOf.slice(0, 7);
  const wholeMonth = asOf === monthEnd(asOf);
  for (const m of monthly) {
    if (m.companyId !== companyId) continue;
    if (m.month < month || (wholeMonth && m.month === month)) {
      add(acct, m.acct);
      add(cat, m.cat);
    }
  }
  if (!wholeMonth) {
    for (const t of monthTxns || []) {
      if (t.companyId !== companyId || t.date < monthStart(asOf) || t.date > asOf) continue;
      const c = contributions(t);
      if (!c) continue;
      add(acct, c.acct);
      add(cat, c.cat);
    }
  }
  return { acct, cat };
}

/** Is a transactions fetch for asOf's month needed (asOf not a month end)? */
function needsMonthTxns(asOf) {
  return asOf !== monthEnd(asOf);
}

const KIND_ORDER = { checking: 1, credit_card: 2, intercompany: 3, fixed_asset: 4, personal: 5 };

/** An account's opening balance counts only from its opening date. */
function openingAsOf(a, asOf) {
  if (asOf && a.openingDate && asOf < a.openingDate) return 0;
  return a.openingBalanceCents || 0;
}

function equityCategoryRows(cat, categories) {
  const rows = [];
  for (const [id, cents] of Object.entries(cat)) {
    const c = categories[id];
    if (c && c.kind === 'equity' && cents) rows.push({ key: id, name: c.name, cents });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

function classify(account, balance) {
  if (account.kind === 'personal') return 'equity';
  if (account.kind === 'credit_card') return 'liability';
  if (account.kind === 'intercompany') return balance < 0 ? 'liability' : 'asset';
  return 'asset'; // checking, fixed_asset
}

/**
 * @param {object} p { accounts: [], categories: {id:cat}, totals (asOf), totalsBeforeFy, asOf, companyId, fixedAssets?: {accountId: summary} }
 */
function balanceSheet(p) {
  const { accounts, categories, totals, totalsBeforeFy, companyId } = p;
  const assets = [];
  const liabilities = [];
  const ownerPaid = [];
  let openingEquity = 0;
  for (const a of accounts) {
    if (a.companyId !== companyId) continue;
    const ob = openingAsOf(a, p.asOf);
    const bal = ob + (totals.acct[a.id] || 0);
    openingEquity += ob;
    if (!bal && a.archived) continue;
    const row = { accountId: a.id, name: a.name, kind: a.kind, cents: bal };
    if (a.kind === 'fixed_asset' && p.fixedAssets && p.fixedAssets[a.id]) {
      row.costCents = p.fixedAssets[a.id].costCents;
      row.accumulatedCents = p.fixedAssets[a.id].accumulatedCents;
    }
    const cls = classify(a, bal);
    // Paid personally: what the owners spent for the business is their contribution.
    if (cls === 'equity') { if (bal) ownerPaid.push({ key: `acct:${a.id}`, name: `Owner contributions · ${a.name}`, accountId: a.id, cents: -bal }); }
    else if (cls === 'asset') assets.push(row);
    else liabilities.push({ ...row, cents: bal ? -bal : 0 });
  }
  const order = { checking: 1, intercompany: 2, fixed_asset: 3, credit_card: 4 };
  const sortRows = (r) => r.sort((x, y) => (order[x.kind] || 9) - (order[y.kind] || 9) || x.name.localeCompare(y.name));
  sortRows(assets);
  sortRows(liabilities);

  const all = pnlFromCatTotals(totals.cat, categories);
  const prior = pnlFromCatTotals(totalsBeforeFy.cat, categories);
  const retained = prior.net;
  const currentNet = all.net - prior.net;
  const equity = [];
  if (openingEquity) equity.push({ key: 'opening', name: 'Opening balance equity', cents: openingEquity });
  equityCategoryRows(totals.cat, categories).forEach((r) => equity.push(r));
  ownerPaid.forEach((r) => equity.push(r));
  equity.push({ key: 'retained', name: 'Retained earnings (prior years)', cents: retained });
  equity.push({ key: 'net', name: 'Net income (this year)', cents: currentNet });
  if (all.uncategorizedCents) equity.push({ key: UNCAT, name: 'Uncategorized activity (needs review)', cents: all.uncategorizedCents, warn: true });

  const totalAssets = assets.reduce((s, r) => s + r.cents, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + r.cents, 0);
  const totalEquity = equity.reduce((s, r) => s + r.cents, 0);
  return {
    assets,
    liabilities,
    equity,
    totals: { assets: totalAssets, liabilities: totalLiabilities, equity: totalEquity, liabilitiesAndEquity: totalLiabilities + totalEquity },
    balanced: totalAssets === totalLiabilities + totalEquity,
  };
}

/**
 * Trial balance as of a date: balance-sheet accounts at their balances,
 * income/expense categories for the current fiscal year, prior years rolled
 * into retained earnings. Debits always equal credits.
 */
function trialBalance(p) {
  const { accounts, categories, totals, totalsBeforeFy, companyId } = p;
  const rows = [];
  const push = (name, group, signedDebit) => {
    if (!signedDebit) return;
    rows.push({ name, group, debit: signedDebit > 0 ? signedDebit : 0, credit: signedDebit < 0 ? -signedDebit : 0 });
  };
  let opening = 0;
  for (const a of accounts) {
    if (a.companyId !== companyId) continue;
    const ob = openingAsOf(a, p.asOf);
    opening += ob;
    push(a.kind === 'personal' ? `Owner contributions · ${a.name}` : a.name, a.kind === 'credit_card' ? 'Liabilities' : a.kind === 'intercompany' ? 'Intercompany' : a.kind === 'personal' ? 'Equity' : 'Assets', ob + (totals.acct[a.id] || 0));
  }
  push('Opening balance equity', 'Equity', -opening);
  const prior = pnlFromCatTotals(totalsBeforeFy.cat, categories);
  push('Retained earnings (prior years)', 'Equity', -prior.net);
  const ytd = {};
  for (const [id, v] of Object.entries(totals.cat)) ytd[id] = v - (totalsBeforeFy.cat[id] || 0);
  const catName = (id) => (id === UNCAT ? 'Uncategorized' : (categories[id] && categories[id].name) || 'Unknown category');
  for (const [id, v] of Object.entries(totals.cat)) {
    const c = categories[id];
    if (c && c.kind === 'equity') push(c.name, 'Equity', -v);
    else if (!c || id === UNCAT) {
      // Uncategorized / unknown: all time (they are not closed into retained earnings).
      push(catName(id), 'Needs review', -v);
    }
  }
  for (const [id, v] of Object.entries(ytd)) {
    const c = categories[id];
    if (c && (c.kind === 'income' || c.kind === 'expense')) push(c.name, c.kind === 'income' ? 'Income' : 'Expenses', -v);
  }
  // Prior-year uncategorized/unknown were excluded from retained earnings by pnlFromCatTotals, consistent with above.
  const groupOrder = ['Assets', 'Intercompany', 'Liabilities', 'Equity', 'Income', 'Expenses', 'Needs review'];
  rows.sort((a, b) => groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group) || a.name.localeCompare(b.name));
  const debit = rows.reduce((s, r) => s + r.debit, 0);
  const credit = rows.reduce((s, r) => s + r.credit, 0);
  return { rows, totals: { debit, credit }, balanced: debit === credit };
}

/**
 * General ledger for [from, to]: every balance-sheet account with its opening
 * balance, each transaction and a running balance; every category with its
 * lines for the period (opening = fiscal-year-to-date before `from` for income
 * and expense, all-time for equity).
 */
function generalLedger(p) {
  // eslint-disable-next-line global-require
  const { linesOf } = require('./transactions');
  const { accounts, categories, totalsBefore, totalsBeforeFyOfFrom, txns, companyId, from, to } = p;
  const inRange = txns.filter((t) => t.companyId === companyId && !t.deleted && t.date >= from && t.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
  const accountSections = accounts.filter((a) => a.companyId === companyId).map((a) => {
    const opening = openingAsOf(a, core_addDays(from, -1)) + (totalsBefore.acct[a.id] || 0);
    let bal = opening;
    const rows = inRange.filter((t) => t.accountId === a.id).map((t) => ({ txnId: t.id, date: t.date, payee: t.payee, memo: t.memo, cents: t.amountCents, role: t.role }));
    // An account opened inside the range starts with an "Opening balance" line.
    if (a.openingBalanceCents && a.openingDate && a.openingDate >= from && a.openingDate <= to) {
      rows.unshift({ txnId: null, date: a.openingDate, payee: 'Opening balance', memo: '', cents: a.openingBalanceCents, role: 'opening' });
      rows.sort((x, y) => x.date.localeCompare(y.date) || (x.role === 'opening' ? -1 : y.role === 'opening' ? 1 : 0));
    }
    const lines = rows.map((l) => {
      bal += l.cents;
      return { ...l, balance: bal };
    });
    return { id: a.id, name: a.name, kind: a.kind, opening, closing: bal, lines };
  }).filter((s) => s.opening || s.lines.length)
    .sort((x, y) => (KIND_ORDER[x.kind] || 9) - (KIND_ORDER[y.kind] || 9) || x.name.localeCompare(y.name));

  const catLines = {};
  for (const t of inRange) {
    if (t.role === 'leg') continue;
    linesOf(t).forEach((line) => {
      if (line.transferAccountId) return;
      const key = line.categoryId || UNCAT;
      (catLines[key] = catLines[key] || []).push({ txnId: t.id, date: t.date, payee: t.payee, memo: line.memo || t.memo, accountId: t.accountId, cents: line.amountCents });
    });
  }
  const catIds = new Set([...Object.keys(catLines), ...Object.keys(totalsBefore.cat).filter((k) => categories[k] && categories[k].kind === 'equity' && totalsBefore.cat[k])]);
  const categorySections = [...catIds].map((id) => {
    const c = categories[id];
    const isEquity = c && c.kind === 'equity';
    const openingRaw = isEquity || !c ? totalsBefore.cat[id] || 0 : (totalsBefore.cat[id] || 0) - (totalsBeforeFyOfFrom.cat[id] || 0);
    let run = openingRaw;
    let year = from.slice(0, 4);
    const lines = (catLines[id] || []).map((l) => {
      // Income and expense close into retained earnings each fiscal year (Jan 1).
      let yearStart = false;
      if (!isEquity && c && l.date.slice(0, 4) !== year) {
        year = l.date.slice(0, 4);
        run = 0;
        yearStart = true;
      }
      run += l.cents;
      return { ...l, balance: run, yearStart };
    });
    return { id, name: id === UNCAT ? 'Uncategorized' : c ? c.name : 'Unknown category', kind: c ? c.kind : 'uncategorized', opening: openingRaw, closing: run, lines };
  }).sort((a, b) => ['income', 'expense', 'equity', 'uncategorized'].indexOf(a.kind) - ['income', 'expense', 'equity', 'uncategorized'].indexOf(b.kind) || a.name.localeCompare(b.name));
  return { accounts: accountSections, categories: categorySections };
}

/**
 * Owner contributions & distributions in [from, to] (equity category lines):
 * positive lines are contributions, negative lines distributions (draws).
 */
function ownerEquityReport(p) {
  // eslint-disable-next-line global-require
  const { linesOf } = require('./transactions');
  const { categories, txns, companyId, from, to, totalsBefore } = p;
  const accounts = p.accounts || [];
  const personal = new Set(accounts.filter((a) => a.companyId === companyId && a.kind === 'personal').map((a) => a.id));
  const lines = [];
  for (const t of txns) {
    if (t.companyId !== companyId || t.deleted || t.date < from || t.date > to) continue;
    // Spending from "Paid personally" is an owner contribution (a refund or a
    // transfer back into it reduces it).
    if (personal.has(t.accountId) && t.amountCents) {
      // Money the business paid back to the owners (a transfer INTO Paid
      // personally, e.g. a payback from checking) is a distribution; the
      // account's own refunds reduce the contribution.
      const payback = t.role === 'leg' && t.amountCents > 0;
      lines.push({ txnId: t.id, date: t.date, payee: t.payee, memo: t.memo, accountId: t.accountId, categoryId: null, category: payback ? 'Paid back to the owners' : 'Paid personally', cents: -t.amountCents, personal: !payback });
    }
    if (t.role === 'leg') continue;
    linesOf(t).forEach((line) => {
      const c = line.categoryId && categories[line.categoryId];
      if (!c || c.kind !== 'equity' || c.equityType === 'opening') return;
      lines.push({ txnId: t.id, date: t.date, payee: t.payee, memo: line.memo || t.memo, accountId: t.accountId, categoryId: line.categoryId, category: c.name, cents: line.amountCents });
    });
  }
  lines.sort((a, b) => a.date.localeCompare(b.date) || a.payee.localeCompare(b.payee));
  const byMonth = {};
  let contributions = 0;
  let distributions = 0;
  for (const l of lines) {
    const m = l.date.slice(0, 7);
    if (!byMonth[m]) byMonth[m] = { month: m, contributions: 0, distributions: 0 };
    // A refund in "Paid personally" reduces the contribution (it isn't a draw).
    if (l.cents > 0 || l.personal) { byMonth[m].contributions += l.cents; contributions += l.cents; } else { byMonth[m].distributions += -l.cents; distributions += -l.cents; }
  }
  const months = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addMonths(m, 1)) {
    months.push(byMonth[m] ? { ...byMonth[m], net: byMonth[m].contributions - byMonth[m].distributions } : { month: m, contributions: 0, distributions: 0, net: 0 });
    if (months.length > 240) break;
  }
  let openingNet = 0;
  for (const [id, v] of Object.entries(totalsBefore.cat)) if (categories[id] && categories[id].kind === 'equity' && categories[id].equityType !== 'opening') openingNet += v;
  for (const id of personal) openingNet += -((totalsBefore.acct || {})[id] || 0);
  return { lines, months, totals: { contributions, distributions, net: contributions - distributions }, openingNetCents: openingNet, closingNetCents: openingNet + contributions - distributions };
}

const NO_PROJECT = '_none';

/**
 * Income and expense by project/app for [from, to] (cash basis, category
 * lines only — transfers and equity excluded). A line's project is its own
 * projectId, else its transaction's; untagged lines go to "No project".
 */
function projectReport({ txns, categories, projects, companyId, from, to }) {
  // eslint-disable-next-line global-require
  const { linesOf } = require('./transactions');
  const rows = {};
  const row = (id) => {
    if (!rows[id]) {
      const p = projects[id];
      rows[id] = { projectId: id, name: id === NO_PROJECT ? 'No project' : p ? p.name : 'Unknown project', archived: !!(p && p.archived), income: 0, expense: 0, lines: [] };
    }
    return rows[id];
  };
  for (const t of txns) {
    if (t.companyId !== companyId || t.deleted || t.role === 'leg' || t.date < from || t.date > to) continue;
    linesOf(t).forEach((line, lineIndex) => {
      const c = line.categoryId && categories[line.categoryId];
      if (!c || (c.kind !== 'income' && c.kind !== 'expense')) return;
      const pid = line.projectId || t.projectId || NO_PROJECT;
      const r = row(pid);
      if (c.kind === 'income') r.income += line.amountCents; else r.expense += -line.amountCents;
      r.lines.push({ txnId: t.id, line: lineIndex, split: !!(t.splits && t.splits.length), date: t.date, payee: t.payee, memo: line.memo || t.memo, accountId: t.accountId, categoryId: line.categoryId, category: c.name, cents: line.amountCents });
    });
  }
  const list = Object.values(rows).map((r) => ({ ...r, net: r.income - r.expense, lines: r.lines.sort((a, b) => a.date.localeCompare(b.date)) }))
    .sort((a, b) => (a.projectId === NO_PROJECT) - (b.projectId === NO_PROJECT) || b.expense - a.expense || b.income - a.income || a.name.localeCompare(b.name));
  const totals = list.reduce((acc, r) => ({ income: acc.income + r.income, expense: acc.expense + r.expense }), { income: 0, expense: 0 });
  return { rows: list, totals: { ...totals, net: totals.income - totals.expense } };
}

/**
 * Spending / transactions report: income and expense lines for [from, to]
 * across all of a company's accounts (or one), filtered by payee text,
 * categories, project and account, grouped by payee / category / project /
 * month / account. Same lines as the P&L (cash basis: transfers, owner
 * equity, uncategorized and deleted rows excluded; split lines by their own
 * category and amount; refunds net against their category), so with no
 * filters its totals equal the P&L. "Paid for <other company>" lines are
 * included only when asked for (includeIntercompany, or picked as a category
 * `ic:<categoryId>`); they are not in either P&L total.
 *
 * @param {object} p { txns, categories, otherCategories?, otherName?, accounts?, projects?, companyId, from, to,
 *                     filters: { payee?, categoryIds?: string[], projectId?, accountId?, includeIntercompany? }, groupBy }
 */
function spendingReport(p) {
  // eslint-disable-next-line global-require
  const { linesOf } = require('./transactions');
  // eslint-disable-next-line global-require
  const { normalizePayee } = require('./importer');
  const { txns, categories, companyId, from, to } = p;
  const f = p.filters || {};
  const groupBy = p.groupBy || 'payee';
  const otherCats = p.otherCategories || {};
  const accounts = p.accounts || {};
  const projects = p.projects || {};
  // Payee filter: like vendor rules; if that strips everything (e.g. "1099"), a plain match. Notes count too.
  const needle = f.payee ? normalizePayee(f.payee) : '';
  const raw = f.payee ? String(f.payee).trim().toLowerCase() : '';
  const payeeHit = (t) => {
    if (!raw) return true;
    if (needle) return normalizePayee(t.payee).includes(needle) || normalizePayee(t.memo).includes(needle);
    return `${t.payee || ''} ${t.memo || ''}`.toLowerCase().includes(raw);
  };
  const catSet = f.categoryIds && f.categoryIds.length ? new Set(f.categoryIds) : null;
  const includeIc = !!f.includeIntercompany || !!(catSet && [...catSet].some((k) => k.startsWith('ic:')));
  const groups = {};
  const totals = { spent: 0, received: 0, intercompany: 0, uncategorized: 0, count: 0 };
  for (const t of txns) {
    if (t.companyId !== companyId || t.deleted || t.role === 'leg' || t.date < from || t.date > to) continue;
    if (f.accountId && t.accountId !== f.accountId) continue;
    if (!payeeHit(t)) continue;
    linesOf(t).forEach((line, i) => {
      let key;
      let name;
      let kind;
      const isIcLine = !!(line.transferAccountId && (accounts[line.transferAccountId] || {}).kind === 'intercompany') || !!line.icCategoryId;
      if (line.categoryId && categories[line.categoryId]) {
        const c = categories[line.categoryId];
        if (c.kind !== 'income' && c.kind !== 'expense') return; // owner money
        key = line.categoryId;
        name = c.name;
        kind = c.kind;
      } else if (isIcLine) {
        if (!includeIc) return;
        key = `ic:${line.icCategoryId || ''}`;
        name = `Paid for ${p.otherName || 'the other company'} · ${(otherCats[line.icCategoryId] || {}).name || 'no category yet'}`;
        kind = 'intercompany';
      } else if (!line.transferAccountId) {
        // Not in the P&L either (it flags these): shown apart so a search never misses them.
        key = '_uncat';
        name = 'Uncategorized (not in P&L)';
        kind = 'uncategorized';
      } else {
        return; // transfer between accounts
      }
      // "Include paid for …" adds those lines even when specific categories are picked.
      if (catSet && !catSet.has(key) && !(kind === 'intercompany' && f.includeIntercompany)) return;
      const pid = line.projectId || t.projectId || NO_PROJECT;
      if (f.projectId && pid !== f.projectId) return;
      let gKey;
      let gName;
      if (groupBy === 'category') { gKey = key; gName = name; }
      else if (groupBy === 'project') { gKey = pid; gName = pid === NO_PROJECT ? 'No project' : (projects[pid] || {}).name || 'Unknown project'; }
      else if (groupBy === 'month') { gKey = t.date.slice(0, 7); gName = gKey; }
      else if (groupBy === 'account') { gKey = t.accountId; gName = (accounts[t.accountId] || {}).name || t.accountId; }
      else { gKey = normalizePayee(t.payee) || '(no payee)'; gName = t.payee || '(no payee)'; }
      if (!groups[gKey]) groups[gKey] = { key: gKey, name: gName, spent: 0, received: 0, intercompany: 0, uncategorized: 0, lines: [] };
      const g = groups[gKey];
      const amt = line.amountCents;
      if (kind === 'expense') { g.spent += -amt; totals.spent += -amt; }
      else if (kind === 'income') { g.received += amt; totals.received += amt; }
      else if (kind === 'intercompany') { g.intercompany += -amt; totals.intercompany += -amt; }
      else { g.uncategorized += -amt; totals.uncategorized += -amt; }
      totals.count += 1;
      g.lines.push({ txnId: t.id, line: i, split: !!(t.splits && t.splits.length), date: t.date, payee: t.payee, memo: line.memo || t.memo, accountId: t.accountId, categoryId: line.categoryId || null, category: name, projectId: pid === NO_PROJECT ? null : pid, cents: amt });
    });
  }
  const rows = Object.values(groups).map((g) => ({ ...g, net: g.received - g.spent, count: g.lines.length, lines: g.lines.sort((a, b) => a.date.localeCompare(b.date)) }));
  if (groupBy === 'month') rows.sort((a, b) => a.key.localeCompare(b.key));
  else rows.sort((a, b) => (b.spent + b.intercompany) - (a.spent + a.intercompany) || b.received - a.received || a.name.localeCompare(b.name));
  return { rows, totals: { ...totals, net: totals.received - totals.spent }, groupBy };
}

module.exports = { NO_PROJECT, projectReport, spendingReport, totalsAsOf, needsMonthTxns, balanceSheet, trialBalance, generalLedger, ownerEquityReport, catTotalsFromMonthly };
