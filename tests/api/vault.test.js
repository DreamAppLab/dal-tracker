const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { mockReq, mockRes, adminToken, setup } = require('../helpers');

const KEY = crypto.randomBytes(32).toString('base64');
process.env.VAULT_ENCRYPTION_KEY = KEY;

const { encryptField, decryptField, isConfigured } = require('../../api/_lib/vaultCrypto');
const S = require('../../api/_lib/vaultSchema');
const vault = require('../../api/vault');

const auth = (claims) => ({ authorization: `Bearer ${adminToken(claims)}` });
const call = async (route, body, headers = auth()) => {
  const res = mockRes();
  await vault(mockReq({ method: 'POST', url: `/api/vault/${route}`, headers, body }), res);
  return res;
};
const STALE = { auth_time: Math.floor(Date.now() / 1000) - 3600 };
const ROUTING = '021000021'; // valid ABA checksum (JPMorgan Chase NY)
const ACCOUNT = '000123456789';
const CARD = '4111111111111111'; // Luhn-valid test number

test('AES-256-GCM round trip, tamper detection and record binding', () => {
  const path = 'companies/dal/bankAccounts/a1';
  const c = encryptField('123456789', path, 'accountNumber');
  assert.match(c, /^v1\.k1\./);
  assert.notEqual(c, encryptField('123456789', path, 'accountNumber'), 'random IV per encryption');
  assert.equal(decryptField(c, path, 'accountNumber'), '123456789');
  assert.doesNotMatch(c, /123456789/);
  // Moving the ciphertext to another record or field must fail (AAD binding).
  assert.throws(() => decryptField(c, 'companies/dal/bankAccounts/a2', 'accountNumber'));
  assert.throws(() => decryptField(c, path, 'routingNumber'));
  // Flipping a byte must fail authentication.
  const parts = c.split('.');
  const ct = Buffer.from(parts[4], 'base64url');
  ct[0] ^= 1;
  parts[4] = ct.toString('base64url');
  assert.throws(() => decryptField(parts.join('.'), path, 'accountNumber'));
  // A different key cannot decrypt.
  process.env.VAULT_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
  assert.throws(() => decryptField(c, path, 'accountNumber'));
  process.env.VAULT_ENCRYPTION_KEY = KEY;
});

test('key must be configured and 32 bytes', () => {
  process.env.VAULT_ENCRYPTION_KEY = Buffer.alloc(16).toString('base64');
  assert.equal(isConfigured(), false);
  process.env.VAULT_ENCRYPTION_KEY = KEY;
  assert.equal(isConfigured(), true);
});

test('validation: ABA routing, Luhn card, EIN, and no CVV/PIN/password fields', () => {
  assert.equal(S.abaValid('021000021'), true);
  assert.equal(S.abaValid('123456789'), false);
  assert.equal(S.luhnValid(CARD), true);
  assert.equal(S.luhnValid('4111111111111112'), false);
  const base = { companyId: 'dal', issuer: 'Capital One', nickname: 'Spark', cardholder: 'Eddie', expiry: '08/29', cardNumber: CARD };
  assert.equal(S.CreditCardSchema.safeParse(base).success, true);
  for (const forbidden of ['cvv', 'cvc', 'pin', 'password', 'onlineBankingPassword']) {
    assert.equal(S.CreditCardSchema.safeParse({ ...base, [forbidden]: '123' }).success, false, forbidden);
    assert.equal(S.BankAccountSchema.safeParse({ companyId: 'dal', bankName: 'B', nickname: 'N', accountType: 'Checking', [forbidden]: 'x' }).success, false, forbidden);
  }
  assert.equal(S.CreditCardSchema.safeParse({ ...base, expiry: '13/29' }).success, false);
  assert.equal(S.CompanySchema.safeParse({ companyId: 'dal', legalName: 'X', ein: '12-345678' }).success, false);
  assert.equal(S.CompanySchema.parse({ companyId: 'dal', legalName: 'X', ein: '123456789' }).ein, '12-3456789');
  assert.equal(S.CompanySchema.safeParse({ companyId: 'acme', legalName: 'X' }).success, false, 'only dal/zerbiq');
});

test('anonymous and non-allowlisted callers are denied', async () => {
  setup();
  assert.equal((await call('ensure-companies', {}, {})).statusCode, 401);
  assert.equal((await call('ensure-companies', {}, auth({ email: 'x@example.com' }))).statusCode, 403);
});

test('ensure-companies creates Dream App Lab LLC and Zerbiq once', async () => {
  const db = setup();
  const r1 = await call('ensure-companies', {});
  assert.equal(r1.statusCode, 200);
  assert.deepEqual(r1.body.created, ['dal', 'zerbiq']);
  assert.equal(db.store.get('companies/dal').legalName, 'Dream App Lab LLC');
  assert.equal(db.store.get('companies/zerbiq').companyId, 'zerbiq');
  const r2 = await call('ensure-companies', {});
  assert.deepEqual(r2.body.created, []);
});

test('saving a bank account stores ciphertext only; public doc has masked/last4', async () => {
  const db = setup();
  const res = await call('bank-account', { companyId: 'dal', bankName: 'Chase', nickname: 'Operating', accountType: 'Checking', openingDate: '2026-11-19', routingNumber: ROUTING, accountNumber: ACCOUNT });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const path = `companies/dal/bankAccounts/${res.body.id}`;
  const pub = db.store.get(path);
  assert.equal(pub.last4, '6789');
  assert.equal(pub.routingLast4, '0021');
  assert.equal(pub.masked.accountNumber, '•••• 6789');
  assert.equal(pub.companyId, 'dal');
  const everything = JSON.stringify([...db.store.entries()]);
  assert.doesNotMatch(everything, new RegExp(ACCOUNT));
  assert.doesNotMatch(everything, new RegExp(ROUTING));
  const secret = db.store.get(`vaultSecrets/${S.secretDocId(path)}`);
  assert.match(secret.fields.accountNumber, /^v1\.k1\./);
  assert.ok([...db.store.values()].some((d) => d && d.type === 'sensitive_create' && d.target === path));
});

test('reveal requires a sign-in within 5 minutes, returns plaintext, and is audited', async () => {
  const db = setup();
  const created = await call('credit-card', { companyId: 'zerbiq', issuer: 'Amex', nickname: 'Biz Gold', cardholder: 'Eddie', expiry: '08/29', cardNumber: CARD });
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const path = `companies/zerbiq/creditCards/${created.body.id}`;

  const stale = await call('reveal', { path, field: 'cardNumber', action: 'reveal' }, auth(STALE));
  assert.equal(stale.statusCode, 401);
  assert.equal(stale.body.code, 'recent_auth_required');
  assert.equal([...db.store.values()].filter((d) => d && d.type === 'vault_reveal').length, 0);

  const ok = await call('reveal', { path, field: 'cardNumber', action: 'reveal' });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.value, CARD);
  assert.equal(ok.body.hideAfterSeconds, 30);
  const audits = [...db.store.values()].filter((d) => d && d.type === 'vault_reveal');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].target, path);
  assert.equal(audits[0].meta.field, 'cardNumber');
  assert.doesNotMatch(JSON.stringify(audits[0]), new RegExp(CARD));

  const copy = await call('reveal', { path, field: 'cardNumber', action: 'copy' });
  assert.equal(copy.statusCode, 200);
  assert.equal([...db.store.values()].filter((d) => d && d.type === 'vault_copy').length, 1);
});

test('reveal rejects fields and paths outside the vault', async () => {
  setup();
  for (const body of [
    { path: 'companies/dal', field: 'legalName', action: 'reveal' },
    { path: 'projects/logabode', field: 'ein', action: 'reveal' },
    { path: 'companies/dal/bankAccounts/../../x', field: 'accountNumber', action: 'reveal' },
    { path: 'companies/dal/creditCards/a1', field: 'accountNumber', action: 'reveal' },
  ]) {
    assert.equal((await call('reveal', body)).statusCode, 400, JSON.stringify(body));
  }
});

test('edits require a recent sign-in (15 minutes)', async () => {
  setup();
  const res = await call('bank-account', { companyId: 'dal', bankName: 'Chase', nickname: 'Op', accountType: 'Checking', routingNumber: ROUTING, accountNumber: ACCOUNT }, auth(STALE));
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'recent_auth_required');
});

test('company EIN saved encrypted, masked, revealable, and clearable', async () => {
  const db = setup();
  await call('ensure-companies', {});
  const res = await call('company', { companyId: 'dal', legalName: 'Dream App Lab LLC', ein: '98-7654321', documentNumber: 'L23000123456' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(db.store.get('companies/dal').masked.ein, '••-•••4321');
  assert.equal(db.store.get('companies/dal').masked.documentNumber, '•••• 3456');
  assert.doesNotMatch(JSON.stringify(db.store.get('companies/dal')), /7654321/);
  const r = await call('reveal', { path: 'companies/dal', field: 'ein', action: 'reveal' });
  assert.equal(r.body.value, '98-7654321');
  await call('company', { companyId: 'dal', legalName: 'Dream App Lab LLC', clear: ['ein'] });
  assert.equal(db.store.get('companies/dal').masked.ein, null);
  assert.equal((await call('reveal', { path: 'companies/dal', field: 'ein', action: 'reveal' })).statusCode, 404);
});

test('deleting a bank account removes its ciphertext, unlinks cards, and is audited', async () => {
  const db = setup();
  const bank = await call('bank-account', { companyId: 'dal', bankName: 'Chase', nickname: 'Op', accountType: 'Checking', routingNumber: ROUTING, accountNumber: ACCOUNT });
  const card = await call('credit-card', { companyId: 'dal', issuer: 'Chase', nickname: 'Ink', cardholder: 'Eddie', expiry: '01/30', cardNumber: CARD, linkedBankAccountId: bank.body.id });
  assert.equal(card.statusCode, 200, JSON.stringify(card.body));
  const del = await call('delete', { companyId: 'dal', kind: 'bankAccounts', id: bank.body.id });
  assert.equal(del.statusCode, 200);
  const path = `companies/dal/bankAccounts/${bank.body.id}`;
  assert.equal(db.store.get(path), undefined);
  assert.equal(db.store.get(`vaultSecrets/${S.secretDocId(path)}`), undefined);
  assert.equal(db.store.get(`companies/dal/creditCards/${card.body.id}`).linkedBankAccountId, null);
  assert.ok([...db.store.values()].some((d) => d && d.type === 'sensitive_delete' && d.target === path));
});

test('vault refuses to store secrets when the key is missing (503)', async () => {
  setup();
  delete process.env.VAULT_ENCRYPTION_KEY;
  const res = await call('bank-account', { companyId: 'dal', bankName: 'Chase', nickname: 'Op', accountType: 'Checking', routingNumber: ROUTING, accountNumber: ACCOUNT });
  assert.equal(res.statusCode, 503);
  process.env.VAULT_ENCRYPTION_KEY = KEY;
});

// ── Review follow-ups ────────────────────────────────────────────────────────
const bankBody = (extra = {}) => ({ companyId: 'dal', bankName: 'Chase', nickname: 'Op', accountType: 'Checking', routingNumber: ROUTING, accountNumber: ACCOUNT, ...extra });

test('truncated or malformed GCM tag / IV is rejected', () => {
  const path = 'companies/dal/creditCards/c1';
  const c = encryptField(CARD, path, 'cardNumber');
  const parts = c.split('.');
  const shortTag = [...parts];
  shortTag[3] = Buffer.from(parts[3], 'base64url').subarray(0, 4).toString('base64url');
  assert.throws(() => decryptField(shortTag.join('.'), path, 'cardNumber'), /Malformed/);
  const shortIv = [...parts];
  shortIv[2] = Buffer.from(parts[2], 'base64url').subarray(0, 8).toString('base64url');
  assert.throws(() => decryptField(shortIv.join('.'), path, 'cardNumber'), /Malformed/);
});

test('partial company update leaves other profile fields untouched', async () => {
  const db = setup();
  await call('ensure-companies', {});
  const before = db.store.get('companies/dal');
  const res = await call('company', { companyId: 'dal', phone: '(904) 555-0100' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const after = db.store.get('companies/dal');
  assert.equal(after.phone, '(904) 555-0100');
  for (const k of ['legalName', 'dba', 'businessAddress', 'website']) assert.equal(after[k], before[k], k);
  assert.equal((await call('company', { companyId: 'dal', legalName: '' })).statusCode, 400, 'legal name cannot be blanked');
});

test('updating only the account number keeps the routing ciphertext and mask', async () => {
  const db = setup();
  const bank = await call('bank-account', bankBody());
  const path = `companies/dal/bankAccounts/${bank.body.id}`;
  const res = await call('bank-account', { companyId: 'dal', id: bank.body.id, bankName: 'Chase', nickname: 'Op', accountType: 'Checking', accountNumber: '99998888' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const pub = db.store.get(path);
  assert.equal(pub.masked.accountNumber, '•••• 8888');
  assert.equal(pub.masked.routingNumber, '•••• 0021');
  assert.equal(pub.routingLast4, '0021');
  assert.equal((await call('reveal', { path, field: 'routingNumber', action: 'reveal' })).body.value, ROUTING);
  assert.equal((await call('reveal', { path, field: 'accountNumber', action: 'reveal' })).body.value, '99998888');
});

test('an edit to a deleted record returns 404 and does not resurrect it', async () => {
  const db = setup();
  const bank = await call('bank-account', bankBody());
  const path = `companies/dal/bankAccounts/${bank.body.id}`;
  await call('delete', { companyId: 'dal', kind: 'bankAccounts', id: bank.body.id });
  const res = await call('bank-account', { companyId: 'dal', id: bank.body.id, bankName: 'Chase', nickname: 'Op', accountType: 'Checking', accountNumber: '99998888' });
  assert.equal(res.statusCode, 404);
  assert.equal(db.store.get(path), undefined);
  assert.equal(db.store.get(`vaultSecrets/${S.secretDocId(path)}`), undefined);
});

test('a card cannot link to the other company\'s bank account', async () => {
  setup();
  const bank = await call('bank-account', bankBody({ companyId: 'zerbiq' }));
  const res = await call('credit-card', { companyId: 'dal', issuer: 'Chase', nickname: 'Ink', cardholder: 'Eddie', expiry: '01/30', cardNumber: CARD, linkedBankAccountId: bank.body.id });
  assert.equal(res.statusCode, 400);
});

test('deleting a card removes its ciphertext', async () => {
  const db = setup();
  const card = await call('credit-card', { companyId: 'dal', issuer: 'Chase', nickname: 'Ink', cardholder: 'Eddie', expiry: '01/30', cardNumber: CARD });
  const path = `companies/dal/creditCards/${card.body.id}`;
  assert.equal((await call('delete', { companyId: 'dal', kind: 'creditCards', id: card.body.id })).statusCode, 200);
  assert.equal(db.store.get(path), undefined);
  assert.equal(db.store.get(`vaultSecrets/${S.secretDocId(path)}`), undefined);
  assert.equal((await call('delete', { companyId: 'dal', kind: 'creditCards', id: card.body.id })).statusCode, 404);
});

test('server-set fields cannot be mass-assigned', async () => {
  setup();
  for (const extra of [{ last4: '0000' }, { masked: { accountNumber: 'x' } }, { createdAt: 'x' }, { fields: {} }, { routingLast4: '1' }]) {
    assert.equal((await call('bank-account', bankBody(extra))).statusCode, 400, JSON.stringify(extra));
  }
  assert.equal((await call('company', { companyId: 'dal', masked: { ein: 'x' } })).statusCode, 400);
});

test('reveal fails closed when the audit write fails', async () => {
  const db = setup();
  const card = await call('credit-card', { companyId: 'dal', issuer: 'Chase', nickname: 'Ink', cardholder: 'Eddie', expiry: '01/30', cardNumber: CARD });
  const path = `companies/dal/creditCards/${card.body.id}`;
  const realCollection = db.collection;
  db.collection = (name) => {
    if (name !== 'auditLog') return realCollection(name);
    const broken = () => { throw new Error('audit store down'); };
    return { add: broken, doc: () => ({ set: broken, create: broken }) };
  };
  const errors = [];
  const origErr = console.error;
  console.error = (...a) => errors.push(a.map(String).join(' '));
  try {
    const res = await call('reveal', { path, field: 'cardNumber', action: 'reveal' });
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.value, undefined);
    assert.doesNotMatch(JSON.stringify(res.body), new RegExp(CARD));
  } finally {
    console.error = origErr;
    db.collection = realCollection;
  }
  assert.doesNotMatch(errors.join('\n'), new RegExp(CARD));
});

test('decrypt failure returns a generic error without ciphertext or plaintext', async () => {
  const db = setup();
  const card = await call('credit-card', { companyId: 'dal', issuer: 'Chase', nickname: 'Ink', cardholder: 'Eddie', expiry: '01/30', cardNumber: CARD });
  const path = `companies/dal/creditCards/${card.body.id}`;
  const secretPath = `vaultSecrets/${S.secretDocId(path)}`;
  const token = db.store.get(secretPath).fields.cardNumber;
  const parts = token.split('.');
  const ct = Buffer.from(parts[4], 'base64url');
  ct[0] ^= 1;
  parts[4] = ct.toString('base64url');
  db.store.get(secretPath).fields.cardNumber = parts.join('.');
  const errors = [];
  const origErr = console.error;
  console.error = (...a) => errors.push(a.map(String).join(' '));
  let res;
  try {
    res = await call('reveal', { path, field: 'cardNumber', action: 'reveal' });
  } finally {
    console.error = origErr;
  }
  assert.equal(res.statusCode, 500);
  const out = JSON.stringify(res.body) + errors.join('\n');
  assert.doesNotMatch(out, new RegExp(CARD));
  assert.doesNotMatch(out, /v1\.k1\./);
  assert.equal([...db.store.values()].filter((d) => d && d.type === 'vault_reveal').length, 0);
});

test('ensure-companies racing twice creates each company and audit entry once', async () => {
  const db = setup();
  const [a, b] = await Promise.all([call('ensure-companies', {}), call('ensure-companies', {})]);
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  assert.equal([...a.body.created, ...b.body.created].sort().join(','), 'dal,zerbiq');
  assert.equal([...db.store.values()].filter((d) => d && d.type === 'sensitive_create').length, 2);
});

test('a record deleted between an edit\'s read and commit is not resurrected (transaction retry)', async () => {
  const db = setup();
  const bank = await call('bank-account', bankBody());
  const path = `companies/dal/bankAccounts/${bank.body.id}`;
  const secretPath = `vaultSecrets/${S.secretDocId(path)}`;
  // Simulate another tab deleting the account while this edit is in flight.
  db.beforeCommit = () => { db.store.delete(path); db.store.delete(secretPath); };
  const res = await call('bank-account', { companyId: 'dal', id: bank.body.id, bankName: 'Chase', nickname: 'Op', accountType: 'Checking', accountNumber: '99998888' });
  assert.equal(res.statusCode, 404);
  assert.equal(db.store.get(path), undefined);
  assert.equal(db.store.get(secretPath), undefined);
});

test('a card cannot be linked to a bank account deleted mid-request', async () => {
  const db = setup();
  const bank = await call('bank-account', bankBody());
  const bankPath = `companies/dal/bankAccounts/${bank.body.id}`;
  db.beforeCommit = () => { db.store.delete(bankPath); };
  const res = await call('credit-card', { companyId: 'dal', issuer: 'Chase', nickname: 'Ink', cardholder: 'Eddie', expiry: '01/30', cardNumber: CARD, linkedBankAccountId: bank.body.id });
  assert.equal(res.statusCode, 400);
  assert.equal([...db.store.keys()].filter((k) => k.startsWith('companies/dal/creditCards/')).length, 0);
});

test('a card linked while its bank account is being deleted ends up unlinked', async () => {
  const db = setup();
  const bank = await call('bank-account', bankBody());
  const card = await call('credit-card', { companyId: 'dal', issuer: 'Chase', nickname: 'Ink', cardholder: 'Eddie', expiry: '01/30', cardNumber: CARD });
  const cardPath = `companies/dal/creditCards/${card.body.id}`;
  // The delete's card query runs, then the card gets linked before the delete commits.
  db.beforeCommit = () => { db.store.set(cardPath, { ...db.store.get(cardPath), linkedBankAccountId: bank.body.id }); };
  assert.equal((await call('delete', { companyId: 'dal', kind: 'bankAccounts', id: bank.body.id })).statusCode, 200);
  assert.equal(db.store.get(cardPath).linkedBankAccountId, null);
});

test('company save with nothing changed writes nothing and is not audited', async () => {
  const db = setup();
  await call('ensure-companies', {});
  const before = JSON.stringify(db.store.get('companies/dal'));
  const audits = () => [...db.store.values()].filter((d) => d && d.type === 'sensitive_update').length;
  const res = await call('company', { companyId: 'dal', legalName: 'Dream App Lab LLC', phone: '(904) 385-0060' });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.stringify(db.store.get('companies/dal')), before);
  assert.equal(audits(), 0);
  await call('company', { companyId: 'dal', legalName: 'Dream App Lab LLC', phone: '(904) 555-0199', notes: '' });
  const entry = [...db.store.values()].find((d) => d && d.type === 'sensitive_update');
  assert.deepEqual(entry.meta.fieldsChanged, ['phone']);
});

test('new company docs carry every profile field', async () => {
  const db = setup();
  await call('ensure-companies', {});
  for (const f of S.COMPANY_PROFILE_FIELDS) assert.equal(typeof db.store.get('companies/zerbiq')[f], 'string', f);
});
