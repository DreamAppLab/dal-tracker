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

module.exports = { COMPANY, ACCOUNT, migratedId, legacyImportId, mapLegacyExpense, planMigration, planLegacyImports };
