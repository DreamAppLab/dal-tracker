// Transaction model + the write planner.
//
// A transaction ("main") lives in one account. Its money is described by
// LINES: either its `splits[]`, or one implied line built from its own
// categoryId / transferAccountId. A line goes to exactly one of:
//   - a category                 (income / expense / equity)
//   - a transfer account         (another account of the SAME company)
//   - nothing                    (uncategorized → shows in the review queue)
//
// Linked records are DERIVED from the main transaction and rewritten by the
// planner on every save, so the books always balance:
//   - leg:    the other side of a transfer line, in the transfer account
//             (amount negated). Card payments, intercompany due-from/to legs.
//   - mirror: when a line goes to the company's intercompany account and is
//             not a settlement, the OTHER company gets an expense/income in its
//             own intercompany account ("Due to …"), category = line.icCategoryId.
//
// Sign convention: amountCents is the effect on the account from an asset
// point of view. Checking: + deposit, − payment. Card: − charge, + payment or
// credit. Intercompany: + receivable (due from), − payable (due to).


const { assertCents, sumCents } = require('./money');
const {
  COMPANY_IDS,
  STATUSES,
  DATE_RE,
  belongsTo,
  companyOfId,
  ids,
  monthOf,
  otherCompany,
} = require('./constants');

class LedgerError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'LedgerError';
    this.code = code || 'invalid';
  }
}

const TXN_FIELDS = [
  'companyId', 'accountId', 'date', 'amountCents', 'payee', 'memo', 'status',
  'reconciliationId', 'type', 'categoryId', 'transferAccountId', 'icCategoryId',
  'splits', 'needsCategory', 'deleted', 'parentId', 'parentLine', 'role',
  'settlementId', 'fingerprint', 'importId', 'source', 'project', 'attachmentUrl',
  'checkNumber', 'legacyExpenseId', 'parentLineKey', 'attachmentPath', 'lineId',
  'projectId', 'convertedFromCategoryId', 'legacyProjectLinked', 'legacyNotesAdded',
  'personalMovedFrom', 'coversHistoricalCents',
];

// Fields a linked leg/mirror keeps for itself across re-plans (its own
// cleared/reconciled state and import match), everything else is derived.
const OWN_FIELDS = ['status', 'reconciliationId', 'fingerprint', 'importId', 'attachmentUrl', 'attachmentPath'];

const LINE_ID_RE = /^[a-z0-9]{1,12}$/;

/**
 * Stable key of a line, used in the ids of its derived leg/mirror so that
 * deleting or reordering OTHER split lines never recreates them (they keep
 * their own cleared/reconciled status and import fingerprint). Lines saved
 * before line ids existed fall back to their index.
 */
function lineKey(line, index) {
  return line && LINE_ID_RE.test(String(line.lineId || '')) ? line.lineId : String(index);
}

// -0 would be stored as a double (rules require an int); always write +0.
const noNegZero = (v) => (v === 0 ? 0 : v);

function cleanLine(line) {
  const out = {
    categoryId: line.categoryId || null,
    transferAccountId: line.transferAccountId || null,
    icCategoryId: line.icCategoryId || null,
    amountCents: noNegZero(line.amountCents),
    memo: String(line.memo || '').slice(0, 300),
  };
  if (LINE_ID_RE.test(String(line.lineId || ''))) out.lineId = line.lineId;
  if (line.projectId) out.projectId = line.projectId;
  return out;
}

/** The money lines of a transaction (splits, or one implied line). */
function linesOf(txn) {
  if (Array.isArray(txn.splits) && txn.splits.length) return txn.splits.map(cleanLine);
  return [
    cleanLine({
      categoryId: txn.categoryId,
      transferAccountId: txn.transferAccountId,
      icCategoryId: txn.icCategoryId,
      amountCents: txn.amountCents,
      memo: '',
      lineId: txn.lineId,
      projectId: txn.projectId,
    }),
  ];
}

function isIcAccount(accounts, accountId) {
  const a = accounts[accountId];
  return !!(a && a.kind === 'intercompany');
}

function deriveType(txn, accounts, categories) {
  if (txn.role === 'leg') return isIcAccount(accounts, txn.accountId) || isIcAccount(accounts, txn.transferAccountId) ? 'intercompany' : 'transfer';
  if (txn.settlementId) return 'intercompany';
  const lines = linesOf(txn);
  const transfers = lines.filter((l) => l.transferAccountId);
  const catLines = lines.filter((l) => l.categoryId);
  if (transfers.length === lines.length) {
    return transfers.some((l) => isIcAccount(accounts, l.transferAccountId)) ? 'intercompany' : 'transfer';
  }
  const kinds = catLines.map((l) => (categories[l.categoryId] || {}).kind).filter(Boolean);
  if (kinds.length && kinds.every((k) => k === 'equity')) return 'equity';
  if (kinds.includes('expense')) return 'expense';
  if (kinds.includes('income')) return 'income';
  if (transfers.length && transfers.every((l) => isIcAccount(accounts, l.transferAccountId)) && !catLines.length) return 'intercompany';
  return txn.amountCents >= 0 ? 'income' : 'expense';
}

function needsCategory(txn) {
  if (txn.role === 'leg') return false;
  return linesOf(txn).some((l) => !l.categoryId && !l.transferAccountId);
}

/** Fill defaults and validate a main transaction draft. Throws LedgerError. */
function normalizeMain(draft, accounts, categories) {
  const t = {};
  for (const f of TXN_FIELDS) if (draft[f] !== undefined) t[f] = draft[f];
  t.role = t.role || 'main';
  t.payee = String(t.payee || '').trim().slice(0, 200);
  t.memo = String(t.memo || '').trim().slice(0, 1000);
  t.status = t.status || 'uncleared';
  t.reconciliationId = t.reconciliationId || null;
  t.categoryId = t.categoryId || null;
  t.transferAccountId = t.transferAccountId || null;
  t.icCategoryId = t.icCategoryId || null;
  t.splits = Array.isArray(t.splits) ? t.splits.map(cleanLine) : [];
  t.deleted = !!t.deleted;
  t.parentId = t.parentId || null;
  t.parentLine = t.parentLine == null ? null : t.parentLine;
  t.settlementId = t.settlementId || null;
  t.fingerprint = t.fingerprint || null;
  t.importId = t.importId || null;
  t.source = t.source || 'manual';
  t.project = t.project || null;
  t.attachmentUrl = t.attachmentUrl || null;
  t.checkNumber = t.checkNumber || null;
  t.legacyExpenseId = t.legacyExpenseId || null;
  t.parentLineKey = t.parentLineKey || null;
  t.attachmentPath = t.attachmentPath || null;
  t.lineId = LINE_ID_RE.test(String(t.lineId || '')) ? t.lineId : null;
  t.projectId = t.projectId || null;
  if (t.coversHistoricalCents != null && !(Number.isInteger(t.coversHistoricalCents) && t.coversHistoricalCents >= 0
    && t.coversHistoricalCents <= Math.abs(Number(t.amountCents) || 0))) throw new LedgerError('The amount marked as already paid before Books is not valid.');
  t.convertedFromCategoryId = t.convertedFromCategoryId || null;
  if (t.projectId && !belongsTo(t.projectId, t.companyId)) throw new LedgerError('That project belongs to the other company.');
  for (const sp of t.splits || []) {
    if (sp.projectId && !belongsTo(sp.projectId, t.companyId)) throw new LedgerError('A split line uses a project of the other company.');
  }

  const c = t.companyId;
  if (!COMPANY_IDS.includes(c)) throw new LedgerError('Pick a company.');
  if (!belongsTo(draft.id, c)) throw new LedgerError('Transaction id does not belong to this company.');
  if (!belongsTo(t.accountId, c) || !accounts[t.accountId]) throw new LedgerError('Pick an account in this company.');
  if (!DATE_RE.test(String(t.date || ''))) throw new LedgerError('Enter a valid date (YYYY-MM-DD).');
  assertCents(t.amountCents, 'Amount');
  t.amountCents = noNegZero(t.amountCents);
  if (!STATUSES.includes(t.status)) throw new LedgerError('Invalid status.');
  if (t.splits.length === 1) {
    // A single split is just a category.
    const only = t.splits[0];
    t.categoryId = only.categoryId;
    t.transferAccountId = only.transferAccountId;
    t.icCategoryId = only.icCategoryId;
    t.projectId = only.projectId || t.projectId || null;
    // Keep the surviving line's key so its leg/mirror (and their cleared /
    // reconciled state) are not recreated under a different id.
    t.lineId = only.lineId;
    t.splits = [];
  }
  if (t.splits.length) {
    if (t.splits.length > 50) throw new LedgerError('A transaction can have at most 50 split lines.');
    t.splits.forEach((s) => assertCents(s.amountCents, 'Split amount'));
    const total = sumCents(t.splits.map((s) => s.amountCents));
    if (total !== t.amountCents) {
      throw new LedgerError(`Split lines add up to ${total} cents but the transaction is ${t.amountCents} cents.`, 'split_mismatch');
    }
    t.categoryId = null;
    t.transferAccountId = null;
    t.icCategoryId = null;
    t.lineId = null;
    const keys = t.splits.map(lineKey);
    if (new Set(keys).size !== keys.length) throw new LedgerError('Split lines must have unique ids.');
  }
  const opening = accounts[t.accountId].openingDate;
  if (opening && t.date < opening) {
    throw new LedgerError(`${accounts[t.accountId].name} opens on ${opening}. Move the account's opening date earlier in Setup to record older transactions.`, 'before_opening');
  }
  if (t.settlementId) {
    const icId = t.splits.length ? null : t.transferAccountId;
    if (!icId || !isIcAccount(accounts, icId)) {
      throw new LedgerError('An intercompany reimbursement can only move money to the intercompany account. Edit it from the Intercompany screen.', 'settlement');
    }
  }
  // Validate in place (t itself carries the single implied line's fields).
  for (const line of t.splits.length ? t.splits : [t]) {
    if (line.categoryId && line.transferAccountId) throw new LedgerError('A line cannot have both a category and a transfer.');
    if (line.categoryId) {
      if (!belongsTo(line.categoryId, c)) throw new LedgerError('That category belongs to the other company.');
      if (categories && !categories[line.categoryId]) throw new LedgerError('Unknown category.');
    }
    if (line.transferAccountId) {
      if (!belongsTo(line.transferAccountId, c) || !accounts[line.transferAccountId]) {
        throw new LedgerError('Transfers must stay inside the same company. Use Intercompany for the other company.');
      }
      if (line.transferAccountId === t.accountId) throw new LedgerError('Cannot transfer an account to itself.');
      const target = accounts[line.transferAccountId];
      if (target.openingDate && t.date < target.openingDate) {
        throw new LedgerError(`${target.name} opens on ${target.openingDate}. Move its opening date earlier in Setup first.`, 'before_opening');
      }
      if (isIcAccount(accounts, line.transferAccountId)) {
        if (line.icCategoryId && !belongsTo(line.icCategoryId, otherCompany(c))) {
          throw new LedgerError('The intercompany category must belong to the other company.');
        }
      } else if (line.icCategoryId) {
        line.icCategoryId = null;
      }
    } else if (line.icCategoryId) {
      throw new LedgerError('Intercompany category set without an intercompany line.');
    }
  }
  if (isIcAccount(accounts, t.accountId) && t.role === 'main' && !t.settlementId) {
    // Intercompany registers are maintained by the planner.
    throw new LedgerError('Intercompany accounts are updated automatically. Record the expense in checking or the card.');
  }
  t.type = deriveType(t, accounts, categories || {});
  t.needsCategory = needsCategory(t);
  return t;
}

function buildLeg(main, line, index, existing, accounts) {
  const key = lineKey(line, index);
  const keep = {};
  if (existing) for (const f of OWN_FIELDS) if (existing[f] !== undefined) keep[f] = existing[f];
  const leg = {
    companyId: main.companyId,
    accountId: line.transferAccountId,
    date: main.date,
    amountCents: noNegZero(-line.amountCents),
    payee: main.payee,
    memo: line.memo || main.memo,
    status: 'uncleared',
    reconciliationId: null,
    categoryId: null,
    transferAccountId: main.accountId,
    icCategoryId: null,
    splits: [],
    needsCategory: false,
    deleted: main.deleted,
    parentId: main.__id,
    parentLine: index,
    parentLineKey: key,
    role: 'leg',
    settlementId: main.settlementId,
    fingerprint: null,
    importId: null,
    source: main.source,
    project: main.project,
    attachmentUrl: null,
    attachmentPath: null,
    checkNumber: null,
    legacyExpenseId: null,
    projectId: null,
    convertedFromCategoryId: null,
    coversHistoricalCents: null,
    personalMovedFrom: null,
    ...keep,
  };
  leg.type = deriveType(leg, accounts, {});
  return leg;
}

function buildMirror(main, line, index, existing, categories) {
  const other = otherCompany(main.companyId);
  const keep = {};
  if (existing) for (const f of OWN_FIELDS) if (existing[f] !== undefined) keep[f] = existing[f];
  const cat = line.icCategoryId ? categories[line.icCategoryId] : null;
  let type = line.amountCents >= 0 ? 'income' : 'expense';
  if (cat && cat.kind) type = cat.kind === 'equity' ? 'equity' : cat.kind;
  return {
    companyId: other,
    accountId: ids.intercompany(other),
    date: main.date,
    amountCents: line.amountCents,
    payee: main.payee,
    memo: line.memo || main.memo,
    status: 'uncleared',
    reconciliationId: null,
    type,
    categoryId: line.icCategoryId || null,
    transferAccountId: null,
    icCategoryId: null,
    splits: [],
    needsCategory: !line.icCategoryId,
    deleted: main.deleted,
    parentId: main.__id,
    parentLine: index,
    parentLineKey: lineKey(line, index),
    role: 'mirror',
    settlementId: null,
    fingerprint: null,
    importId: null,
    source: main.source,
    project: main.project,
    attachmentUrl: null,
    attachmentPath: null,
    checkNumber: null,
    legacyExpenseId: null,
    projectId: null,
    convertedFromCategoryId: null,
    coversHistoricalCents: null,
    personalMovedFrom: null,
    ...keep,
  };
}

/** Ids of the linked docs a main transaction implies (for loading "before"). */
function linkedIdsOf(mainId, main, accounts) {
  const legIds = [];
  const mirrorIds = [];
  if (!main) return { legIds, mirrorIds };
  linesOf(main).forEach((line, i) => {
    if (!line.transferAccountId) return;
    legIds.push(ids.leg(mainId, lineKey(line, i)));
    if (isIcAccount(accounts, line.transferAccountId) && !main.settlementId) mirrorIds.push(ids.mirror(mainId, lineKey(line, i)));
  });
  return { legIds, mirrorIds };
}

function sameMoney(a, b) {
  return a && b && a.amountCents === b.amountCents && a.date === b.date && a.accountId === b.accountId && !!a.deleted === !!b.deleted;
}

function assertUnlocked(before, after, label) {
  if (!before || before.status !== 'reconciled') return;
  if (!after || !sameMoney(before, after)) {
    throw new LedgerError(
      `${label || 'This transaction'} is reconciled. Undo the reconciliation first to change its amount, date, account or delete it.`,
      'locked'
    );
  }
}

/**
 * Plan every document write for saving (or soft-deleting / restoring) one
 * main transaction together with its derived legs and mirrors.
 *
 * @param {object} p
 * @param {string} p.id                  main transaction id
 * @param {object|null} p.draft          new main data (null = hard delete)
 * @param {object|null} p.before         existing main data (null = new)
 * @param {object} p.existing            { [id]: data } existing legs/mirrors (any company)
 * @param {object} p.accounts            { [id]: account } for BOTH companies
 * @param {object} p.categories          { [id]: category } for BOTH companies
 * @returns {{ sets: Array<{id,data}>, deletes: Array<{id,before}>, deltas: object }}
 */
function planTransactionWrite(p) {
  const { id, draft, before, accounts, categories } = p;
  const existing = p.existing || {};
  const sets = [];
  const deletes = [];
  const beforeDocs = {};
  const afterDocs = {};

  if (before) beforeDocs[id] = before;
  if (before) {
    const { legIds, mirrorIds } = linkedIdsOf(id, before, accounts);
    [...legIds, ...mirrorIds].forEach((lid) => {
      if (existing[lid]) beforeDocs[lid] = existing[lid];
    });
  }

  let main = null;
  if (draft) {
    if (before && before.companyId !== draft.companyId) throw new LedgerError('A transaction cannot move between companies.');
    if (before && before.role !== 'main' && draft.role === 'main') throw new LedgerError('Linked entries are edited from their main transaction.');
    main = normalizeMain({ ...draft, id }, accounts, categories);
    main.__id = id;
    assertUnlocked(before, main);
    afterDocs[id] = main;
    linesOf(main).forEach((line, i) => {
      if (!line.transferAccountId) return;
      const legId = ids.leg(id, lineKey(line, i));
      const leg = buildLeg(main, line, i, existing[legId], accounts);
      afterDocs[legId] = leg;
      if (isIcAccount(accounts, line.transferAccountId) && !main.settlementId) {
        const mirrorId = ids.mirror(id, lineKey(line, i));
        afterDocs[mirrorId] = buildMirror(main, line, i, existing[mirrorId], categories);
      }
    });
    delete main.__id;
    Object.values(afterDocs).forEach((d) => { delete d.__id; });
  } else {
    assertUnlocked(before, null);
  }

  for (const [docId, b] of Object.entries(beforeDocs)) {
    if (docId === id) continue;
    assertUnlocked(b, afterDocs[docId], 'A linked entry in another account');
  }

  for (const [docId, data] of Object.entries(afterDocs)) sets.push({ id: docId, data });
  for (const [docId, b] of Object.entries(beforeDocs)) {
    if (!afterDocs[docId]) deletes.push({ id: docId, before: b });
  }

  // eslint-disable-next-line global-require
  const { monthlyDeltas } = require('./aggregates');
  const deltas = monthlyDeltas(Object.values(beforeDocs), Object.values(afterDocs));
  return { sets, deletes, deltas };
}

/**
 * Soft delete / restore = save the same main with deleted flipped; legs and
 * mirrors follow automatically.
 */
function planSoftDelete(p, deleted) {
  if (!p.before) throw new LedgerError('Nothing to delete.');
  if (p.before.role !== 'main') throw new LedgerError('Delete linked entries from their main transaction.');
  return planTransactionWrite({ ...p, draft: { ...p.before, deleted: !!deleted } });
}

/**
 * Intercompany settlement: `payer` company pays `receiver` company.
 * Produces two main transactions (one per company), each a transfer from the
 * company's bank account to its intercompany account; their legs move both
 * Due-from/Due-to balances toward zero. Partial payments are just smaller
 * amounts.
 */
function settlementDrafts({ settlementId, payer, payerTxnId, receiverTxnId, payerAccountId, receiverAccountId, amountCents, date, memo, payerPayee, receiverPayee }) {
  assertCents(amountCents, 'Settlement amount');
  if (amountCents <= 0) throw new LedgerError('Settlement amount must be positive.');
  const receiver = otherCompany(payer);
  if (!belongsTo(payerAccountId, payer) || !belongsTo(receiverAccountId, receiver)) {
    throw new LedgerError('Pick the paying account in the paying company and the receiving account in the other company.');
  }
  if (!belongsTo(payerTxnId, payer) || !belongsTo(receiverTxnId, receiver)) throw new LedgerError('Bad settlement ids.');
  const base = { date, memo: memo || '', source: 'settlement', settlementId, status: 'uncleared' };
  return [
    {
      id: payerTxnId,
      draft: {
        ...base,
        companyId: payer,
        accountId: payerAccountId,
        amountCents: -amountCents,
        payee: payerPayee || 'Intercompany payment',
        transferAccountId: ids.intercompany(payer),
      },
    },
    {
      id: receiverTxnId,
      draft: {
        ...base,
        companyId: receiver,
        accountId: receiverAccountId,
        amountCents,
        payee: receiverPayee || 'Intercompany payment received',
        transferAccountId: ids.intercompany(receiver),
      },
    },
  ];
}

/** Merge several plans into one write set (e.g. both sides of a settlement). */
function mergePlans(plans) {
  // eslint-disable-next-line global-require
  const { mergeDeltas } = require('./aggregates');
  return {
    sets: plans.flatMap((pl) => pl.sets),
    deletes: plans.flatMap((pl) => pl.deletes),
    deltas: mergeDeltas(plans.map((pl) => pl.deltas)),
  };
}

/** The other company's half of an intercompany reimbursement (ids are paired). */
function settlementPeerId(txnId) {
  const m = /^(dal|zerbiq)_set_([a-z0-9]+)_(p|r)$/.exec(String(txnId));
  if (!m) return null;
  return `${otherCompany(m[1])}_set_${m[2]}_${m[3] === 'p' ? 'r' : 'p'}`;
}
function settlementTxnIds(base, payer) {
  return { payerTxnId: `${payer}_set_${base}_p`, receiverTxnId: `${otherCompany(payer)}_set_${base}_r` };
}

module.exports = {
  LedgerError,
  lineKey,
  settlementPeerId,
  settlementTxnIds,
  TXN_FIELDS,
  linesOf,
  isIcAccount,
  deriveType,
  needsCategory,
  normalizeMain,
  linkedIdsOf,
  planTransactionWrite,
  planSoftDelete,
  settlementDrafts,
  mergePlans,
  monthOf,
  companyOfId,
};
