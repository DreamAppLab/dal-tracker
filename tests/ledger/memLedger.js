// In-memory ledger used by the core tests: applies planner output exactly the
// way the Firestore executor does (sets, deletes, monthly increments).
'use strict';

const core = require('../../src/ledger/core');

function makeLedger() {
  const accounts = {};
  const categories = {};
  for (const c of core.COMPANY_IDS) {
    core.defaultAccountDocs(c, { openingDate: '2026-01-01' }).forEach((a) => { accounts[a.id] = a.data; });
    core.defaultCategoryDocs(c).forEach((x) => { categories[x.id] = x.data; });
  }
  const txns = {};
  let monthly = {};
  let n = 0;

  const L = {
    accounts,
    categories,
    txns,
    get monthly() { return monthly; },
    newId(companyId) { n += 1; return `${companyId}_t${String(n).padStart(4, '0')}`; },
    existingFor(id, before) {
      const out = {};
      if (!before) return out;
      const { legIds, mirrorIds } = core.linkedIdsOf(id, before, accounts);
      [...legIds, ...mirrorIds].forEach((lid) => { if (txns[lid]) out[lid] = txns[lid]; });
      return out;
    },
    apply(plan) {
      plan.sets.forEach(({ id, data }) => { txns[id] = { ...data, id }; });
      plan.deletes.forEach(({ id }) => { delete txns[id]; });
      monthly = core.applyDeltas(monthly, plan.deltas);
      return plan;
    },
    save(id, draft) {
      const before = txns[id] ? strip(txns[id]) : null;
      return L.apply(core.planTransactionWrite({ id, draft, before, existing: L.existingFor(id, before), accounts, categories }));
    },
    softDelete(id, deleted = true) {
      const before = strip(txns[id]);
      return L.apply(core.planSoftDelete({ id, before, existing: L.existingFor(id, before), accounts, categories }, deleted));
    },
    add(companyId, draft) {
      const id = L.newId(companyId);
      L.save(id, { companyId, ...draft });
      return id;
    },
    balance(accountId) {
      const companyId = core.companyOfId(accountId);
      return core.accountBalance(accounts[accountId], accountId, Object.values(monthly).filter((m) => m.companyId === companyId));
    },
    balanceFromTxns(accountId) {
      return (accounts[accountId].openingBalanceCents || 0) + Object.values(txns).filter((t) => t.accountId === accountId && !t.deleted).reduce((s, t) => s + t.amountCents, 0);
    },
    monthlyList() { return Object.values(monthly); },
    txnList() { return Object.values(txns); },
  };
  return L;
}

function strip(t) {
  if (!t) return null;
  const { id, ...rest } = t;
  return rest;
}

module.exports = { makeLedger, core };
