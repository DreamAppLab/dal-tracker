// Ledger constants and id conventions.
//
// ID CONVENTION (enforced by firestore.rules): every ledger document id, and
// every id a ledger document points at (accountId, categoryId, …), starts with
// its company id and an underscore — e.g. "dal_card", "zerbiq_cat_supabase".
// That lets the rules prove a transaction can never reference another
// company's account or category without extra document reads.


const COMPANY_IDS = Object.freeze(['dal', 'zerbiq']);

const COMPANY_META = Object.freeze({
  dal: {
    id: 'dal',
    short: 'DAL',
    name: 'Dream App Lab',
    legalName: 'Dream App Lab LLC',
    color: '#4cc1f3',
    tint: 'rgba(76,193,243,0.14)',
  },
  zerbiq: {
    id: 'zerbiq',
    short: 'Zerbiq',
    name: 'Zerbiq',
    legalName: 'Zerbiq',
    color: '#9B7BFF',
    tint: 'rgba(155,123,255,0.16)',
  },
});

// fixed_asset: one account per asset (cost in, depreciation out; balance = book value).
const ACCOUNT_KINDS = Object.freeze(['checking', 'credit_card', 'intercompany', 'fixed_asset']);
const CATEGORY_KINDS = Object.freeze(['income', 'expense', 'equity']);
const TXN_TYPES = Object.freeze(['expense', 'income', 'transfer', 'intercompany', 'equity']);
const STATUSES = Object.freeze(['uncleared', 'cleared', 'reconciled']);

// Firestore collections (all top-level, all carry companyId).
const COL = Object.freeze({
  accounts: 'ledgerAccounts',
  categories: 'ledgerCategories',
  transactions: 'ledgerTransactions',
  vendorRules: 'ledgerVendorRules',
  projects: 'ledgerProjects',
  reconciliations: 'ledgerReconciliations',
  monthly: 'ledgerMonthly',
  imports: 'ledgerImports',
  prefs: 'ledgerPrefs',
  migrationBackups: 'ledgerMigrationBackups',
});

function assertCompany(companyId) {
  if (!COMPANY_IDS.includes(companyId)) throw new Error(`Unknown company: ${companyId}`);
  return companyId;
}

function otherCompany(companyId) {
  assertCompany(companyId);
  return companyId === 'dal' ? 'zerbiq' : 'dal';
}

function companyOfId(id) {
  const prefix = String(id || '').split('_')[0];
  return COMPANY_IDS.includes(prefix) ? prefix : null;
}

function belongsTo(id, companyId) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{3,160}$/.test(id) && companyOfId(id) === companyId;
}

const ids = Object.freeze({
  checking: (c) => `${assertCompany(c)}_checking`,
  card: (c) => `${assertCompany(c)}_card`,
  intercompany: (c) => `${assertCompany(c)}_ic_${otherCompany(c)}`,
  category: (c, slug) => `${assertCompany(c)}_cat_${slug}`,
  rule: (c, slug) => `${assertCompany(c)}_rule_${slug}`,
  depreciation: (assetAccountId, month) => `${assetAccountId}_dep_${month}`,
  monthly: (c, month) => `${assertCompany(c)}_${month}`,
  imported: (c, hash) => `${assertCompany(c)}_imp_${hash}`,
  // Linked legs are derived from the parent id so they can always be found.
  leg: (parentId, lineIndex) => `${parentId}__x${lineIndex}`,
  mirror: (parentId, lineIndex) => {
    const parentCompany = companyOfId(parentId);
    const other = otherCompany(parentCompany);
    return `${other}_m_${String(parentId).slice(parentCompany.length + 1)}__${lineIndex}`;
  },
});

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function monthOf(date) {
  return String(date).slice(0, 7);
}

module.exports = {
  COMPANY_IDS,
  COMPANY_META,
  ACCOUNT_KINDS,
  CATEGORY_KINDS,
  TXN_TYPES,
  STATUSES,
  COL,
  assertCompany,
  otherCompany,
  companyOfId,
  belongsTo,
  ids,
  MONTH_RE,
  DATE_RE,
  monthOf,
};
