// Bulk "change category": pure planning for a recategorize and its undo.

const { linesOf } = require('./transactions');
const { belongsTo } = require('./constants');

const norm = (s) => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();

/**
 * Which category lines would move. Only main entries (legs and intercompany
 * mirrors follow their main; mirrors keep the other company's category),
 * never transfers or "paid for the other company" lines.
 *
 * @param {object[]} txns  the company's transactions
 * @param {object} q { companyId, payeeContains, fromCategoryId ('*' = any, '' = uncategorized), toCategoryId }
 * @returns {{ changes: {id, lineId, from, to, cents, date, payee, accountId, status}[], txnCount, totalCents, reconciled }}
 */
function planBulkRecategorize(txns, q) {
  const needle = norm(q.payeeContains);
  if (!needle) throw new Error('Enter part of the payee name.');
  if (!q.toCategoryId || !belongsTo(q.toCategoryId, q.companyId)) throw new Error('Pick the new category.');
  const from = q.fromCategoryId == null ? '*' : q.fromCategoryId;
  const changes = [];
  const ids = new Set();
  let reconciled = 0;
  for (const t of txns) {
    if (t.companyId !== q.companyId || t.deleted || (t.role || 'main') !== 'main') continue;
    if (!norm(t.payee).includes(needle)) continue;
    const split = !!(t.splits && t.splits.length);
    let hit = false;
    linesOf(t).forEach((line, i) => {
      if (line.transferAccountId || line.icCategoryId) return;
      const cur = line.categoryId || '';
      if (cur === q.toCategoryId) return;
      if (from !== '*' && cur !== from) return;
      changes.push({ id: t.id, lineId: split ? (line.lineId || null) : null, line: split ? i : null, from: cur || null, to: q.toCategoryId, cents: line.amountCents, date: t.date, payee: t.payee, accountId: t.accountId, status: t.status });
      hit = true;
    });
    if (hit) { ids.add(t.id); if (t.status === 'reconciled') reconciled += 1; }
  }
  changes.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { changes, txnCount: ids.size, totalCents: changes.reduce((s, c) => s + c.cents, 0), reconciled };
}

/**
 * New draft for one transaction given its changes ({lineId, from, to}).
 * direction 'apply' moves from → to; 'undo' moves to → from, and only where
 * the line still has the category the bulk change gave it (later manual
 * edits win). Returns undefined when nothing on the row changes.
 */
function applyCategoryChanges(before, changes, direction = 'apply') {
  if (!before || before.deleted) return undefined;
  const want = (c) => (direction === 'apply' ? { cur: c.from, next: c.to } : { cur: c.to, next: c.from });
  let changed = false;
  if (before.splits && before.splits.length) {
    const splits = before.splits.map((l, i) => {
      // Lines are matched by their stable id (older splits: by position).
      const c = changes.find((x) => x.line != null && (x.lineId ? x.lineId === l.lineId : x.line === i));
      if (!c) return l;
      const { cur, next } = want(c);
      if ((l.categoryId || null) !== (cur || null) || l.transferAccountId || l.icCategoryId) return l;
      changed = true;
      return { ...l, categoryId: next || null };
    });
    return changed ? { ...before, splits } : undefined;
  }
  const c = changes.find((x) => x.line == null);
  if (!c || before.transferAccountId || before.icCategoryId) return undefined;
  const { cur, next } = want(c);
  if ((before.categoryId || null) !== (cur || null)) return undefined;
  return { ...before, categoryId: next || null };
}

/** Group changes by transaction id. */
function changesByTxn(changes) {
  const m = {};
  changes.forEach((c) => { (m[c.id] = m[c.id] || []).push(c); });
  return m;
}

module.exports = { planBulkRecategorize, applyCategoryChanges, changesByTxn };
