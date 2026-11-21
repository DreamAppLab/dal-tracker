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
  const drops = live.filter((t) => t.source === 'migration' && hasReceipt(t) && !t.importMatched && !t.mergedInto);
  const keeps = live.filter((t) => t.source === 'import' || (t.source === 'migration' && !hasReceipt(t)));
  const used = new Set();
  const pairs = [];
  for (const d of drops.sort((a, b) => a.date.localeCompare(b.date))) {
    const k = keeps
      .filter((x) => x.id !== d.id && !used.has(x.id) && x.amountCents === d.amountCents && daysApart(x.date, d.date) <= window && payeesOverlap(x.payee, d.payee))
      .sort((a, b) => daysApart(a.date, d.date) - daysApart(b.date, d.date))[0];
    if (!k) continue;
    used.add(k.id);
    pairs.push({ keepId: k.id, dropId: d.id, date: d.date, keepDate: k.date, amountCents: d.amountCents, keepPayee: k.payee, dropPayee: d.payee, dropMemo: d.memo || '' });
  }
  return pairs;
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
  next.mergeBackup = backup;
  return next;
}

/** Undo mergedKeep. */
function unmergedKeep(keep) {
  const b = keep.mergeBackup || {};
  const next = { ...keep, memo: b.memo || '', projectId: b.projectId || null, attachmentUrl: b.attachmentUrl || null, attachmentPath: b.attachmentPath || null, mergedFrom: null, mergeBackup: null };
  if (b.filledCategory) next.categoryId = b.categoryId || null;
  return next;
}

module.exports = { findCardDuplicates, payeesOverlap, mergedKeep, unmergedKeep };
