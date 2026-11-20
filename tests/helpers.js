// Shared helpers for API unit tests (node:test).

const firebaseAdmin = require('../api/_lib/firebaseAdmin');
const { __resetMemory } = require('../api/_lib/rateLimit');

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    headersSent: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; this.ended = true; this.headersSent = true; return this; },
    end() { this.ended = true; this.headersSent = true; return this; },
  };
  return res;
}

function mockReq({ method = 'GET', headers = {}, body, query = {}, url = '/api/test' } = {}) {
  return { method, headers: { 'x-forwarded-for': '203.0.113.7', ...headers }, body, query, url };
}

// Minimal in-memory Firestore stand-in (enough for audit + rate limit + feedback reads).
function fakeDb(seed = {}) {
  const store = new Map(Object.entries(seed)); // path -> data
  let autoId = 0;
  const docRef = (path) => ({
    id: path.split('/').pop(),
    path,
    async get() {
      const data = store.get(path);
      return { exists: data !== undefined, id: path.split('/').pop(), data: () => data, ref: docRef(path) };
    },
    async set(data, opts) { store.set(path, opts && opts.merge ? { ...(store.get(path) || {}), ...data } : data); },
    async update(data) { store.set(path, { ...(store.get(path) || {}), ...data }); },
    async delete() { store.delete(path); },
  });
  const collection = (name) => ({
    doc: (id) => docRef(`${name}/${id || `auto${++autoId}`}`),
    async add(data) { const ref = docRef(`${name}/auto${++autoId}`); store.set(ref.path, data); return ref; },
    where(field, op, value) {
      return {
        async get() {
          const docs = [...store.entries()]
            .filter(([p, d]) => p.startsWith(`${name}/`) && p.split('/').length === 2 && d && d[field] === value)
            .map(([p, d]) => ({ id: p.split('/')[1], data: () => d, ref: docRef(p) }));
          return { docs, size: docs.length, empty: !docs.length };
        },
      };
    },
    async get() {
      const docs = [...store.entries()]
        .filter(([p]) => p.startsWith(`${name}/`) && p.split('/').length === 2)
        .map(([p, d]) => ({ id: p.split('/')[1], data: () => d, ref: docRef(p) }));
      return { docs, size: docs.length, empty: !docs.length };
    },
  });
  return {
    store,
    collection,
    async runTransaction(fn) {
      return fn({ get: (ref) => ref.get(), set: (ref, data) => ref.set(data) });
    },
    batch() {
      const ops = [];
      return { update: (ref, d) => ops.push(() => ref.update(d)), async commit() { for (const op of ops) await op(); } };
    },
  };
}

// Fake Firebase Auth: tokens are JSON strings of the claims to return.
const fakeAuth = {
  async verifyIdToken(token) {
    if (token === 'revoked') throw Object.assign(new Error('revoked'), { code: 'auth/id-token-revoked' });
    try {
      return JSON.parse(token);
    } catch {
      throw Object.assign(new Error('bad token'), { code: 'auth/argument-error' });
    }
  },
};

function adminToken(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return JSON.stringify({
    uid: 'eddie-uid',
    sub: 'eddie-uid',
    email: 'lab@dreamapplab.com',
    email_verified: true,
    auth_time: now - 60,
    firebase: { sign_in_provider: 'google.com' },
    ...overrides,
  });
}

function setup(seed) {
  const db = fakeDb(seed);
  firebaseAdmin.__setTestOverrides({ db, auth: fakeAuth });
  __resetMemory();
  return db;
}

module.exports = { mockReq, mockRes, fakeDb, fakeAuth, adminToken, setup };
