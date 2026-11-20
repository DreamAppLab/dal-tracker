// Shared request security for every Mission Control API function.
//
//   module.exports = withSecurity({ methods: ['GET'], auth: 'admin' }, handler)
//
// What it does, in order:
//   1. no-store / nosniff response headers
//   2. CORS — never "*". Admin endpoints allow only Mission Control's own
//      origins; server-to-server endpoints send no CORS headers at all.
//   3. OPTIONS preflight, then a method allowlist (405)
//   4. rate limiting (429)
//   5. authentication (401) + authorisation (403):
//        'admin'           Firebase ID token (verified, revocation-checked),
//                          verified email on the allowlist
//        'admin-or-internal' as admin, or "Bearer <DAL_MC_INTERNAL_SECRET>"
//                          for server-to-server callers (dal-site)
//        'public'          no auth (handler must validate + rate limit)
//   6. optional recent sign-in requirement (auth_time within N seconds)
//   7. generic 500s — internal error messages are logged, never returned

const crypto = require('crypto');
const { isAdminClaims } = require('./allowlist');
const { getMcAuth } = require('./firebaseAdmin');
const { checkRateLimit } = require('./rateLimit');
const { clientIp } = require('./audit');

const PROD_ORIGINS = ['https://dal-tracker.vercel.app', 'https://dal-tracker-dream-app-lab.vercel.app'];
// Vercel preview / branch URLs for this project only.
const PREVIEW_ORIGIN_RE = /^https:\/\/dal-tracker-[a-z0-9-]+-dream-app-lab\.vercel\.app$/;
const DEV_ORIGINS = ['http://localhost:3000'];

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.expose = true;
    this.extra = extra;
  }
}

function isAppOrigin(origin) {
  if (!origin) return false;
  if (PROD_ORIGINS.includes(origin)) return true;
  if (PREVIEW_ORIGIN_RE.test(origin)) return true;
  if (process.env.VERCEL_ENV !== 'production' && DEV_ORIGINS.includes(origin)) return true;
  return false;
}

function setBaseHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

async function applyCors(req, res, opts) {
  const origin = req.headers.origin;
  if (opts.cors === 'none' || !origin) return true;
  let allowed = false;
  if (typeof opts.cors === 'function') {
    allowed = await opts.cors(origin, req);
  } else {
    allowed = isAppOrigin(origin);
  }
  res.setHeader('Vary', 'Origin');
  if (!allowed) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', [...opts.methods, 'OPTIONS'].join(', '));
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}

function bearerToken(req) {
  const h = String(req.headers.authorization || req.headers.Authorization || '');
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : '';
}

function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

async function verifyAdmin(req) {
  const token = bearerToken(req);
  if (!token) throw new HttpError(401, 'Sign-in required');
  let decoded;
  try {
    decoded = await getMcAuth().verifyIdToken(token, true);
  } catch (e) {
    const code = e && e.code ? String(e.code) : '';
    if (code.includes('revoked')) throw new HttpError(401, 'Session revoked — sign in again');
    throw new HttpError(401, 'Invalid or expired sign-in');
  }
  if (!isAdminClaims(decoded)) throw new HttpError(403, 'This account is not allowed');
  return decoded;
}

function requireRecentAuth(decoded, maxAgeSeconds) {
  const authTime = Number(decoded && decoded.auth_time);
  const now = Math.floor(Date.now() / 1000);
  if (!authTime || now - authTime > maxAgeSeconds) {
    throw new HttpError(401, 'Recent sign-in required', { code: 'recent_auth_required', maxAgeSeconds });
  }
}

function internalSecretMatches(req) {
  const secret = process.env.DAL_MC_INTERNAL_SECRET || '';
  const token = bearerToken(req);
  return !!secret && !!token && timingSafeEqualStr(token, secret);
}

function parseJsonBody(req, { maxBytes = 1024 * 1024 } = {}) {
  let body = req.body;
  if (body == null || body === '') return {};
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    if (Buffer.byteLength(body) > maxBytes) throw new HttpError(413, 'Request body too large');
    try {
      body = JSON.parse(body);
    } catch {
      throw new HttpError(400, 'Invalid JSON body');
    }
  } else {
    try {
      if (Buffer.byteLength(JSON.stringify(body)) > maxBytes) throw new HttpError(413, 'Request body too large');
    } catch (e) {
      if (e instanceof HttpError) throw e;
    }
  }
  if (typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'JSON object body required');
  return body;
}

// Validate with a zod schema; throws a 400 listing the bad fields.
function validate(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const fields = result.error.issues.map((i) => i.path.join('.') || '(root)');
    throw new HttpError(400, `Invalid input: ${[...new Set(fields)].join(', ')}`);
  }
  return result.data;
}

const DEFAULT_LIMITS = {
  admin: { limit: 240, windowMs: 60_000 },
  'admin-or-internal': { limit: 240, windowMs: 60_000 },
  public: { limit: 30, windowMs: 60_000 },
};

function withSecurity(options, handler) {
  const opts = {
    methods: ['GET'],
    auth: 'admin',
    cors: 'app',
    rateLimit: undefined,
    recentAuthSeconds: 0,
    durableRateLimit: false, // true = count in Firestore across instances (costs a write per request)
    ...options,
  };
  if (!['admin', 'admin-or-internal', 'public'].includes(opts.auth)) {
    throw new Error(`withSecurity: unknown auth mode ${opts.auth}`);
  }
  const limits = opts.rateLimit === false ? null : opts.rateLimit || DEFAULT_LIMITS[opts.auth];
  const routeKey = opts.name || 'api';

  return async function securedHandler(req, res) {
    setBaseHeaders(res);
    try {
      const corsOk = await applyCors(req, res, opts);
      if (req.method === 'OPTIONS') {
        return res.status(corsOk ? 204 : 403).end();
      }
      if (!corsOk) throw new HttpError(403, 'Origin not allowed');
      if (!opts.methods.includes(req.method)) {
        res.setHeader('Allow', opts.methods.join(', '));
        throw new HttpError(405, 'Method not allowed');
      }

      if (limits) {
        const rl = await checkRateLimit({
          key: `${routeKey}:${clientIp(req) || 'unknown'}`,
          limit: limits.limit,
          windowMs: limits.windowMs,
          durable: opts.durableRateLimit === true,
        });
        if (!rl.allowed) {
          res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
          throw new HttpError(429, 'Too many requests');
        }
      }

      req.auth = null;
      req.authKind = 'public';
      if (opts.auth === 'admin' || opts.auth === 'admin-or-internal') {
        if (opts.auth === 'admin-or-internal' && internalSecretMatches(req)) {
          req.authKind = 'internal';
        } else {
          req.auth = await verifyAdmin(req);
          req.authKind = 'admin';
          if (opts.recentAuthSeconds) requireRecentAuth(req.auth, opts.recentAuthSeconds);
        }
      }

      return await handler(req, res);
    } catch (e) {
      if (e instanceof HttpError || (e && e.expose && e.status)) {
        if (!res.headersSent) {
          return res.status(e.status).json({ error: e.message, ...(e.extra || {}) });
        }
        return undefined;
      }
      console.error(`[${routeKey}] unhandled error:`, e && e.message ? e.message : e);
      if (!res.headersSent) return res.status(500).json({ error: 'Request failed' });
      return undefined;
    }
  };
}

module.exports = {
  withSecurity,
  HttpError,
  parseJsonBody,
  validate,
  isAppOrigin,
  bearerToken,
  timingSafeEqualStr,
  requireRecentAuth,
  verifyAdmin,
  internalSecretMatches,
};
