const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { mockReq, mockRes, adminToken, setup } = require('../helpers');
const { writeAudit, sanitizeMeta } = require('../../api/_lib/audit');
const { verifyMailgunRequest, computeSignature } = require('../../api/_lib/mailgunWebhook');
const { ADMIN_EMAILS, ADMIN_UIDS } = require('../../api/_lib/allowlist');
const { checkSource, isPublicName } = require('../../scripts/check-secrets');

test('audit entries are written server-side with actor, target and no secrets', async () => {
  const db = setup();
  await writeAudit(
    {
      type: 'vault_reveal',
      actor: { uid: 'u1', email: 'lab@dreamapplab.com' },
      target: 'companies/dal/bankAccounts/a1',
      meta: { field: 'accountNumber', accountNumber: '123456789', token: 'x', note: 'ok' },
    },
    mockReq({ headers: { 'user-agent': 'UA' } })
  );
  const entries = [...db.store.entries()].filter(([p]) => p.startsWith('auditLog/'));
  assert.equal(entries.length, 1);
  const e = entries[0][1];
  assert.equal(e.type, 'vault_reveal');
  assert.equal(e.actorEmail, 'lab@dreamapplab.com');
  assert.equal(e.target, 'companies/dal/bankAccounts/a1');
  assert.equal(e.ip, '203.0.113.7');
  assert.equal(e.meta.accountNumber, undefined);
  assert.equal(e.meta.token, undefined);
  assert.equal(e.meta.field, 'accountNumber');
  await assert.rejects(writeAudit({ type: 'made_up' }));
});

test('sanitizeMeta drops sensitive keys and non-scalar values', () => {
  assert.deepEqual(sanitizeMeta({ ein: '12', cardNumber: '4111', cvv: '1', pin: '1', ok: 1, obj: { a: 1 } }), { ok: 1 });
});

test('sign-in endpoint records an audit entry (and rejects anonymous)', async () => {
  const db = setup();
  const signIn = require('../../api/auth/sign-in');
  const anon = mockRes();
  await signIn(mockReq({ method: 'POST' }), anon);
  assert.equal(anon.statusCode, 401);
  const res = mockRes();
  await signIn(mockReq({ method: 'POST', headers: { authorization: `Bearer ${adminToken()}` } }), res);
  assert.equal(res.statusCode, 200);
  const entries = [...db.store.values()].filter((d) => d && d.type === 'sign_in');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].meta.provider, 'google.com');
});

test('client audit endpoint accepts only client-reportable event types', async () => {
  const db = setup();
  const event = require('../../api/audit/event');
  const bad = mockRes();
  await event(mockReq({ method: 'POST', headers: { authorization: `Bearer ${adminToken()}` }, body: { type: 'vault_reveal', target: 'x' } }), bad);
  assert.equal(bad.statusCode, 400);
  const good = mockRes();
  await event(mockReq({ method: 'POST', headers: { authorization: `Bearer ${adminToken()}` }, body: { type: 'delete', target: 'expenses/abc' } }), good);
  assert.equal(good.statusCode, 200);
  assert.equal([...db.store.values()].filter((d) => d && d.type === 'delete').length, 1);
});

test('Mailgun webhook signatures are verified (valid, forged, stale, replayed)', async () => {
  const key = 'test-signing-key';
  const ts = String(Math.floor(Date.now() / 1000));
  const token = 'tok-' + Math.random().toString(36).slice(2);
  const body = { timestamp: ts, token, signature: computeSignature(key, ts, token) };
  assert.equal(await verifyMailgunRequest(body, { keyOverride: key }), true);
  assert.equal(await verifyMailgunRequest(body, { keyOverride: key }), false, 'replay');
  const t2 = token + 'b';
  assert.equal(await verifyMailgunRequest({ timestamp: ts, token: t2, signature: computeSignature('wrong', ts, t2) }, { keyOverride: key }), false);
  const old = String(Math.floor(Date.now() / 1000) - 3600);
  assert.equal(await verifyMailgunRequest({ timestamp: old, token: 'z1', signature: computeSignature(key, old, 'z1') }, { keyOverride: key }), false);
});

test('allowlist is identical in api/_lib, firestore.rules and storage.rules', () => {
  const root = path.join(__dirname, '../..');
  for (const file of ['firestore.rules', 'storage.rules']) {
    const rules = fs.readFileSync(path.join(root, file), 'utf8');
    const emails = /email\.lower\(\) in \[([^\]]*)\]/.exec(rules)[1];
    const uids = /request\.auth\.uid in \[([^\]]*)\]/.exec(rules)[1];
    const parse = (s) => s.split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
    assert.deepEqual(parse(emails), [...ADMIN_EMAILS], file);
    assert.deepEqual(parse(uids), [...ADMIN_UIDS], file);
    assert.match(rules, /email_verified == true/, file);
  }
});

test('source tree passes the client-secret guard', () => {
  assert.deepEqual(checkSource(), []);
  assert.equal(isPublicName('REACT_APP_FT_API_KEY'), true);
  assert.equal(isPublicName('REACT_APP_GITHUB_TOKEN'), false);
  assert.equal(isPublicName('REACT_APP_REVENUECAT_SECRET_LOGABODE'), false);
});

test('twilio endpoint validates E.164 and requires admin', async () => {
  setup();
  const sms = require('../../api/twilio/sms');
  const anon = mockRes();
  await sms(mockReq({ method: 'POST', body: { to: '+19045551212', body: 'hi' } }), anon);
  assert.equal(anon.statusCode, 401);
  const bad = mockRes();
  await sms(mockReq({ method: 'POST', headers: { authorization: `Bearer ${adminToken()}` }, body: { to: '904-555', body: 'hi' } }), bad);
  assert.equal(bad.statusCode, 400);
});
