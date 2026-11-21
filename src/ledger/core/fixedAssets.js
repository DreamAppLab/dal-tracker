// Fixed assets (pure). Each asset is its own ledger account of kind
// 'fixed_asset':
//   - buying it is a TRANSFER from checking/card into the asset account
//     (capitalized: balance sheet, not P&L), or its opening balance when it was
//     bought before the books started;
//   - depreciation is a monthly entry in the asset account, category
//     "Depreciation" (an expense), amount negative, id <assetId>_dep_<YYYY-MM>
//     so posting is idempotent;
//   - the account balance is the book value.
// Method: straight-line, full-month convention starting the in-service month.

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
function isDepreciation(t, account) {
  return t.source === 'depreciation' || (!!account.depreciationCategoryId && t.categoryId === account.depreciationCategoryId && t.amountCents < 0);
}

/**
 * Cost, accumulated depreciation and book value of one asset as of a date.
 * `txns` = the asset account's transactions (any range covering ≤ asOf).
 */
function assetSummary(account, txns, asOf) {
  let cost = account.openingBalanceCents || 0;
  let accumulated = 0;
  let disposals = 0;
  const posted = {};
  for (const t of txns) {
    if (t.deleted || t.accountId !== account.id || (asOf && t.date > asOf)) continue;
    if (isDepreciation(t, account)) {
      accumulated += -t.amountCents;
      posted[t.date.slice(0, 7)] = (posted[t.date.slice(0, 7)] || 0) - t.amountCents;
    } else if (t.amountCents > 0) cost += t.amountCents;
    else disposals += -t.amountCents;
  }
  const lifeMonths = Number(account.lifeMonths) || 0;
  const salvage = Number(account.salvageCents) || 0;
  const startMonth = String(account.inServiceDate || account.openingDate || '').slice(0, 7);
  return {
    accountId: account.id,
    name: account.name,
    inServiceDate: account.inServiceDate || account.openingDate,
    lifeMonths,
    salvageCents: salvage,
    costCents: cost - disposals,
    accumulatedCents: accumulated,
    bookValueCents: cost - disposals - accumulated,
    depreciableCents: Math.max(0, cost - disposals - salvage),
    remainingCents: Math.max(0, cost - disposals - salvage - accumulated),
    endMonth: startMonth && lifeMonths ? addMonths(startMonth, lifeMonths - 1) : null,
    posted,
  };
}

/**
 * Depreciation entries still to post through `throughDate` (month ends only).
 * Already-posted months keep their amounts; each new month takes an even share
 * of what is left over the months left (largest-remainder rounding), so the
 * schedule always lands exactly on cost − salvage at the end of the life.
 * `skipMonths` = months whose entry exists but was deleted (respected).
 */
function depreciationToPost(account, txns, throughDate, skipMonths) {
  const s = assetSummary(account, txns, null);
  if (!s.lifeMonths || !s.inServiceDate || s.depreciableCents <= 0) return [];
  const skip = new Set(skipMonths || []);
  const start = s.inServiceDate.slice(0, 7);
  const out = [];
  let remaining = s.depreciableCents - s.accumulatedCents;
  for (let k = 0; k < s.lifeMonths && remaining > 0; k += 1) {
    const month = addMonths(start, k);
    if (monthEnd(month) > throughDate) break;
    if (s.posted[month] != null || skip.has(month)) continue;
    const monthsLeft = s.lifeMonths - k;
    const [amount] = allocateCents(remaining, new Array(monthsLeft).fill(1));
    if (amount <= 0) break;
    remaining -= amount;
    out.push({
      id: ids.depreciation(account.id, month),
      draft: {
        companyId: account.companyId,
        accountId: account.id,
        date: monthEnd(month),
        amountCents: -amount,
        payee: 'Depreciation',
        memo: `Straight-line, month ${k + 1} of ${s.lifeMonths}`,
        categoryId: account.depreciationCategoryId || ids.category(account.companyId, 'depreciation'),
        source: 'depreciation',
        status: 'cleared',
      },
    });
  }
  return out;
}

module.exports = { assetSummary, depreciationToPost, isDepreciation };
