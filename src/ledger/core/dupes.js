// Duplicate charges on a card (pure): a receipt-sourced migrated row (it has
// an attachment) that repeats a statement row — same amount, dates within a
// few days, payee sharing a word. The statement row is kept; the receipt row
// is merged into it.

const { normalizePayee } = require('./importer');

const NOISE = new Set(['INC', 'INC.', 'LLC', 'LLP', 'LTD', 'CORP', 'THE', 'COM', 'WWW', 'AND', 'FOR', 'CO.', 'PBC']);
const words = (p) => normalizePayee(p).replace(/[(),]/g, ' ').split(/\s+/)
  .map((w) => w.replace(/^[.\-/]+|[.\-/]+$/g, ''))
  .filter((w) => w.length >= 4 && !NOISE.has(w) && !/^\d+$/.test(w));

function payeesOverlap(a, b) {
  const wa = new Set(words(a));
  return words(b).some((w) => wa.has(w) || [...wa].some((x) => (x.length >= 5 && w.startsWith(x)) || (w.length >= 5 && x.startsWith(w))));
}

const daysApart = (a, b) => Math.abs((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
const hasReceipt = (t) => !!(t.attachmentUrl || t.attachmentPath);

/**
 * @returns {{ keepId, dropId, date, keepDate, amountCents, keepPayee, dropPayee, dropMemo }[]}
 */
function findCardDuplicates(txns, accountId, opts = {}) {
  const window = opts.windowDays == null ? 3 : opts.windowDays;
  const live = txns.filter((t) => t.accountId === accountId && !t.deleted && (t.role || 'main') === 'main' && !t.settlementId);
  const plain = (t) => !t.transferAccountId && !t.icCategoryId && !(t.splits && t.splits.length);
  const drops = live.filter((t) => t.source === 'migration' && hasReceipt(t) && !t.importMatched && !t.mergedInto && plain(t));
  const keeps = live.filter((t) => (t.source === 'import' || (t.source === 'migration' && !hasReceipt(t))) && !t.mergedFrom);
  // Maximum matching (each row used once), trying the closest dates first, so
  // two receipts near two statement rows both find their twin.
  const edges = new Map();
  for (const d of drops) {
    const list = keeps
      .filter((x) => x.id !== d.id && x.amountCents === d.amountCents && daysApart(x.date, d.date) <= window && payeesOverlap(x.payee, d.payee))
      .sort((a, b) => daysApart(a.date, d.date) - daysApart(b.date, d.date) || a.id.localeCompare(b.id));
    if (list.length) edges.set(d.id, list);
  }
  const keepOf = new Map(); // keep id -> drop
  const tryAssign = (d, seen) => {
    for (const x of edges.get(d.id) || []) {
      if (seen.has(x.id)) continue;
      seen.add(x.id);
      const other = keepOf.get(x.id);
      if (!other || tryAssign(other, seen)) { keepOf.set(x.id, d); return true; }
    }
    return false;
  };
  [...drops].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).forEach((d) => tryAssign(d, new Set()));
  const keepById = new Map(keeps.map((x) => [x.id, x]));
  const pairs = [];
  for (const [kid, d] of keepOf) {
    const x = keepById.get(kid);
    pairs.push({ keepId: x.id, dropId: d.id, date: d.date, keepDate: x.date, amountCents: d.amountCents, keepPayee: x.payee, dropPayee: d.payee, dropMemo: d.memo || '' });
  }
  return pairs.sort((a, b) => a.date.localeCompare(b.date));
}

const isBlankLine = (t) => !(t.splits && t.splits.length) && !t.categoryId && !t.transferAccountId;

/**
 * The kept row after a merge: gains the receipt, the notes, the project and
 * (if it had none) the category of the dropped row. `mergeBackup` holds what
 * it had before, for undo.
 */
function mergedKeep(keep, drop) {
  const backup = { memo: keep.memo || '', projectId: keep.projectId || null, attachmentUrl: keep.attachmentUrl || null, attachmentPath: keep.attachmentPath || null, categoryId: keep.categoryId || null, filledCategory: false };
  const next = { ...keep };
  if (!next.attachmentUrl && !next.attachmentPath) { next.attachmentUrl = drop.attachmentUrl || null; next.attachmentPath = drop.attachmentPath || null; }
  const dm = String(drop.memo || '').trim();
  if (dm && !String(next.memo || '').includes(dm)) next.memo = [next.memo, dm].filter(Boolean).join(' · ').slice(0, 1000);
  if (!next.projectId && drop.projectId) next.projectId = drop.projectId;
  if (isBlankLine(keep) && drop.categoryId && !(drop.splits && drop.splits.length)) { next.categoryId = drop.categoryId; backup.filledCategory = true; }
  next.mergedFrom = drop.id;
  // What the merge set, so undo only reverts fields nobody changed since.
  backup.applied = { memo: next.memo || '', projectId: next.projectId || null, attachmentUrl: next.attachmentUrl || null, attachmentPath: next.attachmentPath || null, categoryId: next.categoryId || null };
  next.mergeBackup = backup;
  return next;
}

/** Undo mergedKeep. */
function unmergedKeep(keep) {
  const b = keep.mergeBackup || {};
  const applied = b.applied || null;
  const next = { ...keep, mergedFrom: null, mergeBackup: null };
  const revert = (field, value) => { if (!applied || (keep[field] || null) === (applied[field] || null) || (field === 'memo' && (keep.memo || '') === (applied.memo || ''))) next[field] = value; };
  revert('memo', b.memo || '');
  revert('projectId', b.projectId || null);
  revert('attachmentUrl', b.attachmentUrl || null);
  revert('attachmentPath', b.attachmentPath || null);
  if (b.filledCategory) revert('categoryId', b.categoryId || null);
  return next;
}

module.exports = { findCardDuplicates, payeesOverlap, mergedKeep, unmergedKeep };
