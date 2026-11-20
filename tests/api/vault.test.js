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
