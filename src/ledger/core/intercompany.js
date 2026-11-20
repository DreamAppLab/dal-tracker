// Intercompany balances and open items (pure).
//
// Each company has one intercompany account for the other company. Its balance
// is positive when the other company owes us (Due from) and negative when we
// owe them (Due to). The two accounts must always be exact opposites.


/** Classify an entry in an intercompany account. */
function entryKind(txn) {
  if (txn.settlementId) return 'settlement';
  if (txn.role === 'mirror') return 'charge_received'; // the other company paid for us
  return 'charge_paid'; // we paid for the other company (leg of our own expense)
}

/**
 * FIFO-match an intercompany account's entries: payments and opposite charges
 * consume the oldest open items first. Returns open items (remaining != 0),
 * the net balance and the per-direction gross totals.
 */
function openItems(entries) {
  const sorted = [...entries]
    .filter((e) => !e.deleted)
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
  const queue = []; // { entry, remaining } all with the same sign
  let balance = 0;
  let paidForThem = 0; // receivable created
  let paidForUs = 0; // payable created
  let settledIn = 0;
  let settledOut = 0;
  for (const e of sorted) {
    const amt = e.amountCents;
    balance += amt;
    const kind = entryKind(e);
    if (kind === 'settlement') {
      if (amt < 0) settledIn += -amt; // they paid us → our receivable went down
      else settledOut += amt; // we paid them → our payable went down
    } else if (amt > 0) paidForThem += amt;
    else paidForUs += -amt;

    let remaining = amt;
    while (remaining !== 0 && queue.length && Math.sign(queue[0].remaining) !== Math.sign(remaining)) {
      const head = queue[0];
      const take = Math.min(Math.abs(head.remaining), Math.abs(remaining));
      head.remaining += head.remaining > 0 ? -take : take;
      remaining += remaining > 0 ? -take : take;
      if (head.remaining === 0) queue.shift();
    }
    if (remaining !== 0) queue.push({ entry: e, remaining });
  }
  return {
    balance,
    open: queue.map((q) => ({ ...q.entry, remainingCents: q.remaining, kind: entryKind(q.entry) })),
    totals: { paidForThem, paidForUs, settledIn, settledOut },
  };
}

/** Both companies' views must mirror each other exactly. */
function balancesAgree(balanceA, balanceB) {
  return balanceA === -balanceB;
}

module.exports = { entryKind, openItems, balancesAgree };
