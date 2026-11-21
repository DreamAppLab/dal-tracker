// Firestore data layer for Books. Every query is scoped by companyId (the
// rules refuse unscoped ledger queries) and date-bounded where it can grow.
import {
  arrayUnion, collection, doc, getDoc, getDocs, increment, onSnapshot, query, runTransaction, serverTimestamp,
  setDoc, where, writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { recordAuditEvent } from '../lib/audit';
import { apiFetch } from '../lib/apiClient';
import * as core from './core';

const { COL } = core;

export function newTxnId(companyId) {
  return `${companyId}_${doc(collection(db, COL.transactions)).id}`;
}
export function newId(companyId, kind) {
  return `${companyId}_${kind}_${doc(collection(db, COL.transactions)).id.slice(0, 12)}`;
}

const withId = (snap) => ({ id: snap.id, ...snap.data() });

/** Subscribe to a company-scoped collection. Returns unsubscribe. */
export function watchCompany(col, companyId, onRows, onError) {
  return onSnapshot(
    query(collection(db, col), where('companyId', '==', companyId)),
    (s) => onRows(s.docs.map(withId)),
    onError
  );
}

/** Register window: one account, dates >= from (inclusive). Live. */
export function watchAccountWindow(companyId, accountId, fromDate, onRows, onError) {
  return onSnapshot(
    query(
      collection(db, COL.transactions),
      where('companyId', '==', companyId),
      where('accountId', '==', accountId),
      where('date', '>=', fromDate)
    ),
    (s) => onRows(s.docs.map(withId)),
    onError
  );
}

export async function fetchRange(companyId, from, to) {
  const s = await getDocs(query(
    collection(db, COL.transactions),
    where('companyId', '==', companyId),
    where('date', '>=', from),
    where('date', '<=', to)
  ));
  return s.docs.map(withId);
}

export async function fetchAccountRange(companyId, accountId, from, to) {
  const s = await getDocs(query(
    collection(db, COL.transactions),
    where('companyId', '==', companyId),
    where('accountId', '==', accountId),
    where('date', '>=', from),
    where('date', '<=', to)
  ));
  return s.docs.map(withId);
}

/** Unreconciled rows of an account (for reconciliation). */
export async function fetchUnreconciled(companyId, accountId) {
  const s = await getDocs(query(
    collection(db, COL.transactions),
    where('companyId', '==', companyId),
    where('accountId', '==', accountId),
    where('status', 'in', ['uncleared', 'cleared'])
  ));
  return s.docs.map(withId);
}

export function watchFlag(companyId, field, value, onRows, onError) {
  return onSnapshot(
    query(collection(db, COL.transactions), where('companyId', '==', companyId), where(field, '==', value)),
    (s) => onRows(s.docs.map(withId)),
    onError
  );
}

export async function getTxn(id) {
  const s = await getDoc(doc(db, COL.transactions, id));
  return s.exists() ? withId(s) : null;
}

function stripId(t) {
  if (!t) return null;
  const { id, ...rest } = t;
  return rest;
}

/** Existing legs/mirrors implied by a main transaction. */
export async function loadLinked(mainId, before, accounts) {
  const out = {};
  if (!before) return out;
  const { legIds, mirrorIds } = core.linkedIdsOf(mainId, before, accounts);
  const snaps = await Promise.all([...legIds, ...mirrorIds].map((lid) => getDoc(doc(db, COL.transactions, lid))));
  snaps.forEach((s) => { if (s.exists()) out[s.id] = s.data(); });
  return out;
}

const incMap = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, increment(v)]));

/**
 * Monthly increment payload. Empty maps are OMITTED on purpose: with
 * { merge: true } an empty map value REPLACES the stored map (wiping its totals).
 */
export function monthlyPayload(d) {
  const out = { companyId: d.companyId, month: d.month, count: increment(d.count) };
  if (Object.keys(d.acct).length) out.acct = incMap(d.acct);
  if (Object.keys(d.cat).length) out.cat = incMap(d.cat);
  return out;
}

/** Apply a planner result to a Firestore batch (txn sets/deletes + monthly increments). */
export function addPlanToBatch(batch, plan) {
  plan.sets.forEach(({ id, data }) => {
    batch.set(doc(db, COL.transactions, id), { ...data, updatedAt: serverTimestamp() }, { merge: true });
  });
  plan.deletes.forEach(({ id }) => batch.delete(doc(db, COL.transactions, id)));
  Object.entries(plan.deltas).forEach(([id, d]) => {
    batch.set(
      doc(db, COL.monthly, id),
      monthlyPayload(d),
      { merge: true }
    );
  });
}

export function planOps(plan) {
  return plan.sets.length + plan.deletes.length + Object.keys(plan.deltas).length;
}

export async function commitPlan(plan) {
  const batch = writeBatch(db);
  addPlanToBatch(batch, plan);
  await batch.commit();
}

/**
 * Re-plan one or more main transactions inside a Firestore transaction: the
 * main docs and every linked leg/mirror are READ FRESH, so a stale screen or a
 * second tab can never apply the same aggregate delta twice.
 *   entries: [{ id, makeDraft: (freshBefore|null) => draft|null|undefined, linkedOverrides? }]
 *   makeDraft returning undefined skips the entry (e.g. an import row whose
 *   id already exists). linkedOverrides seeds own fields (status, fingerprint)
 *   of legs/mirrors that do not exist yet.
 */
export async function runPlans(entries, accounts, categories) {
  return runTransaction(db, async (tx) => {
    const plans = [];
    const reads = [];
    for (const e of entries) {
      const snap = await tx.get(doc(db, COL.transactions, e.id));
      const before = snap.exists() ? snap.data() : null;
      const draft = e.makeDraft(before);
      if (draft === undefined) continue;
      const wanted = new Set([
        ...Object.values(core.linkedIdsOf(e.id, before, accounts)).flat(),
        ...(draft ? Object.values(core.linkedIdsOf(e.id, draft, accounts)).flat() : []),
      ]);
      reads.push({ e, before, draft, wanted: [...wanted] });
    }
    for (const r of reads) {
      r.existing = {};
      for (const lid of r.wanted) {
        const ls = await tx.get(doc(db, COL.transactions, lid));
        if (ls.exists()) r.existing[lid] = ls.data();
      }
      for (const [lid, own] of Object.entries(r.e.linkedOverrides || {})) {
        if (!r.existing[lid]) r.existing[lid] = own;
      }
    }
    for (const r of reads) {
      plans.push(core.planTransactionWrite({ id: r.e.id, draft: r.draft, before: r.before, existing: r.existing, accounts, categories }));
    }
    const plan = core.mergePlans(plans);
    plan.sets.forEach(({ id, data }) => tx.set(doc(db, COL.transactions, id), { ...data, updatedAt: serverTimestamp() }, { merge: true }));
    plan.deletes.forEach(({ id }) => tx.delete(doc(db, COL.transactions, id)));
    Object.entries(plan.deltas).forEach(([id, d]) => {
      tx.set(doc(db, COL.monthly, id), monthlyPayload(d), { merge: true });
    });
    return { plan, befores: reads.map((r) => r.before) };
  });
}

/** Save (create or edit) a main transaction with all derived records. */
export async function saveTransaction({ id, draft, before, accounts, categories }) {
  const clean = stripId(draft);
  const { plan, befores } = await runPlans([{ id, makeDraft: () => clean }], accounts, categories);
  const prev = befores[0];
  // Audit edits that move money on an existing transaction.
  if (prev && (prev.amountCents !== clean.amountCents || prev.date !== clean.date || prev.accountId !== clean.accountId)) {
    recordAuditEvent('ledger_update', `ledgerTransactions/${id}`, {
      companyId: prev.companyId, fromAmountCents: prev.amountCents, toAmountCents: clean.amountCents, fromDate: prev.date, toDate: clean.date,
    });
  }
  return plan;
}

/** Ids that must change together: a reimbursement's two halves. */
function groupIds(txn) {
  const peer = txn.settlementId ? core.settlementPeerId(txn.id) : null;
  return peer ? [txn.id, peer] : [txn.id];
}

export async function setDeleted({ txn, deleted, accounts, categories }) {
  if (txn.role !== 'main') throw new Error('Delete linked entries from their main transaction.');
  const entries = groupIds(txn).map((id) => ({
    id,
    makeDraft: (before) => {
      if (!before) throw new Error('Transaction not found.');
      if (before.role !== 'main') throw new Error('Delete linked entries from their main transaction.');
      return { ...before, deleted: !!deleted };
    },
  }));
  const { plan } = await runPlans(entries, accounts, categories);
  recordAuditEvent(deleted ? 'ledger_delete' : 'ledger_restore', `ledgerTransactions/${txn.id}`, {
    companyId: txn.companyId, accountId: txn.accountId, date: txn.date, amountCents: txn.amountCents, bothCompanies: entries.length > 1,
  });
  return plan;
}

/** Permanently remove a soft-deleted main transaction and its legs/mirrors. */
export async function purgeDeleted({ txn, accounts, categories }) {
  const entries = groupIds(txn).map((id) => ({
    id,
    makeDraft: (before) => {
      if (before && !before.deleted) throw new Error('Only deleted transactions can be removed permanently.');
      return null;
    },
  }));
  const { plan } = await runPlans(entries, accounts, categories);
  // A purged auto-depreciation month stays skipped (it is not re-posted later).
  const depMatch = /^(.+)_dep_(\d{4}-\d{2})$/.exec(txn.id);
  if (txn.source === 'depreciation' && depMatch && accounts[depMatch[1]]) {
    await setDoc(doc(db, COL.accounts, depMatch[1]), { depreciationSkipMonths: arrayUnion(depMatch[2]), updatedAt: serverTimestamp() }, { merge: true });
  }
  recordAuditEvent('ledger_delete', `ledgerTransactions/${txn.id}`, {
    companyId: txn.companyId, accountId: txn.accountId, date: txn.date, amountCents: txn.amountCents, permanent: true,
  });
  return plan;
}

/** Create both halves of a reimbursement atomically. */
export async function recordSettlement(drafts, accounts, categories) {
  const { plan } = await runPlans(drafts.map((d) => ({ id: d.id, makeDraft: (before) => {
    if (before) throw new Error('Reimbursement already exists.');
    return d.draft;
  } })), accounts, categories);
  const payer = drafts[0].draft;
  recordAuditEvent('ledger_update', `ledgerTransactions/${drafts[0].id}`, { action: 'settlement', companyId: payer.companyId, amountCents: Math.abs(payer.amountCents), date: payer.date });
  return plan;
}

/** Status-only change (cleared flag) — no money moves, no aggregates. */
export async function setStatus(txn, status) {
  await setDoc(doc(db, COL.transactions, txn.id), { status, updatedAt: serverTimestamp() }, { merge: true });
}

export async function saveDoc(col, id, data, merge = true) {
  await setDoc(doc(db, col, id), { ...data, updatedAt: serverTimestamp() }, { merge });
}

export async function deleteRule(rule) {
  const batch = writeBatch(db);
  batch.delete(doc(db, COL.vendorRules, rule.id));
  await batch.commit();
  recordAuditEvent('ledger_delete', `ledgerVendorRules/${rule.id}`, { companyId: rule.companyId, pattern: rule.pattern });
}

/** Seed missing default accounts / categories / rules for a company (never overwrites). */
export async function seedCompany(companyId, existing, opening) {
  const batch = writeBatch(db);
  let n = 0;
  const add = (col, docs, have) => docs.forEach(({ id, data }) => {
    if (have.has(id)) return;
    batch.set(doc(db, col, id), { ...data, createdAt: serverTimestamp() });
    n += 1;
  });
  add(COL.accounts, core.defaultAccountDocs(companyId, opening), new Set(existing.accounts.map((a) => a.id)));
  add(COL.categories, core.defaultCategoryDocs(companyId), new Set(existing.categories.map((c) => c.id)));
  add(COL.vendorRules, core.defaultRuleDocs(companyId), new Set(existing.rules.map((r) => r.id)));
  if (n) await batch.commit();
  return n;
}

export async function finishReconciliation({ companyId, account, statementDate, startingBalanceCents, endingBalanceCents, txnIds }) {
  const recId = newId(companyId, 'rec');
  const ops = [];
  ops.push((b) => b.set(doc(db, COL.reconciliations, recId), {
    companyId,
    accountId: account.id,
    status: 'complete',
    statementDate,
    startingBalanceCents,
    endingBalanceCents,
    difference: 0,
    txnCount: txnIds.length,
    finishedAt: new Date().toISOString(),
    createdAt: serverTimestamp(),
  }));
  txnIds.forEach((id) => ops.push((b) => b.set(doc(db, COL.transactions, id), { status: 'reconciled', reconciliationId: recId, updatedAt: serverTimestamp() }, { merge: true })));
  // One atomic batch when possible (≤ 450 rows). Larger statements commit in
  // chunks with the record FIRST, so an interrupted finish can always be
  // undone from the history (and /unreconcile also unlocks orphaned rows).
  for (let i = 0; i < ops.length; i += 450) {
    const batch = writeBatch(db);
    ops.slice(i, i + 450).forEach((op) => op(batch));
    await batch.commit();
  }
  return recId;
}

export async function apiPost(path, body) {
  const res = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const RECEIPT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif'];

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = String(reader.result || '');
      resolve(r.slice(r.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

export async function uploadReceipt(txn, file) {
  const type = file.type === 'image/jpg' ? 'image/jpeg' : file.type;
  if (!RECEIPT_TYPES.includes(type)) throw new Error('Receipts must be a PDF or an image.');
  if (file.size > 3 * 1024 * 1024) throw new Error('Receipts must be 3 MB or smaller.');
  return apiPost('/api/ledger/receipt', { companyId: txn.companyId, txnId: txn.id, name: file.name.slice(0, 150), type, base64: await fileToBase64(file) });
}

/** Opens a receipt via a short-lived link (new tab opened first so pop-up blockers allow it). */
export async function openReceipt(txn) {
  if (!txn.attachmentPath && txn.attachmentUrl) {
    window.open(txn.attachmentUrl, '_blank', 'noopener');
    return;
  }
  const win = window.open('', '_blank');
  try {
    const { url } = await apiPost('/api/ledger/receipt-url', { companyId: txn.companyId, txnId: txn.id });
    if (win) { win.opener = null; win.location.href = url; } else window.open(url, '_blank', 'noopener');
  } catch (e) {
    if (win) win.close();
    throw e;
  }
}

/** Make sure a default category exists (books set up before it was a default). */
async function ensureCategory(companyId, categories, slug, name, kind) {
  const id = core.ids.category(companyId, slug);
  if (categories[id]) return id;
  const snap = await getDoc(doc(db, COL.categories, id));
  if (!snap.exists()) {
    await setDoc(doc(db, COL.categories, id), { companyId, name, kind, slug, sort: 30, archived: false, isDefault: true, createdAt: serverTimestamp() });
  }
  return id;
}
const ensureDepreciationCategory = (companyId, categories) => ensureCategory(companyId, categories, 'depreciation', 'Depreciation', 'expense');

/** New fixed-asset account (one per asset). Cost comes from its opening balance and/or transfers in. */
export async function createFixedAsset(companyId, f, categories) {
  const depId = await ensureDepreciationCategory(companyId, categories);
  const id = newId(companyId, 'fa');
  const data = {
    companyId,
    kind: 'fixed_asset',
    name: f.name,
    last4: '',
    // Owned before the books: opens at book value (cost − depreciation already taken).
    openingBalanceCents: (f.openingCostCents || 0) - (f.openingAccumulatedCents || 0),
    openingCostCents: f.openingCostCents || 0,
    openingAccumulatedCents: f.openingAccumulatedCents || 0,
    openingDate: f.openingDate,
    inServiceDate: f.inServiceDate,
    lifeMonths: f.lifeMonths,
    salvageCents: f.salvageCents || 0,
    method: 'straight_line',
    depreciationCategoryId: depId,
    vaultBankAccountId: null,
    vaultCreditCardId: null,
    archived: false,
    sort: 10,
    ...(f.fromTxnId ? { fromTxnId: f.fromTxnId } : {}),
  };
  await setDoc(doc(db, COL.accounts, id), { ...data, createdAt: serverTimestamp() });
  recordAuditEvent('ledger_update', `ledgerAccounts/${id}`, { action: 'fixed_asset_created', companyId, costCents: f.openingCostCents || 0 });
  return { id, data };
}

/**
 * "Make this a fixed asset": creates an asset from an expense and re-books
 * the expense as Transfer · [asset] (off the P&L, onto the depreciation
 * schedule). The original category is kept on the transaction for undo.
 */
export async function convertToFixedAsset(txn, f, accounts, categories) {
  if (txn.role !== 'main' || (txn.splits && txn.splits.length) || !txn.categoryId) throw new Error('Only a single-category expense can become a fixed asset.');
  if (txn.amountCents >= 0) throw new Error('Only a payment or charge can become a fixed asset.');
  const { id: assetId, data } = await createFixedAsset(txn.companyId, {
    name: f.name, acquiredDate: txn.date, openingDate: txn.date, inServiceDate: f.inServiceDate || txn.date,
    lifeMonths: f.lifeMonths, salvageCents: f.salvageCents || 0, openingCostCents: 0, openingAccumulatedCents: 0, fromTxnId: txn.id,
  }, categories);
  const accts = { ...accounts, [assetId]: { ...data, id: assetId } };
  await runPlans([{ id: txn.id, makeDraft: (before) => {
    if (!before || before.deleted) throw new Error('Transaction not found.');
    return { ...before, categoryId: null, icCategoryId: null, splits: [], transferAccountId: assetId, convertedFromCategoryId: before.categoryId };
  } }], accts, categories);
  recordAuditEvent('ledger_update', `ledgerTransactions/${txn.id}`, { action: 'converted_to_fixed_asset', companyId: txn.companyId, assetId, amountCents: txn.amountCents });
  return assetId;
}

/** Undo "Make this a fixed asset": removes its depreciation, restores the expense, archives the asset. */
export async function undoFixedAsset(txn, accounts, categories) {
  const asset = accounts[txn.transferAccountId];
  if (!txn.convertedFromCategoryId || !asset || asset.kind !== 'fixed_asset') throw new Error('This transaction was not turned into a fixed asset here.');
  const rows = await fetchAccountAll(txn.companyId, asset.id);
  const live = rows.filter((t) => !t.deleted);
  if (live.some((t) => t.source === 'disposal')) throw new Error('The asset has been sold or disposed of; undo that first.');
  const other = live.filter((t) => t.parentId !== txn.id && t.source !== 'depreciation');
  if (other.length || asset.openingBalanceCents) throw new Error('The asset has other entries (more purchases or adjustments). Remove them first.');
  const dep = live.filter((t) => t.source === 'depreciation');
  for (let i = 0; i < dep.length; i += 100) {
    // eslint-disable-next-line no-await-in-loop
    await runPlans(dep.slice(i, i + 100).map((t) => ({ id: t.id, makeDraft: (before) => (before && !before.deleted ? { ...before, deleted: true } : undefined) })), accounts, categories);
  }
  await runPlans([{ id: txn.id, makeDraft: (before) => {
    if (!before) throw new Error('Transaction not found.');
    return { ...before, transferAccountId: null, categoryId: before.convertedFromCategoryId, convertedFromCategoryId: null };
  } }], accounts, categories);
  await setDoc(doc(db, COL.accounts, asset.id), { archived: true, updatedAt: serverTimestamp() }, { merge: true });
  recordAuditEvent('ledger_update', `ledgerTransactions/${txn.id}`, { action: 'fixed_asset_undone', companyId: txn.companyId, assetId: asset.id, removedDepreciation: dep.length });
  return dep.length;
}

/** Sell or write off an asset: depreciation through the date, then one disposal entry, then archive. */
export async function disposeAsset(asset, { date, proceedsCents, proceedsAccountId, memo, today }, accounts, categories) {
  const pre = core.disposalPreflight(asset, await fetchAccountAll(asset.companyId, asset.id), date, today);
  if (pre.error) throw new Error(pre.error);
  // Auto depreciation already posted for months after the disposal is removed first.
  for (const id of pre.deleteIds) {
    // eslint-disable-next-line no-await-in-loop
    await runPlans([{ id, makeDraft: (before) => (before && !before.deleted ? { ...before, deleted: true } : undefined) }], accounts, categories);
  }
  await postDepreciation(asset, date, accounts, categories);
  const glId = await ensureCategory(asset.companyId, categories, 'asset_gain_loss', 'Gain (loss) on asset sales', 'income');
  const cats = categories[glId] ? categories : { ...categories, [glId]: { companyId: asset.companyId, name: 'Gain (loss) on asset sales', kind: 'income' } };
  const txns = await fetchAccountAll(asset.companyId, asset.id);
  const s = core.assetSummary(asset, txns, date);
  const draft = core.disposalDraft({ account: asset, bookValueCents: s.bookValueCents, date, proceedsCents, proceedsAccountId, gainLossCategoryId: glId, memo });
  await runPlans([{ id: `${asset.id}_disposal`, makeDraft: (before) => (before && !before.deleted ? undefined : draft) }], accounts, cats);
  await setDoc(doc(db, COL.accounts, asset.id), { archived: true, disposedDate: date, updatedAt: serverTimestamp() }, { merge: true });
  recordAuditEvent('ledger_update', `ledgerAccounts/${asset.id}`, { action: 'fixed_asset_disposed', companyId: asset.companyId, bookValueCents: s.bookValueCents, proceedsCents });
  return { bookValueCents: s.bookValueCents, gainCents: proceedsCents - s.bookValueCents };
}

/** All transactions of one account (fixed assets and intercompany accounts are small). */
export async function fetchAccountAll(companyId, accountId, through) {
  return fetchAccountRange(companyId, accountId, '1900-01-01', through || '2999-12-31');
}

/** Post straight-line depreciation for one asset through a date (idempotent ids). */
export async function postDepreciation(asset, throughDate, accounts, categories) {
  const depId = await ensureDepreciationCategory(asset.companyId, categories);
  const cats = categories[depId] ? categories : { ...categories, [depId]: { companyId: asset.companyId, name: 'Depreciation', kind: 'expense' } };
  const txns = await fetchAccountAll(asset.companyId, asset.id);
  // Posted / deleted months come from the entry ids inside depreciationToPost.
  const entries = core.depreciationToPost({ ...asset, depreciationCategoryId: asset.depreciationCategoryId || depId }, txns, throughDate);
  for (let i = 0; i < entries.length; i += 100) {
    await runPlans(entries.slice(i, i + 100).map((e) => ({ id: e.id, makeDraft: (before) => (before ? undefined : e.draft) })), accounts, cats);
  }
  if (entries.length) {
    recordAuditEvent('ledger_update', `ledgerAccounts/${asset.id}`, { action: 'depreciation_posted', companyId: asset.companyId, months: entries.length, through: throughDate });
  }
  return entries.length;
}

export async function prefsGet(uid) {
  const s = await getDoc(doc(db, COL.prefs, uid));
  return s.exists() ? s.data() : null;
}
export async function prefsSet(uid, data) {
  await setDoc(doc(db, COL.prefs, uid), { ...data, updatedAt: serverTimestamp() }, { merge: true });
}

export async function importRecordExists(id) {
  const s = await getDoc(doc(db, COL.imports, id));
  return s.exists() ? s.data() : null;
}

export { db, doc, writeBatch, serverTimestamp, COL };
