// Migration of the retired `expenses` collection into the ledger as DAL
// credit-card transactions. Pure planning logic shared by
// scripts/migrate-expenses-to-ledger.js and the tests.
//
// Idempotent: every legacy expense maps to a deterministic transaction id
// (dal_mig_<expenseId>); already-migrated ids are skipped, and the monthly
// aggregates are rebuilt from scratch afterwards. Non-destructive: the legacy
// `expenses` docs are never modified or deleted (rollback = delete dal_mig_*).


const { dollarsToCents } = require('./money');
const { DATE_RE, ids } = require('./constants');
const { LEGACY_CATEGORY_MAP } = require('./defaults');
const { withFingerprints } = require('./importer');

const COMPANY = 'dal';
const ACCOUNT = ids.card(COMPANY);

function migratedId(expenseId) {
  const safe = String(expenseId).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
  return `${COMPANY}_mig_${safe}`;
}

function legacyImportId(statementId) {
  const safe = String(statementId).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
  return ids.imported(COMPANY, safe);
}

function legacyDate(expense) {
  const raw = String(expense.date || '').slice(0, 10);
  return DATE_RE.test(raw) ? raw : '';
}

/** One legacy expense → a main transaction draft (no id). Throws on bad data. */
function mapLegacyExpense(expense) {
  const date = legacyDate(expense);
  if (!date) throw new Error('missing or invalid date');
  const cents = dollarsToCents(expense.amount);
  if (!cents) throw new Error('zero amount');
  const slug = Object.prototype.hasOwnProperty.call(LEGACY_CATEGORY_MAP, expense.category)
    ? LEGACY_CATEGORY_MAP[expense.category]
    : 'other_expense';
  const fromStatement = !!expense.statementId || ['import', 'excel-import', 'pdf'].includes(expense.source);
  const memo = [expense.description || expense.notes || ''].join('').trim();
  return {
    companyId: COMPANY,
    accountId: ACCOUNT,
    date,
    // Legacy amounts are positive spend (negative = credit/refund) → card charge is negative.
    amountCents: -cents,
    payee: String(expense.vendor || '(no vendor)').trim().slice(0, 200),
    memo: memo.slice(0, 1000),
    status: fromStatement ? 'cleared' : 'uncleared',
    categoryId: slug ? ids.category(COMPANY, slug) : null,
    source: 'migration',
    project: expense.appId || expense.app || null,
    attachmentUrl: expense.attachmentUrl || null,
    importId: expense.statementId ? legacyImportId(expense.statementId) : null,
    legacyExpenseId: expense.id,
  };
}

/**
 * @param {Array<{id:string}>} expenses   legacy expense docs (with id)
 * @param {Set<string>} existingIds       ledgerTransactions ids that already exist
 * @returns {{ drafts: Array<{id, draft}>, skipped: string[], errors: Array<{id, error}> }}
 */
function planMigration(expenses, existingIds) {
  const errors = [];
  const mapped = [];
  for (const e of expenses) {
    try {
      mapped.push({ id: migratedId(e.id), draft: mapLegacyExpense(e) });
    } catch (err) {
      errors.push({ id: e.id, error: err.message });
    }
  }
  // Deterministic order → stable occurrence numbers → stable fingerprints.
  mapped.sort((a, b) => a.draft.date.localeCompare(b.draft.date) || a.id.localeCompare(b.id));
  const fps = withFingerprints(ACCOUNT, mapped.map((m) => m.draft));
  mapped.forEach((m, i) => { m.draft.fingerprint = fps[i].fingerprint; });
  const skipped = [];
  const drafts = [];
  for (const m of mapped) {
    if (existingIds.has(m.id)) skipped.push(m.id);
    else drafts.push(m);
  }
  return { drafts, skipped, errors };
}

/** Legacy importedStatements → ledgerImports so re-importing an old statement is a no-op. */
function planLegacyImports(importedStatements) {
  return importedStatements
    .filter((s) => s && s.id)
    .map((s) => ({
      id: legacyImportId(s.statementId || s.id),
      data: {
        companyId: COMPANY,
        accountId: ACCOUNT,
        fileName: String(s.fileName || '').slice(0, 200),
        periodStart: s.billingStart || '',
        periodEnd: s.billingEnd || '',
        rowCount: Number(s.importedCount || 0),
        legacy: true,
      },
    }));
}

const HISTORICAL_SOURCE = 'historical_payment';
const historicalId = (month) => `${COMPANY}_hist_${month}`;

/**
 * The migrated card charges were paid long before these books started, from
 * money outside the books. One "Card payments before Books" entry per month
 * (dated that month's last migrated charge, never in the future) clears them,
 * booked to an equity category — never P&L, never checking — so the card owes
 * $0.00 for the migrated history while every expense stays an expense.
 * Deterministic ids make it idempotent; amounts follow the migrated rows.
 *
 * @param {Array} cardTxns   DAL card transactions (any; only live migrated rows count)
 * @param {Array} existing   existing historical payment docs (with id)
 * @param {string} categoryId  equity category to book them to
 * @returns {{ upserts: Array<{id, draft}>, deleteIds: string[], totalCents, months }}
 */
function planHistoricalPayments(cardTxns, existing, categoryId) {
  const byMonth = {};
  for (const t of cardTxns) {
    if (t.deleted || t.accountId !== ACCOUNT || t.source !== 'migration' || !t.legacyExpenseId) continue;
    const m = t.date.slice(0, 7);
    if (!byMonth[m]) byMonth[m] = { net: 0, last: t.date };
    byMonth[m].net += t.amountCents;
    if (t.date > byMonth[m].last) byMonth[m].last = t.date;
  }
  const upserts = [];
  let total = 0;
  for (const [month, { net, last }] of Object.entries(byMonth).sort()) {
    if (!net) continue;
    total += -net;
    upserts.push({
      id: historicalId(month),
      draft: {
        companyId: COMPANY,
        accountId: ACCOUNT,
        date: last,
        amountCents: -net,
        payee: 'Card payments before Books',
        memo: `Migrated ${month} card charges, paid before these books started.`,
        categoryId,
        source: HISTORICAL_SOURCE,
        status: 'cleared',
      },
    });
  }
  const keep = new Set(upserts.map((u) => u.id));
  const deleteIds = existing.filter((t) => !keep.has(t.id)).map((t) => t.id);
  return { upserts, deleteIds, totalCents: total, months: upserts.length };
}

// Old Expenses "app" tags that mean overhead rather than a project.
const NOT_A_PROJECT = new Set(['', 'DAL', 'DAL GENERAL', 'GENERAL', 'NONE']);

function projectSlug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'project';
}

/**
 * Projects from the migrated rows' old app tags (txn.project): one project per
 * distinct name (deterministic id → idempotent), and the txns to tag.
 */
function planLegacyProjects(txns, existingProjects) {
  // Reuse a project that already exists under the same name (e.g. added by
  // hand in Setup with a random suffix) instead of creating a second one.
  const bySlug = {};
  existingProjects.filter((p) => p.companyId === undefined || p.companyId === COMPANY)
    .forEach((p) => { const k = projectSlug(p.name || ''); if (!bySlug[k] || p.id === `${COMPANY}_proj_${k}`) bySlug[k] = p.id; });
  const create = {};
  const tag = [];
  const mark = []; // already tagged by the user: just record that it was handled
  for (const t of txns) {
    if (t.companyId === COMPANY && t.role === 'main' && t.projectId && t.project && !t.legacyProjectLinked) mark.push(t.id);
    // legacyProjectLinked: handled once; a project the user later cleared stays cleared.
    if (t.companyId !== COMPANY || t.role !== 'main' || t.projectId || t.legacyProjectLinked || !t.project) continue;
    const name = String(t.project).trim();
    if (NOT_A_PROJECT.has(name.toUpperCase())) continue;
    const slug = projectSlug(name);
    let id = bySlug[slug];
    if (!id) {
      id = `${COMPANY}_proj_${slug}`;
      bySlug[slug] = id;
      create[id] = { companyId: COMPANY, name: name.slice(0, 80), archived: false, legacy: true };
    }
    tag.push({ id: t.id, projectId: id });
  }
  return { create: Object.entries(create).map(([id, data]) => ({ id, data })), tag, mark };
}

module.exports = {
  planLegacyProjects, projectSlug,
  COMPANY, ACCOUNT, migratedId, legacyImportId, mapLegacyExpense, planMigration, planLegacyImports,
  HISTORICAL_SOURCE, historicalId, planHistoricalPayments,
};
