// Fixed assets (pure). Each asset is its own ledger account of kind
// 'fixed_asset':
//   - buying it is a TRANSFER from checking/card into the asset account
//     (capitalized: balance sheet, not P&L);
//   - an asset owned before the books started opens at BOOK VALUE:
//     openingCostCents − openingAccumulatedCents (= openingBalanceCents), and
//     its schedule only covers months from the books' start;
//   - depreciation is a monthly entry in the asset account, category
//     "Depreciation", id <assetId>_dep_<YYYY-MM> (idempotent posting);
//   - selling/disposing books one 'disposal' entry that moves the proceeds to
//     a bank account and the gain/loss to its category, leaving book value 0;
//   - the account balance is the book value.
// Method: straight-line, full-month convention from the in-service month.

const { allocateCents } = require('./money');
const { ids } = require('./constants');

function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}
function monthEnd(month) {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** Any line in the asset's Depreciation category (either sign) or an auto entry. */
function isDepreciation(t, account) {
  return t.source === 'depreciation' || (!!account.depreciationCategoryId && t.categoryId === account.depreciationCategoryId);
}

/** Month of an auto depreciation entry, from its id (dates can be edited; ids cannot). */
function autoMonth(t, account) {
  const prefix = `${account.id}_dep_`;
  return t.id && String(t.id).startsWith(prefix) ? String(t.id).slice(prefix.length) : null;
}

function openingCost(account) {
  return account.openingCostCents != null ? account.openingCostCents : (account.openingBalanceCents || 0);
}

/** Cost basis and accumulated depreciation through a date (inclusive), excluding the disposal itself. */
function basisAt(account, txns, date) {
  let cost = account.openingDate && date < account.openingDate ? 0 : openingCost(account);
  let accumulated = account.openingDate && date < account.openingDate ? 0 : (account.openingAccumulatedCents || 0);
  for (const t of txns) {
    if (t.deleted || t.accountId !== account.id || t.date > date || t.source === 'disposal') continue;
    if (isDepreciation(t, account)) accumulated += -t.amountCents;
    else cost += t.amountCents; // additions (+) and partial write-downs (−)
  }
  return { cost, accumulated };
}

/** Cost, accumulated depreciation and book value of one asset as of a date. */
function assetSummary(account, txns, asOf) {
  const at = asOf || '9999-12-31';
  const disposal = txns.find((t) => !t.deleted && t.accountId === account.id && t.source === 'disposal' && t.date <= at);
  const { cost, accumulated } = basisAt(account, txns, disposal ? disposal.date : at);
  const lifeMonths = Number(account.lifeMonths) || 0;
  const salvage = Number(account.salvageCents) || 0;
  const inService = account.inServiceDate || account.openingDate;
  const startMonth = String(inService || '').slice(0, 7);
  const endMonth = startMonth && lifeMonths ? addMonths(startMonth, lifeMonths - 1) : null;
  const remaining = Math.max(0, cost - salvage - accumulated);
  return {
    accountId: account.id,
    name: account.name,
    inServiceDate: inService,
    lifeMonths,
    salvageCents: salvage,
    costCents: disposal ? 0 : cost,
    accumulatedCents: disposal ? 0 : accumulated,
    bookValueCents: disposal ? 0 : cost - accumulated,
    depreciableCents: Math.max(0, cost - salvage),
    remainingCents: disposal ? 0 : remaining,
    endMonth,
    disposedDate: disposal ? disposal.date : null,
    // Cost still undepreciated after the life ended (e.g. an improvement added late): needs a decision.
    pastLifeRemainingCents: !disposal && endMonth && monthEnd(endMonth) < at && remaining > 0 ? remaining : 0,
  };
}

/**
 * Depreciation entries still to post through `throughDate` (month ends only).
 * Each month uses the cost basis as of that month's end; already-posted months
 * keep their amounts; a month takes an even share of what is left over the
 * months left (largest-remainder rounding), so the schedule lands exactly on
 * cost − salvage at the end of the life. Months before the books started
 * (covered by openingAccumulatedCents), skipped months (an auto entry the user
 * deleted) and months after a disposal are never posted.
 */
function depreciationToPost(account, txns, throughDate, skipMonths) {
  const lifeMonths = Number(account.lifeMonths) || 0;
  const inService = account.inServiceDate || account.openingDate;
  if (!lifeMonths || !inService) return [];
  const live = txns.filter((t) => !t.deleted && t.accountId === account.id);
  const disposal = live.find((t) => t.source === 'disposal');
  const posted = new Set();
  const skip = new Set([...(skipMonths || []), ...(account.depreciationSkipMonths || [])]);
  for (const t of txns) {
    const m = autoMonth(t, account);
    if (!m) continue;
    if (t.deleted) skip.add(m); else posted.add(m);
  }
  const salvage = Number(account.salvageCents) || 0;
  const start = inService.slice(0, 7);
  const booksStart = String(account.openingDate || inService).slice(0, 7);
  const out = [];
  let planned = 0;
  for (let k = 0; k < lifeMonths; k += 1) {
    const month = addMonths(start, k);
    const end = monthEnd(month);
    if (end > throughDate) break;
    if (disposal && end > disposal.date) break;
    if (month < booksStart || posted.has(month) || skip.has(month)) continue;
    const { cost, accumulated } = basisAt(account, live, end);
    const remaining = cost - salvage - accumulated - planned;
    if (remaining <= 0) continue;
    const [amount] = allocateCents(remaining, new Array(lifeMonths - k).fill(1));
    if (amount <= 0) continue;
    planned += amount;
    out.push({
      id: ids.depreciation(account.id, month),
      draft: {
        companyId: account.companyId,
        accountId: account.id,
        date: end,
        amountCents: -amount,
        payee: 'Depreciation',
        memo: `Straight-line, month ${k + 1} of ${lifeMonths}`,
        categoryId: account.depreciationCategoryId || ids.category(account.companyId, 'depreciation'),
        source: 'depreciation',
        status: 'cleared',
      },
    });
  }
  return out;
}

/**
 * Disposal (sale / write-off) entry: removes the remaining book value.
 * Proceeds go to `proceedsAccountId` (a transfer); proceeds − book value goes
 * to the gain/loss category (positive = gain).
 */
function disposalDraft({ account, bookValueCents, date, proceedsCents, proceedsAccountId, gainLossCategoryId, memo }) {
  const splits = [];
  if (proceedsCents) splits.push({ lineId: 'proceeds', transferAccountId: proceedsAccountId, amountCents: -proceedsCents, memo: 'Sale proceeds' });
  const gain = proceedsCents - bookValueCents;
  if (gain) splits.push({ lineId: 'gainloss', categoryId: gainLossCategoryId, amountCents: gain, memo: gain > 0 ? 'Gain on disposal' : 'Loss on disposal' });
  const base = {
    companyId: account.companyId,
    accountId: account.id,
    date,
    amountCents: -bookValueCents,
    payee: `Disposal · ${account.name}`,
    memo: memo || '',
    source: 'disposal',
    status: 'cleared',
  };
  if (splits.length > 1) return { ...base, splits };
  if (splits.length === 1) return { ...base, ...splits[0], memo: base.memo, lineId: splits[0].lineId, splits: [] };
  return { ...base, categoryId: gainLossCategoryId };
}

module.exports = { assetSummary, depreciationToPost, isDepreciation, disposalDraft, basisAt };
