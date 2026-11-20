const test = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, adminToken, setup } = require('../helpers');

const tools = require('../../api/tools/[tool].js');

const call = async (tool) => {
  setup();
  const req = mockReq({ method: 'GET', query: { tool }, headers: { authorization: `Bearer ${adminToken()}`, origin: 'https://dal-tracker.vercel.app' } });
  const res = mockRes();
  await tools(req, res);
  return res;
};

test('tools without a live card hold no keys and are not served', async () => {
  for (const tool of ['sentry', 'posthog', 'expo', 'crisp']) {
    assert.equal((await call(tool)).statusCode, 404, tool);
  }
});

test('live tools report a missing key by name, never a value', async () => {
  const saved = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  try {
    const res = await call('github');
    assert.equal(res.statusCode, 502);
    assert.match(res.body.detail, /Missing GITHUB_TOKEN/);
  } finally {
    if (saved !== undefined) process.env.GITHUB_TOKEN = saved;
  }
});
