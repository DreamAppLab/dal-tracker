// Reconciliation math (pure). Amounts are in the account's internal sign
// (card balances are negative when money is owed — the UI converts the
// "statement balance owed" the user types into that sign).


const { assertCents } = require('./money');

/** Latest completed (not undone) reconciliation for an account. */
function lastReconciliation(reconciliations, accountId) {
  return (reconciliations || [])
    .filter((r) => r.accountId === accountId && r.status === 'complete')
    .sort((a, b) => b.statementDate.localeCompare(a.statementDate) || String(b.finishedAt || '').localeCompare(String(a.finishedAt || '')))[0] || null;
}

/** Starting balance = previous statement's ending balance, else the opening balance. */
function startingBalance(account, reconciliations, accountId) {
  const last = lastReconciliation(reconciliations, accountId);
  return last ? last.endingBalanceCents : (account && account.openingBalanceCents) || 0;
}

/**
 * @param {object} p
 * @param {number} p.startCents
 * @param {number} p.statementEndingCents
 * @param {Array}  p.txns          candidate transactions (unreconciled, in this account)
 * @param {Set|Array} p.clearedIds ids ticked as cleared on this statement
 */
function reconcileSummary({ startCents, statementEndingCents, txns, clearedIds }) {
  assertCents(startCents, 'Starting balance');
  assertCents(statementEndingCents, 'Statement ending balance');
  const ticked = clearedIds instanceof Set ? clearedIds : new Set(clearedIds || []);
  let deposits = 0;
  let payments = 0;
  let depositCount = 0;
  let paymentCount = 0;
  for (const t of txns) {
    if (!ticked.has(t.id) || t.deleted) continue;
    assertCents(t.amountCents);
    if (t.amountCents >= 0) {
      deposits += t.amountCents;
      depositCount += 1;
    } else {
      payments += t.amountCents;
      paymentCount += 1;
    }
  }
  const clearedBalance = startCents + deposits + payments;
  const difference = statementEndingCents - clearedBalance;
  return {
    startCents,
    statementEndingCents,
    deposits,
    payments,
    depositCount,
    paymentCount,
    clearedBalance,
    difference,
    canFinish: difference === 0,
  };
}

module.exports = { lastReconciliation, startingBalance, reconcileSummary };
