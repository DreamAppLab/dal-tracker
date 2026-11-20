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
  const isDeleteSentinel = (v) => v && typeof v === 'object' && v.constructor && /DeleteTransform|FieldValue/.test(v.constructor.name) && String(v.methodName || v._methodName || '').includes('delete');
  function deepMerge(base, data) {
    const out = { ...(base || {}) };
    for (const [k, v] of Object.entries(data)) {
      if (isDeleteSentinel(v)) { delete out[k]; continue; }
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v.constructor && v.constructor.name !== 'Object')) out[k] = deepMerge(out[k], v);
      else out[k] = v;
    }
    return out;
  }
  // Mirror the Admin SDK's write validation so tests catch what production would reject.
  const isPlainMap = (v) => v && typeof v === 'object' && !Array.isArray(v) && (!v.constructor || v.constructor.name === 'Object');
  function validateWrite(data, mode, depth = 0) {
    for (const [k, v] of Object.entries(data || {})) {
      if (v === undefined) throw new Error(`Cannot use "undefined" as a Firestore value (found in field "${k}")`);
      if (isDeleteSentinel(v)) {
        if (mode === 'set' || mode === 'create') throw new Error('FieldValue.delete() must appear at the top-level and can only be used in update() or set() with {merge:true}');
        if (mode === 'update' && depth > 0) throw new Error('FieldValue.delete() must appear at the top-level and can only be used in update() or set() with {merge:true}');
        continue;
      }
      if (isPlainMap(v)) validateWrite(v, mode, depth + 1);
    }
  }
  const docRef = (path) => ({
    id: path.split('/').pop(),
    path,
    async get() {
      const data = store.get(path);
      return { exists: data !== undefined, id: path.split('/').pop(), data: () => data, ref: docRef(path) };
    },
    async set(data, opts) {
      validateWrite(data, opts && opts.merge ? 'merge' : 'set');
      store.set(path, opts && opts.merge ? deepMerge(store.get(path), data) : data);
    },
    // Like Firestore: create() fails if the doc exists (code 6), update() fails
    // if it is missing (code 5) and treats dotted keys as nested field paths.
    async create(data) {
      validateWrite(data, 'create');
      if (store.has(path)) throw Object.assign(new Error('6 ALREADY_EXISTS: Document already exists'), { code: 6 });
      store.set(path, data);
    },
    async update(data) {
      validateWrite(data, 'update');
      if (!store.has(path)) throw Object.assign(new Error('5 NOT_FOUND: No document to update'), { code: 5 });
      const out = { ...store.get(path) };
      for (const [k, v] of Object.entries(data)) {
        const keys = k.split('.');
        let cur = out;
        for (const part of keys.slice(0, -1)) { cur[part] = { ...(cur[part] || {}) }; cur = cur[part]; }
        const last = keys[keys.length - 1];
        if (isDeleteSentinel(v)) delete cur[last]; else cur[last] = v;
      }
      store.set(path, out);
    },
    async delete() { store.delete(path); },
    collection: (name) => collection(`${path}/${name}`),
  });
  const depth = (p) => p.split('/').length;
  const collection = (name) => ({
    doc: (id) => docRef(`${name}/${id || `auto${++autoId}`}`),
    async add(data) { const ref = docRef(`${name}/auto${++autoId}`); store.set(ref.path, data); return ref; },
    where(field, op, value) {
      return {
        async get() {
          const docs = [...store.entries()]
            .filter(([p, d]) => p.startsWith(`${name}/`) && depth(p) === depth(name) + 1 && d && d[field] === value)
            .map(([p, d]) => ({ id: p.split('/').pop(), data: () => d, ref: docRef(p) }));
          return { docs, size: docs.length, empty: !docs.length };
        },
      };
    },
    async get() {
      const docs = [...store.entries()]
        .filter(([p]) => p.startsWith(`${name}/`) && depth(p) === depth(name) + 1)
        .map(([p, d]) => ({ id: p.split('/').pop(), data: () => d, ref: docRef(p) }));
      return { docs, size: docs.length, empty: !docs.length };
    },
  });
  return {
    store,
    collection,
    doc: docRef,
    // Optimistic transactions like Firestore's: reads must come before writes;
    // at commit, if any document or query read inside the transaction changed,
    // the whole function is retried (up to 5 times); writes are atomic (rolled
    // back if any fails). Tests can set db.beforeCommit = () => {...} to simulate
    // a concurrent write between the transaction's reads and its commit.
    async runTransaction(fn) {
      const fp = (v) => JSON.stringify(v === undefined ? null : v);
      for (let attempt = 0; attempt < 5; attempt++) {
        const ops = [];
        const reads = []; // [() => current fingerprint, fingerprint at read]
        const tx = {
          async get(refOrQuery) {
            if (ops.length) throw new Error('Firestore transactions require all reads to be executed before all writes.');
            const snap = await refOrQuery.get();
            const now = async () => {
              const s2 = await refOrQuery.get();
              return fp(s2.docs ? s2.docs.map((d) => [d.id, d.data()]) : s2.exists ? s2.data() : null);
            };
            reads.push([now, await now()]);
            return snap;
          },
          set: (ref, d, o) => { validateWrite(d, o && o.merge ? 'merge' : 'set'); ops.push(() => ref.set(d, o)); return tx; },
          update: (ref, d) => { validateWrite(d, 'update'); ops.push(() => ref.update(d)); return tx; },
          create: (ref, d) => { validateWrite(d, 'create'); ops.push(() => ref.create(d)); return tx; },
          delete: (ref) => { ops.push(() => ref.delete()); return tx; },
        };
        const result = await fn(tx);
        if (typeof this.beforeCommit === 'function') {
          const hook = this.beforeCommit;
          this.beforeCommit = null;
          await hook();
        }
        let conflict = false;
        for (const [now, then] of reads) if ((await now()) !== then) conflict = true;
        if (conflict) continue;
        const backup = new Map(store);
        try {
          for (const op of ops) await op();
        } catch (e) {
          store.clear();
          backup.forEach((v, k) => store.set(k, v));
          throw e;
        }
        return result;
      }
      throw Object.assign(new Error('10 ABORTED: Too much contention'), { code: 10 });
    },
    batch() {
      const ops = [];
      return {
        create: (ref, d) => ops.push(() => ref.create(d)),
        update: (ref, d) => ops.push(() => ref.update(d)),
        set: (ref, d, o) => ops.push(() => ref.set(d, o)),
        delete: (ref) => ops.push(() => ref.delete()),
        async commit() { for (const op of ops) await op(); },
      };
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
