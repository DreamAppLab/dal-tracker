// Company vault data model + validation (shared by api/vault.js and tests).
//
// Firestore layout (client-readable, NO plaintext secrets):
//   companies/{companyId}                       companyId ∈ COMPANY_IDS
//   companies/{companyId}/bankAccounts/{id}
//   companies/{companyId}/creditCards/{id}
// Server-only ciphertext (rules deny all client access):
//   vaultSecrets/{encoded record path}   { path, fields: { <field>: ciphertext } }
//
// CVV, PIN and online-banking passwords are never accepted (strict schemas).

const { z } = require('zod');

const COMPANY_IDS = Object.freeze(['dal', 'zerbiq']);

const COMPANY_DEFAULTS = Object.freeze({
  dal: {
    legalName: 'Dream App Lab LLC',
    dba: 'Dream App Lab',
    entityType: 'LLC',
    website: 'https://dreamapplab.com',
    businessAddress: '2800 N 6th Street #5030, St. Augustine, FL 32084',
    phone: '(904) 385-0060',
  },
  zerbiq: {
    legalName: 'Zerbiq',
    dba: '',
    entityType: '',
    website: 'https://zerbiq.com',
    businessAddress: '2800 N 6th Street #5030, St. Augustine, FL 32084',
    phone: '(904) 385-0060',
  },
});

const SENSITIVE = Object.freeze({
  company: ['ein', 'documentNumber'],
  bankAccounts: ['routingNumber', 'accountNumber'],
  creditCards: ['cardNumber'],
});

const ACCOUNT_TYPES = ['Checking', 'Savings', 'Money Market', 'Other'];

const digits = (s) => String(s == null ? '' : s).replace(/[\s-]/g, '');

function abaValid(r) {
  if (!/^\d{9}$/.test(r)) return false;
  const d = r.split('').map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}

function luhnValid(n) {
  if (!/^\d{12,19}$/.test(n)) return false;
  let sum = 0;
  let dbl = false;
  for (let i = n.length - 1; i >= 0; i--) {
    let x = Number(n[i]);
    if (dbl) {
      x *= 2;
      if (x > 9) x -= 9;
    }
    sum += x;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

const str = (max) => z.string().trim().max(max);
const optStr = (max) => str(max).optional().default('');
const dateStr = z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional().default('');
// Company profile updates are partial: a field left out is left unchanged.
const patchStr = (max) => str(max).optional();
const patchDate = z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional();

const ein = z
  .string()
  .transform(digits)
  .refine((v) => /^\d{9}$/.test(v), 'EIN must be 9 digits')
  .transform((v) => `${v.slice(0, 2)}-${v.slice(2)}`);
const documentNumber = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => /^[A-Z0-9-]{4,20}$/.test(v), 'Document number: 4–20 letters/digits');
const routingNumber = z.string().transform(digits).refine(abaValid, 'Routing number is not a valid 9-digit ABA number');
const accountNumber = z.string().transform(digits).refine((v) => /^\d{4,17}$/.test(v), 'Account number: 4–17 digits');
const cardNumber = z.string().transform(digits).refine(luhnValid, 'Card number is not valid');
const expiry = z
  .string()
  .trim()
  .refine((v) => /^(0[1-9]|1[0-2])\/\d{2}$/.test(v), 'Expiry must be MM/YY');

const companyId = z.enum(COMPANY_IDS);
const recordId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

const CompanySchema = z
  .object({
    companyId,
    legalName: str(200).min(1).optional(),
    dba: patchStr(200),
    entityType: patchStr(60),
    stateOfFormation: patchStr(60),
    formationDate: patchDate,
    registeredAgent: patchStr(300),
    businessAddress: patchStr(300),
    phone: patchStr(40),
    website: patchStr(200),
    notes: patchStr(5000),
    ein: ein.optional(),
    documentNumber: documentNumber.optional(),
    clear: z.array(z.enum(SENSITIVE.company)).max(2).optional(),
  })
  .strict();

const BankAccountSchema = z
  .object({
    companyId,
    id: recordId.optional(),
    bankName: str(120).min(1),
    nickname: str(80).min(1),
    accountType: z.enum(ACCOUNT_TYPES),
    openingDate: dateStr,
    routingNumber: routingNumber.optional(),
    accountNumber: accountNumber.optional(),
  })
  .strict();

const CreditCardSchema = z
  .object({
    companyId,
    id: recordId.optional(),
    issuer: str(120).min(1),
    nickname: str(80).min(1),
    cardholder: str(120).min(1),
    expiry,
    linkedBankAccountId: z.union([recordId, z.literal(''), z.null()]).optional().default(null),
    cardNumber: cardNumber.optional(),
  })
  .strict();

const DeleteSchema = z.object({ companyId, kind: z.enum(['bankAccounts', 'creditCards']), id: recordId }).strict();

const COMPANY_PROFILE_FIELDS = Object.freeze([
  'legalName', 'dba', 'entityType', 'stateOfFormation', 'formationDate',
  'registeredAgent', 'businessAddress', 'phone', 'website', 'notes',
]);

const RECORD_PATH_RE = /^companies\/(dal|zerbiq)(\/(bankAccounts|creditCards)\/[A-Za-z0-9_-]{1,64})?$/;
const RevealSchema = z
  .object({
    path: z.string().regex(RECORD_PATH_RE),
    field: z.string(),
    action: z.enum(['reveal', 'copy']),
  })
  .strict()
  .refine((v) => allowedFieldsForPath(v.path).includes(v.field), { message: 'Field not allowed', path: ['field'] });

function kindForPath(path) {
  const parts = path.split('/');
  return parts.length === 2 ? 'company' : parts[2];
}

function allowedFieldsForPath(path) {
  if (!RECORD_PATH_RE.test(path)) return [];
  return SENSITIVE[kindForPath(path)] || [];
}

function last4(v) {
  return String(v || '').replace(/\D/g, '').slice(-4);
}

function maskFor(field, plaintext) {
  const l4 = field === 'documentNumber' ? String(plaintext).slice(-4) : last4(plaintext);
  if (field === 'ein') return `••-•••${l4}`;
  return `•••• ${l4}`;
}

function secretDocId(path) {
  return path.replace(/\//g, '__');
}

module.exports = {
  COMPANY_IDS,
  COMPANY_DEFAULTS,
  SENSITIVE,
  ACCOUNT_TYPES,
  CompanySchema,
  COMPANY_PROFILE_FIELDS,
  BankAccountSchema,
  CreditCardSchema,
  DeleteSchema,
  RevealSchema,
  RECORD_PATH_RE,
  allowedFieldsForPath,
  kindForPath,
  maskFor,
  last4,
  secretDocId,
  abaValid,
  luhnValid,
};
