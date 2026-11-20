const test = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, adminToken, setup } = require('../helpers');
const { withSecurity } = require('../../api/_lib/security');
const { isAdminClaims } = require('../../api/_lib/allowlist');

const ok = async (req, res) => res.status(200).json({ ok: true, auth: req.authKind });
const APP = 'https://dal-tracker.vercel.app';

test('allowlist requires a verified, allowlisted email', () => {
  assert.equal(isAdminClaims({ email: 'lab@dreamapplab.com', email_verified: true }), true);
  assert.equal(isAdminClaims({ email: 'LAB@DreamAppLab.com', email_verified: true }), true);
  assert.equal(isAdminClaims({ email: 'lab@dreamapplab.com', email_verified: false }), false);
  assert.equal(isAdminClaims({ email: 'someone@example.com', email_verified: true }), false);
  assert.equal(isAdminClaims({}), false);
  assert.equal(isAdminClaims(null), false);
});

test('admin endpoint rejects requests with no token (signed-out / anonymous)', async () => {
  setup();
  const h = withSecurity({ name: 't1', methods: ['GET'], auth: 'admin' }, ok);
  const res = mockRes();
  await h(mockReq(), res);
  assert.equal(res.statusCode, 401);
});

test('admin endpoint rejects invalid and revoked tokens', async () => {
  setup();
  const h = withSecurity({ name: 't2', methods: ['GET'], auth: 'admin' }, ok);
  for (const token of ['garbage', 'revoked']) {
    const res = mockRes();
    await h(mockReq({ headers: { authorization: `Bearer ${token}` } }), res);
    assert.equal(res.statusCode, 401, token);
  }
});

test('admin endpoint rejects non-allowlisted and unverified accounts with 403', async () => {
  setup();
  const h = withSecurity({ name: 't3', methods: ['GET'], auth: 'admin' }, ok);
  for (const claims of [{ email: 'intruder@example.com' }, { email_verified: false }]) {
    const res = mockRes();
    await h(mockReq({ headers: { authorization: `Bearer ${adminToken(claims)}` } }), res);
    assert.equal(res.statusCode, 403);
  }
});

test('admin endpoint accepts the allowlisted verified account', async () => {
  setup();
  const h = withSecurity({ name: 't4', methods: ['GET'], auth: 'admin' }, ok);
  const res = mockRes();
  await h(mockReq({ headers: { authorization: `Bearer ${adminToken()}` } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.auth, 'admin');
});

test('method allowlist returns 405', async () => {
  setup();
  const h = withSecurity({ name: 't5', methods: ['GET'], auth: 'admin' }, ok);
  const res = mockRes();
  await h(mockReq({ method: 'DELETE', headers: { authorization: `Bearer ${adminToken()}` } }), res);
  assert.equal(res.statusCode, 405);
});

test('CORS: never wildcard; app origin reflected, foreign origin refused', async () => {
  setup();
  const h = withSecurity({ name: 't6', methods: ['GET'], auth: 'admin' }, ok);
  const good = mockRes();
  await h(mockReq({ method: 'OPTIONS', headers: { origin: APP } }), good);
  assert.equal(good.statusCode, 204);
  assert.equal(good.headers['access-control-allow-origin'], APP);

  const preview = mockRes();
  const previewOrigin = 'https://dal-tracker-abc123xyz-dream-app-lab.vercel.app';
  await h(mockReq({ method: 'OPTIONS', headers: { origin: previewOrigin } }), preview);
  assert.equal(preview.headers['access-control-allow-origin'], previewOrigin);

  const bad = mockRes();
  await h(mockReq({ method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), bad);
  assert.equal(bad.statusCode, 403);
  assert.equal(bad.headers['access-control-allow-origin'], undefined);

  const badGet = mockRes();
  await h(mockReq({ headers: { origin: 'https://evil.example', authorization: `Bearer ${adminToken()}` } }), badGet);
  assert.equal(badGet.statusCode, 403);
  for (const r of [good, preview, bad, badGet]) assert.notEqual(r.headers['access-control-allow-origin'], '*');
});

test('recent sign-in requirement', async () => {
  setup();
  const h = withSecurity({ name: 't7', methods: ['POST'], auth: 'admin', recentAuthSeconds: 300 }, ok);
  const stale = mockRes();
  const old = Math.floor(Date.now() / 1000) - 3600;
  await h(mockReq({ method: 'POST', headers: { authorization: `Bearer ${adminToken({ auth_time: old })}` } }), stale);
  assert.equal(stale.statusCode, 401);
  assert.equal(stale.body.code, 'recent_auth_required');

  const fresh = mockRes();
  await h(mockReq({ method: 'POST', headers: { authorization: `Bearer ${adminToken()}` } }), fresh);
  assert.equal(fresh.statusCode, 200);
});

test('admin-or-internal accepts the internal secret, constant-time compare', async () => {
  setup();
  process.env.DAL_MC_INTERNAL_SECRET = 'internal-secret-value-for-tests-123456';
  const h = withSecurity({ name: 't8', methods: ['POST'], auth: 'admin-or-internal' }, ok);
  const good = mockRes();
  await h(mockReq({ method: 'POST', headers: { authorization: 'Bearer internal-secret-value-for-tests-123456' } }), good);
  assert.equal(good.statusCode, 200);
  assert.equal(good.body.auth, 'internal');
  const bad = mockRes();
  await h(mockReq({ method: 'POST', headers: { authorization: 'Bearer internal-secret-value-for-tests-12345X' } }), bad);
  assert.equal(bad.statusCode, 401);
  delete process.env.DAL_MC_INTERNAL_SECRET;
});

test('rate limiting returns 429 with Retry-After', async () => {
  setup();
  const h = withSecurity({ name: 't9', methods: ['GET'], auth: 'admin', rateLimit: { limit: 3, windowMs: 60_000 } }, ok);
  let last;
  for (let i = 0; i < 4; i++) {
    last = mockRes();
    await h(mockReq({ headers: { authorization: `Bearer ${adminToken()}` } }), last);
  }
  assert.equal(last.statusCode, 429);
  assert.ok(Number(last.headers['retry-after']) > 0);
});

test('unhandled errors return a generic 500 without internal details', async () => {
  setup();
  const h = withSecurity({ name: 't10', methods: ['GET'], auth: 'admin' }, async () => {
    throw new Error('db password is hunter2');
  });
  const res = mockRes();
  const origError = console.error;
  console.error = () => {};
  await h(mockReq({ headers: { authorization: `Bearer ${adminToken()}` } }), res);
  console.error = origError;
  assert.equal(res.statusCode, 500);
  assert.doesNotMatch(JSON.stringify(res.body), /hunter2/);
});

test('every API function is wrapped by withSecurity (no unauthenticated handler slips through)', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '../../api');
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== '_lib') walk(p); } else if (e.name.endsWith('.js')) files.push(p);
    }
  })(root);
  const missing = files.filter((f) => {
    const src = fs.readFileSync(f, 'utf8');
    if (path.basename(f) === 'messages.js' && src.includes("require('../quotes')")) return false; // delegates to quotes.js
    return !/withSecurity\(/.test(src);
  });
  assert.deepEqual(missing.map((f) => path.relative(root, f)), []);
  const wildcard = files.filter((f) => /Access-Control-Allow-Origin['"],\s*['"]\*['"]/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(wildcard, []);
});
