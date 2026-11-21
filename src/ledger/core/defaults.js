// Default chart of categories, vendor rules and accounts for each company,
// plus the mapping from the retired `expenses` categories.


const { ids, assertCompany, otherCompany, COMPANY_META } = require('./constants');

// [slug, name, kind, group?]
const SHARED_EXPENSE = [
  ['software', 'Software & subscriptions', 'expense'],
  ['contractors', 'Contractors', 'expense'],
  ['hosting', 'Hosting & domains', 'expense'],
  ['marketing', 'Advertising & marketing', 'expense'],
  ['app_store_fees', 'App store & developer fees', 'expense'],
  ['bank_fees', 'Bank & card fees', 'expense'],
  ['professional', 'Legal & accounting', 'expense'],
  ['hardware', 'Hardware & equipment', 'expense'],
  ['office', 'Office supplies', 'expense'],
  ['phone_internet', 'Phone, internet & utilities', 'expense'],
  ['travel', 'Travel', 'expense'],
  ['meals', 'Meals', 'expense'],
  ['education', 'Education & training', 'expense'],
  ['taxes_licenses', 'Taxes & licenses', 'expense'],
  ['insurance', 'Insurance', 'expense'],
  ['interest_expense', 'Interest expense', 'expense'],
  ['depreciation', 'Depreciation', 'expense'],
  ['other_expense', 'Other expense', 'expense'],
];

const EQUITY = [
  ['owner_contribution', 'Owner contribution', 'equity'],
  ['owner_draw', 'Owner draw', 'equity'],
];

const DEFAULT_CATEGORIES = Object.freeze({
  dal: [
    ['client_projects', 'Client projects', 'income'],
    ['app_revenue', 'App revenue', 'income'],
    ['subscription_revenue', 'Subscription revenue', 'income'],
    ['interest_income', 'Interest income', 'income'],
    ['refunds_income', 'Refunds & credits', 'income'],
    ['other_income', 'Other income', 'income'],
    ['asset_gain_loss', 'Gain (loss) on asset sales', 'income'],
    ...SHARED_EXPENSE,
    ['stripe_fees', 'Stripe fees', 'expense'],
    ...EQUITY,
  ],
  zerbiq: [
    ['zerbiq_subscriptions', 'Zerbiq subscriptions', 'income'],
    ['setup_fees', 'Setup & onboarding fees', 'income'],
    ['interest_income', 'Interest income', 'income'],
    ['refunds_income', 'Refunds & credits', 'income'],
    ['other_income', 'Other income', 'income'],
    ['asset_gain_loss', 'Gain (loss) on asset sales', 'income'],
    ...SHARED_EXPENSE,
    ['stripe_fees', 'Stripe fees', 'expense'],
    ['sms_telnyx', 'SMS / Telnyx', 'expense'],
    ['supabase', 'Supabase', 'expense'],
    ['email_delivery', 'Email delivery', 'expense'],
    ['ai_apis', 'AI & API usage', 'expense'],
    ...EQUITY,
  ],
});

// [slug, pattern, categorySlug] — pattern is a case-insensitive substring of the
// normalized payee. More specific patterns win (longest match first).
const DEFAULT_RULES = Object.freeze({
  dal: [
    ['vercel', 'VERCEL', 'hosting'],
    ['godaddy', 'GODADDY', 'hosting'],
    ['cloudflare', 'CLOUDFLARE', 'hosting'],
    ['namecheap', 'NAMECHEAP', 'hosting'],
    ['google_cloud', 'GOOGLE CLOUD', 'hosting'],
    ['firebase', 'FIREBASE', 'hosting'],
    ['github', 'GITHUB', 'software'],
    ['openai', 'OPENAI', 'software'],
    ['anthropic', 'ANTHROPIC', 'software'],
    ['chatgpt', 'CHATGPT', 'software'],
    ['expo', 'EXPO', 'software'],
    ['sentry', 'SENTRY', 'software'],
    ['adobe', 'ADOBE', 'software'],
    ['figma', 'FIGMA', 'software'],
    ['notion', 'NOTION', 'software'],
    ['revenuecat', 'REVENUECAT', 'software'],
    ['twilio', 'TWILIO', 'software'],
    ['mailgun', 'MAILGUN', 'software'],
    ['apple_dev', 'APPLE.COM/BILL', 'software'],
    ['google_play', 'GOOGLE PLAY', 'app_store_fees'],
    ['google_ads', 'GOOGLE ADS', 'marketing'],
    ['facebook', 'FACEBK', 'marketing'],
    ['meta_ads', 'META ADS', 'marketing'],
    ['fiverr', 'FIVERR', 'contractors'],
    ['upwork', 'UPWORK', 'contractors'],
    ['stripe_fee', 'STRIPE FEE', 'stripe_fees'],
  ],
  zerbiq: [
    ['vercel', 'VERCEL', 'hosting'],
    ['cloudflare', 'CLOUDFLARE', 'hosting'],
    ['supabase', 'SUPABASE', 'supabase'],
    ['telnyx', 'TELNYX', 'sms_telnyx'],
    ['twilio', 'TWILIO', 'sms_telnyx'],
    ['mailgun', 'MAILGUN', 'email_delivery'],
    ['resend', 'RESEND', 'email_delivery'],
    ['postmark', 'POSTMARK', 'email_delivery'],
    ['openai', 'OPENAI', 'ai_apis'],
    ['anthropic', 'ANTHROPIC', 'ai_apis'],
    ['github', 'GITHUB', 'software'],
    ['sentry', 'SENTRY', 'software'],
    ['google_ads', 'GOOGLE ADS', 'marketing'],
    ['stripe_fee', 'STRIPE FEE', 'stripe_fees'],
  ],
});

function defaultCategoryDocs(companyId) {
  assertCompany(companyId);
  return DEFAULT_CATEGORIES[companyId].map(([slug, name, kind], i) => ({
    id: ids.category(companyId, slug),
    data: { companyId, name, kind, slug, sort: i, archived: false, isDefault: true },
  }));
}

function defaultRuleDocs(companyId) {
  assertCompany(companyId);
  return DEFAULT_RULES[companyId].map(([slug, pattern, cat]) => ({
    id: ids.rule(companyId, slug),
    data: { companyId, pattern, categoryId: ids.category(companyId, cat), isDefault: true },
  }));
}

/**
 * The three accounts every company starts with. `opening` lets the setup screen
 * or the migration pass opening balances/dates; vault links are optional.
 */
function defaultAccountDocs(companyId, opening) {
  assertCompany(companyId);
  const o = opening || {};
  const other = otherCompany(companyId);
  const otherName = COMPANY_META[other].legalName;
  return [
    {
      id: ids.checking(companyId),
      data: {
        companyId,
        kind: 'checking',
        name: o.checkingName || 'Business checking',
        last4: o.checkingLast4 || '',
        openingBalanceCents: o.checkingOpeningCents || 0,
        openingDate: o.checkingOpeningDate || o.openingDate || '2025-01-01',
        vaultBankAccountId: o.vaultBankAccountId || null,
        vaultCreditCardId: null,
        archived: false,
        sort: 1,
      },
    },
    {
      id: ids.card(companyId),
      data: {
        companyId,
        kind: 'credit_card',
        name: o.cardName || 'Business credit card',
        last4: o.cardLast4 || '',
        openingBalanceCents: o.cardOpeningCents || 0,
        openingDate: o.cardOpeningDate || o.openingDate || '2025-01-01',
        vaultBankAccountId: null,
        vaultCreditCardId: o.vaultCreditCardId || null,
        archived: false,
        sort: 2,
      },
    },
    {
      id: ids.intercompany(companyId),
      data: {
        companyId,
        kind: 'intercompany',
        counterpartyCompanyId: other,
        // Positive balance = receivable ("Due from"), negative = payable ("Due to").
        name: `Due from / to ${otherName}`,
        last4: '',
        openingBalanceCents: 0,
        openingDate: o.openingDate || '2025-01-01',
        vaultBankAccountId: null,
        vaultCreditCardId: null,
        archived: false,
        sort: 3,
      },
    },
  ];
}

// Retired `expenses` categories (plus the Fiverr import ones) → DAL category slug.
const LEGACY_CATEGORY_MAP = Object.freeze({
  'Advertising & Marketing': 'marketing',
  'App Store Fees': 'app_store_fees',
  'Domain & Hosting': 'hosting',
  'Hardware & Equipment': 'hardware',
  Other: 'other_expense',
  'Professional Services': 'professional',
  'Software & Subscriptions': 'software',
  'Travel & Meals': 'travel',
  Utilities: 'phone_internet',
  Design: 'contractors',
  Development: 'contractors',
  Office: 'office',
  Uncategorized: null,
});

module.exports = {
  DEFAULT_CATEGORIES,
  DEFAULT_RULES,
  defaultCategoryDocs,
  defaultRuleDocs,
  defaultAccountDocs,
  LEGACY_CATEGORY_MAP,
};
