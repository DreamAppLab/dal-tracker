// Bulk "change category": pure planning for a recategorize and its undo.

const { linesOf, lineKey, planTransactionWrite } = require('./transactions');
const { belongsTo } = require('./constants');
const { normalizePayee } = require('./importer');

/**
 * Which category lines would move. Only main entries: transfer legs follow
 * their main, and an intercompany mirror's category is set on the other
 * company's main line ("Paid for …"), so those are reported as skipped.
 * Transfer and "paid for the other company" lines are never touched.
 *
 * @param {object[]} txns  the company's transactions
 * @param {object} q { companyId, payeeContains, fromCategoryId ('*' = any, '' = uncategorized), toCategoryId }
 * @returns {{ changes: {id, lineKey, line, from, to, cents, date, payee, accountId, status}[], txnCount, totalCents, reconciled, skipped: {id, date, payee, accountId, cents, reason}[] }}
 */
function planBulkRecategorize(txns, q) {
  const needle = normalizePayee(q.payeeContains);
  if (!needle) throw new Error('Enter part of the payee name.');
  if (!q.toCategoryId || !belongsTo(q.toCategoryId, q.companyId)) throw new Error('Pick the new category.');
  const from = q.fromCategoryId == null ? '*' : q.fromCategoryId;
  const changes = [];
  const skipped = [];
  const ids = new Set();
  let reconciled = 0;
  for (const t of txns) {
    if (t.companyId !== q.companyId || t.deleted) continue;
    if (!normalizePayee(t.payee).includes(needle)) continue;
    const base = { id: t.id, date: t.date, payee: t.payee, accountId: t.accountId };
    const role = t.role || 'main';
    if (role !== 'main') {
      if (role === 'mirror') skipped.push({ ...base, cents: t.amountCents, reason: 'Booked by the other company (change it in their books, on the “Paid for” line)' });
      continue;
    }
    const split = !!(t.splits && t.splits.length);
    let hit = false;
    linesOf(t).forEach((line, i) => {
      if (line.transferAccountId || line.icCategoryId) {
        skipped.push({ ...base, cents: line.amountCents, reason: line.icCategoryId ? 'Paid for the other company (intercompany line)' : 'Transfer between accounts' });
        return;
      }
      const cur = line.categoryId || '';
      if (cur === q.toCategoryId) return;
      if (from !== '*' && cur !== from) return;
      changes.push({ ...base, lineKey: split ? lineKey(t.splits[i], i) : null, line: split ? i : null, from: cur || null, to: q.toCategoryId, cents: line.amountCents, status: t.status });
      hit = true;
    });
    if (hit) { ids.add(t.id); if (t.status === 'reconciled') reconciled += 1; }
  }
  changes.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { changes, txnCount: ids.size, totalCents: changes.reduce((s, c) => s + c.cents, 0), reconciled, skipped };
}

/**
 * Does this change target the given split line? Matched by the same stable
 * key the legs/mirrors use (line id, or the position for older splits — the
 * split editor gives those lines that position as their id when saved).
 */
function sameLine(c, l, i) {
  if (c.lineKey != null) return lineKey(l, i) === c.lineKey;
  return c.line === i;
}

/**
 * New draft for one transaction given its changes ({lineKey, from, to}).
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
      const c = changes.find((x) => x.line != null && sameLine(x, l, i));
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

/**
 * Dry-run every affected row through the planner (it re-validates the whole
 * row: opening date, split totals, categories). Returns the plan without the
 * rows that would be refused, plus those rows and why.
 */
function validateBulk(plan, txnsById, accounts, categories) {
  const failed = [];
  const bad = new Set();
  for (const [id, list] of Object.entries(changesByTxn(plan.changes))) {
    const t = txnsById[id];
    try {
      if (!t) throw new Error('Transaction not found.');
      const { id: _drop, ...before } = t; // eslint-disable-line no-unused-vars
      const draft = applyCategoryChanges(before, list, 'apply');
      if (draft) planTransactionWrite({ id, draft, before, existing: {}, accounts, categories });
    } catch (e) {
      bad.add(id);
      failed.push({ id, date: t && t.date, payee: t && t.payee, accountId: t && t.accountId, error: e.message });
    }
  }
  if (!bad.size) return { plan, failed };
  const changes = plan.changes.filter((c) => !bad.has(c.id));
  const kept = new Set(changes.map((c) => c.id));
  return {
    plan: {
      ...plan,
      changes,
      txnCount: kept.size,
      totalCents: changes.reduce((s, c) => s + c.cents, 0),
      reconciled: [...kept].filter((id) => txnsById[id].status === 'reconciled').length,
    },
    failed,
  };
}

module.exports = { planBulkRecategorize, applyCategoryChanges, changesByTxn, validateBulk };
