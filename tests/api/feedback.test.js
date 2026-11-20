const test = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, adminToken, setup } = require('../helpers');

process.env.FEEDBACK_ADMIN_TOKEN_SECRET = 'test-feedback-secret-0123456789abcdef0123456789';
delete process.env.MAILGUN_API_KEY;

const feedback = require('../../api/feedback');
const { signWidgetToken, verifyWidgetToken, publicPin, PinSchema, escHtml } = feedback.__test;

const PREVIEW = 'https://coastal-brew-demo.vercel.app';
const seed = () => ({
  'webProjects/coastal': { project_name: 'Coastal Brew', preview_url: `${PREVIEW}/`, status: 'active' },
  'webProjects/other': { project_name: 'Other', preview_url: 'https://other.example/', status: 'active' },
  'feedbackPins/p1': { project_id: 'coastal', note: 'Fix logo', client_email: 'client@example.com', session_id: 'sess-aaaaaaaa', resolved: false, hidden: false },
  'feedbackPins/p2': { project_id: 'other', note: 'Other note', resolved: false, hidden: false },
});
const validPin = (extra = {}) => ({
  project_id: 'coastal',
  session_id: '12345678-aaaa-4bbb-8ccc-123456789012',
  client_name: 'Jamie',
  client_email: 'jamie@example.com',
  page_url: `${PREVIEW}/menu`,
  page_title: 'Menu',
  x_percent: '42.1234',
  y_percent: '10.5',
  selector: 'div.hero',
  note: 'Make the logo bigger',
  ...extra,
});

test('pin schema: valid pin accepted, admin fields rejected, size enforced', () => {
  assert.equal(PinSchema.safeParse(validPin()).success, true);
  for (const field of ['resolved', 'hidden', 'reply_text', 'resolved_at', 'admin']) {
    assert.equal(PinSchema.safeParse(validPin({ [field]: true })).success, false, field);
  }
  const huge = 'data:image/jpeg;base64,' + 'A'.repeat(800 * 1024);
  assert.equal(PinSchema.safeParse(validPin({ screenshot_base64: huge })).success, false);
  assert.equal(PinSchema.safeParse(validPin({ screenshot_base64: 'javascript:alert(1)' })).success, false);
  assert.equal(PinSchema.safeParse(validPin({ page_url: 'javascript:alert(1)' })).success, false);
  assert.equal(PinSchema.safeParse(validPin({ note: '' })).success, false);
  assert.equal(PinSchema.safeParse(validPin({ client_email: 'not-an-email' })).data.client_email, null);
});

test('anonymous widget can create a pin from a registered preview origin', async () => {
  const db = setup(seed());
  const res = mockRes();
  await feedback(mockReq({ method: 'POST', url: '/api/feedback/pin', headers: { origin: PREVIEW }, body: validPin() }), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.headers['access-control-allow-origin'], PREVIEW);
  const created = [...db.store.entries()].find(([p, d]) => p.startsWith('feedbackPins/auto') && d.note === 'Make the logo bigger');
  assert.ok(created);
  assert.equal(created[1].resolved, false);
  assert.equal(created[1].hidden, false);
  assert.equal(res.body.pin.client_email, undefined);
});

test('pin creation from an unknown origin is refused (no wildcard CORS)', async () => {
  setup(seed());
  const res = mockRes();
  await feedback(mockReq({ method: 'POST', url: '/api/feedback/pin', headers: { origin: 'https://evil.example' }, body: validPin() }), res);
  assert.equal(res.statusCode, 403);
});

test('pin for a missing project is 404; pin with admin fields is 400', async () => {
  setup(seed());
  const r1 = mockRes();
  await feedback(mockReq({ method: 'POST', url: '/api/feedback/pin', body: validPin({ project_id: 'nope' }) }), r1);
  assert.equal(r1.statusCode, 404);
  const r2 = mockRes();
  await feedback(mockReq({ method: 'POST', url: '/api/feedback/pin', body: validPin({ resolved: true }) }), r2);
  assert.equal(r2.statusCode, 400);
});

test('public pin list never exposes client emails or other sessions', async () => {
  setup(seed());
  const res = mockRes();
  await feedback(mockReq({ method: 'GET', url: '/api/feedback/pins', query: { project_id: 'coastal' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.pins.length, 1);
  assert.equal(res.body.pins[0].client_email, undefined);
  assert.equal(res.body.pins[0].session_id, undefined);
});

test('anonymous resolve / hide / reply are denied', async () => {
  setup(seed());
  for (const [route, body] of [
    ['resolve', { pin_id: 'p1', resolved: true }],
    ['hide', { pin_id: 'p1', hidden: true }],
    ['reply', { pin_id: 'p1', reply_text: 'x' }],
    ['hide-all', { project_id: 'coastal' }],
    ['admin-link', { project_id: 'coastal' }],
  ]) {
    const res = mockRes();
    await feedback(mockReq({ method: 'POST', url: `/api/feedback/${route}`, body }), res);
    assert.equal(res.statusCode, 401, route);
  }
});

test('Mission Control admin can resolve; widget token works only for its own project', async () => {
  const db = setup(seed());
  const r1 = mockRes();
  await feedback(mockReq({ method: 'POST', url: '/api/feedback/resolve', headers: { authorization: `Bearer ${adminToken()}` }, body: { pin_id: 'p1', resolved: true } }), r1);
  assert.equal(r1.statusCode, 200);
  assert.equal(db.store.get('feedbackPins/p1').resolved, true);

  const token = signWidgetToken('coastal');
  const r2 = mockRes();
  await feedback(mockReq({ method: 'POST', url: '/api/feedback/hide', headers: { authorization: `Bearer ${token}` }, body: { pin_id: 'p1', hidden: true } }), r2);
  assert.equal(r2.statusCode, 200);
  const r3 = mockRes();
  await feedback(mockReq({ method: 'POST', url: '/api/feedback/hide', headers: { authorization: `Bearer ${token}` }, body: { pin_id: 'p2', hidden: true } }), r3);
  assert.equal(r3.statusCode, 403);
});

test('widget tokens expire and cannot be tampered with', () => {
  const now = Math.floor(Date.now() / 1000);
  const t = signWidgetToken('coastal', now);
  assert.equal(verifyWidgetToken(t, now).projectId, 'coastal');
  assert.equal(verifyWidgetToken(t, now + 13 * 3600), null);
  const parts = t.split('.');
  const forged = Buffer.from(JSON.stringify({ p: 'other', exp: now + 999, v: 1 })).toString('base64url');
  assert.equal(verifyWidgetToken(`${parts[0]}.${forged}.${parts[2]}`, now), null);
  assert.equal(verifyWidgetToken('wa1.abc.def', now), null);
});

test('admin link is minted only for a Firebase admin', async () => {
  setup(seed());
  const res = mockRes();
  await feedback(mockReq({ method: 'POST', url: '/api/feedback/admin-link', headers: { authorization: `Bearer ${adminToken()}` }, body: { project_id: 'coastal' } }), res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body.url, /^https:\/\/coastal-brew-demo\.vercel\.app\/#dal_admin_token=wa1\./);
  const widget = mockRes();
  await feedback(mockReq({ method: 'POST', url: '/api/feedback/admin-link', headers: { authorization: `Bearer ${signWidgetToken('coastal')}` }, body: { project_id: 'coastal' } }), widget);
  assert.equal(widget.statusCode, 401);
});

test('email content is HTML-escaped', () => {
  assert.equal(escHtml('<img src=x onerror=alert(1)>"\''), '&lt;img src=x onerror=alert(1)&gt;&quot;&#39;');
  const pin = publicPin({ id: 'x', data: () => ({ note: 'n', client_email: 'a@b.co', session_id: 's1', screenshotDataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(200000) }) }, 's2');
  assert.equal(pin.client_email, undefined);
  assert.equal(pin.session_id, undefined);
  assert.equal(pin.screenshotDataUrl, null);
  assert.equal(pin.hasScreenshot, true);
});
