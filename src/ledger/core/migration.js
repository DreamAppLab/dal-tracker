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

/** A year typo in an old record (e.g. 0226-03-29) is reported, never migrated as is. */
function legacyYearOk(date) {
  const y = Number(date.slice(0, 4));
  return y >= 2000 && y <= 2099;
}

/** One legacy expense → a main transaction draft (no id). Throws on bad data. */
function mapLegacyExpense(expense) {
  const date = legacyDate(expense);
  if (!date) throw new Error('missing or invalid date');
  if (!legacyYearOk(date)) throw new Error(`date ${date} has a year typo; fix it on the old record`);
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
  const alreadyIds = [];
  for (const e of expenses) {
    try {
      mapped.push({ id: migratedId(e.id), draft: mapLegacyExpense(e) });
    } catch (err) {
      // Already migrated (and possibly corrected in Books since): nothing to do.
      if (existingIds.has(migratedId(e.id))) { alreadyIds.push(migratedId(e.id)); continue; }
      errors.push({ id: e.id, error: err.message });
    }
  }
  // Deterministic order → stable occurrence numbers → stable fingerprints.
  mapped.sort((a, b) => a.draft.date.localeCompare(b.draft.date) || a.id.localeCompare(b.id));
  const fps = withFingerprints(ACCOUNT, mapped.map((m) => m.draft));
  mapped.forEach((m, i) => { m.draft.fingerprint = fps[i].fingerprint; });
  const skipped = [...alreadyIds];
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
  // Real card payments imported later that paid some of these same charges
  // (marked on import): the estimate shrinks by that much, newest month first.
  let covered = 0;
  for (const t of cardTxns) {
    if (!t.deleted && t.accountId === ACCOUNT && (t.role || 'main') === 'main' && t.source !== HISTORICAL_SOURCE && Number.isInteger(t.coversHistoricalCents) && t.coversHistoricalCents > 0) covered += t.coversHistoricalCents;
  }
  for (const t of cardTxns) {
    if (t.deleted || t.accountId !== ACCOUNT || t.source !== 'migration' || !t.legacyExpenseId) continue;
    const m = t.date.slice(0, 7);
    if (!byMonth[m]) byMonth[m] = { net: 0, last: t.date };
    byMonth[m].net += t.amountCents;
    if (t.date > byMonth[m].last) byMonth[m].last = t.date;
  }
  const months = Object.entries(byMonth).sort().filter(([, v]) => v.net).map(([month, v]) => ({ month, ...v, pay: -v.net }));
  let remaining = covered;
  for (let i = months.length - 1; i >= 0 && remaining > 0; i -= 1) {
    if (months[i].pay <= 0) continue;
    const take = Math.min(remaining, months[i].pay);
    months[i].pay -= take;
    remaining -= take;
  }
  const upserts = [];
  let total = 0;
  for (const { month, last, pay } of months) {
    if (!pay) continue;
    total += pay;
    upserts.push({
      id: historicalId(month),
      draft: {
        companyId: COMPANY,
        accountId: ACCOUNT,
        date: last,
        amountCents: pay,
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
  return { upserts, deleteIds, totalCents: total, months: upserts.length, coveredCents: covered - remaining };
}

/**
 * Migrated card charges that never came from a card statement (entered by
 * hand on the old Expenses tab) were paid on an owner's personal card: move
 * them to "Paid personally". Only plain category rows that are still
 * uncleared; marked so the move can be undone.
 */
function planPersonalMove(dalTxns) {
  return dalTxns.filter((t) => t.companyId === COMPANY && (t.role || 'main') === 'main' && !t.deleted
    && t.accountId === ACCOUNT && t.source === 'migration' && t.legacyExpenseId && !t.importId
    && t.status === 'uncleared' && !t.transferAccountId && !t.icCategoryId
    && !((t.splits || []).some((l) => l.transferAccountId || l.icCategoryId)))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Rows moved by planPersonalMove that are still in "Paid personally". */
function planPersonalUndo(dalTxns) {
  const personal = ids.personal(COMPANY);
  return dalTxns.filter((t) => t.companyId === COMPANY && (t.role || 'main') === 'main' && t.personalMovedFrom === ACCOUNT && t.accountId === personal
    && !t.deleted && t.status !== 'reconciled');
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

// ---- What the old Expenses records carried (notes, app tags, receipts) ----

const isFilled = (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)
  && !(typeof v === 'object' && !Array.isArray(v) && !(v.toDate) && !Object.keys(v).length);
const clean = (v) => String(v == null ? '' : v).trim();
const appOf = (e) => clean(e.appId || e.app);
const isAppTag = (name) => !!name && !NOT_A_PROJECT.has(name.toUpperCase());
const legacyNotesToAdd = (e) => {
  const notes = clean(e.notes);
  const desc = clean(e.description);
  return notes && desc && notes !== desc ? notes : '';
};

/**
 * Read-only summary of the old `expenses` docs against their migrated rows:
 * which fields exist, how many carry an app tag / notes / a receipt, and the
 * migrated rows that still have neither a project nor notes.
 */
function legacyExpenseReport(expenses, dalTxns, examplePattern = /sharmin|fiverr/i) {
  const fields = {};
  const apps = {};
  let withApp = 0; let withNotes = 0; let withReceipt = 0; let droppedNotes = 0;
  const examples = [];
  for (const e of expenses) {
    Object.entries(e).forEach(([k, v]) => { if (k !== 'id' && isFilled(v)) fields[k] = (fields[k] || 0) + 1; });
    const app = appOf(e);
    if (app) apps[app] = (apps[app] || 0) + 1;
    if (isAppTag(app)) withApp += 1;
    if (clean(e.notes) || clean(e.description)) withNotes += 1;
    if (clean(e.attachmentUrl)) withReceipt += 1;
    if (legacyNotesToAdd(e)) droppedNotes += 1;
    if (examplePattern.test(clean(e.vendor)) && examples.length < 60) {
      examples.push({ id: e.id, date: legacyDate(e) || '', vendor: clean(e.vendor), amount: e.amount, category: clean(e.category), app: app || null, notes: clean(e.notes), description: clean(e.description), receipt: !!clean(e.attachmentUrl), source: clean(e.source) });
    }
  }
  const byLegacy = Object.fromEntries(expenses.map((e) => [e.id, e]));
  const migrated = dalTxns.filter((t) => t.companyId === COMPANY && (t.role || 'main') === 'main' && t.source === 'migration' && !t.deleted);
  let rowsWithProject = 0; let rowsWithNotes = 0; let rowsWithReceipt = 0; let appTagNotLinked = 0;
  const neither = [];
  for (const t of migrated) {
    const hasProject = !!t.projectId;
    const hasNotes = !!clean(t.memo);
    if (hasProject) rowsWithProject += 1;
    if (hasNotes) rowsWithNotes += 1;
    if (t.attachmentUrl || t.attachmentPath) rowsWithReceipt += 1;
    const e = byLegacy[t.legacyExpenseId];
    if (!hasProject && !t.legacyProjectLinked && e && isAppTag(appOf(e))) appTagNotLinked += 1;
    if (!hasProject && !hasNotes) neither.push({ id: t.id, date: t.date, payee: t.payee, cents: t.amountCents, categoryId: t.categoryId || null, receipt: !!(t.attachmentUrl || t.attachmentPath) });
  }
  neither.sort((a, b) => a.date.localeCompare(b.date));
  return {
    legacy: {
      total: expenses.length,
      fields: Object.entries(fields).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
      apps: Object.entries(apps).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count, isProject: isAppTag(name) })),
      withApp, withNotes, withReceipt, droppedNotes,
      examples,
    },
    books: {
      migrated: migrated.length,
      withProject: rowsWithProject,
      withNotes: rowsWithNotes,
      withReceipt: rowsWithReceipt,
      appTagNotLinked,
      neither: { count: neither.length, totalCents: neither.reduce((s, r) => s + r.cents, 0), rows: neither },
    },
  };
}

/**
 * Notes the migration left out (an old record whose notes differed from its
 * description): appended to the migrated row's memo, only while the memo is
 * still exactly what the migration wrote (never over a user's edit).
 */
function planLegacyNotes(expenses, dalTxns) {
  const byId = Object.fromEntries(dalTxns.map((t) => [t.id, t]));
  const updates = [];
  for (const e of expenses) {
    const add = legacyNotesToAdd(e);
    if (!add) continue;
    const t = byId[migratedId(e.id)];
    if (!t || t.deleted || t.legacyNotesAdded) continue;
    let original;
    try { original = mapLegacyExpense(e).memo; } catch (_) { continue; }
    if (clean(t.memo) !== original || original.includes(add)) continue;
    if (original.length + 3 + add.length > 1000) continue; // would be cut off (and then not undoable)
    updates.push({ id: t.id, memo: `${original}${original ? ' · ' : ''}${add}`.slice(0, 1000), legacyNotesAdded: add });
  }
  return updates;
}

/** Undo planLegacyNotes where the memo still ends with what was added. */
function planLegacyNotesUndo(dalTxns) {
  const out = [];
  for (const t of dalTxns) {
    if (!t.legacyNotesAdded) continue;
    const memo = String(t.memo || '');
    const withSep = ` · ${t.legacyNotesAdded}`;
    if (memo.endsWith(withSep)) out.push({ id: t.id, memo: memo.slice(0, -withSep.length) });
    else if (memo === t.legacyNotesAdded) out.push({ id: t.id, memo: '' });
    else out.push({ id: t.id, memo: null }); // edited since: keep the memo, just clear the marker
  }
  return out;
}

module.exports = {
  legacyExpenseReport, planLegacyNotes, planLegacyNotesUndo, planPersonalMove, planPersonalUndo,
  planLegacyProjects, projectSlug,
  COMPANY, ACCOUNT, migratedId, legacyImportId, mapLegacyExpense, planMigration, planLegacyImports,
  HISTORICAL_SOURCE, historicalId, planHistoricalPayments,
};
