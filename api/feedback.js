// DAL Feedback API — backed by Firebase/Firestore (dal-mission-control)
//
// PUBLIC (embedded widget on client preview sites, no login):
//   POST /api/feedback/pin        create a pin (validated, size-limited, rate-limited)
//   GET  /api/feedback/pins       list a project's visible pins (no emails / private fields)
//
// ADMIN (Mission Control Firebase sign-in, OR a short-lived signed widget-admin
// token minted by Mission Control for one project):
//   POST /api/feedback/resolve    resolve / reopen a pin
//   POST /api/feedback/reply      reply to a pin (emails the client)
//   POST /api/feedback/hide       hide one pin
//   POST /api/feedback/hide-all   hide every pin in a project
//   POST /api/feedback/admin-link mint a widget-admin token (Firebase admin only)
//
// CORS is never "*": only Mission Control's own origins and the preview-site
// origins registered on webProjects (preview_url / allowed_origins) are allowed.

const crypto = require('crypto');
const { FieldValue } = require('firebase-admin/firestore');
const { z } = require('zod');
const { getMcDb } = require('./_lib/firebaseAdmin');
const { withSecurity, HttpError, parseJsonBody, validate, isAppOrigin, bearerToken, verifyAdmin } = require('./_lib/security');
const { checkRateLimit } = require('./_lib/rateLimit');
const { clientIp, writeAuditSafe: writeAudit } = require('./_lib/audit');
const { labInbox } = require('./_lib/mail');

const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || 'inbound.dreamapplab.com';
const MAILGUN_FROM = process.env.MAILGUN_FROM || 'Dream App Lab <lab@inbound.dreamapplab.com>';

// Firestore documents max out at 1 MiB; keep the screenshot comfortably below.
const MAX_SCREENSHOT_CHARS = 700 * 1024;
const WIDGET_TOKEN_TTL_SECONDS = 12 * 60 * 60;

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const DocId = z.string().regex(ID_RE);

// ── helpers ─────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHttpUrl(raw) {
  try {
    const u = new URL(String(raw));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function originOf(raw) {
  try {
    const u = new URL(String(raw));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}

// www.example.com and example.com are treated as the same site.
function originVariants(origin) {
  try {
    const u = new URL(origin);
    const host = u.hostname.startsWith('www.') ? u.hostname.slice(4) : u.hostname;
    const port = u.port ? `:${u.port}` : '';
    return [`${u.protocol}//${host}${port}`, `${u.protocol}//www.${host}${port}`];
  } catch {
    return [];
  }
}

let originCache = { at: 0, origins: new Set() };
const ORIGIN_CACHE_MS = 5 * 60 * 1000;
const ORIGIN_MISS_REFRESH_MS = 30 * 1000;

async function loadWidgetOrigins() {
  const snap = await getMcDb().collection('webProjects').get();
  const set = new Set();
  const add = (raw) => {
    const o = originOf(raw);
    if (o) originVariants(o).forEach((v) => set.add(v));
  };
  snap.docs.forEach((d) => {
    const p = d.data() || {};
    add(p.preview_url);
    if (Array.isArray(p.allowed_origins)) p.allowed_origins.forEach(add);
  });
  originCache = { at: Date.now(), origins: set };
  return set;
}

async function corsForFeedback(origin) {
  if (isAppOrigin(origin)) return true;
  const age = Date.now() - originCache.at;
  if (age < ORIGIN_CACHE_MS && originCache.origins.has(origin)) return true;
  // Miss (or stale): refresh at most every 30 s so a newly added project works right away.
  if (age >= ORIGIN_MISS_REFRESH_MS) await loadWidgetOrigins();
  return originCache.origins.has(origin);
}

function serializeDoc(doc) {
  const data = doc.data();
  const result = { id: doc.id };
  for (const [k, v] of Object.entries(data)) {
    result[k] = v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v;
  }
  return result;
}

// Public view of a pin: only what the widget renders.
function publicPin(doc, sessionId) {
  const p = serializeDoc(doc);
  const out = {
    id: p.id,
    project_id: p.project_id,
    client_name: p.client_name || null,
    page_url: p.page_url,
    page_title: p.page_title || null,
    x_percent: p.x_percent,
    y_percent: p.y_percent,
    selector: p.selector || null,
    note: p.note,
    resolved: !!p.resolved,
    resolved_at: p.resolved_at || null,
    reply_text: p.reply_text || null,
    reply_at: p.reply_at || null,
    created_at: p.created_at || null,
    hasScreenshot: !!p.screenshotDataUrl,
    screenshotDataUrl: p.screenshotDataUrl && p.screenshotDataUrl.length <= 100000 ? p.screenshotDataUrl : null,
  };
  if (sessionId && p.session_id === sessionId) out.session_id = p.session_id;
  return out;
}

async function sendMailgun(to, subject, html) {
  const key = process.env.MAILGUN_API_KEY;
  if (!key) return;
  const params = new URLSearchParams();
  params.append('from', MAILGUN_FROM);
  params.append('to', to);
  params.append('subject', subject);
  params.append('html', html);
  try {
    await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from('api:' + key).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
  } catch (e) {
    console.error('Mailgun error:', e && e.message);
  }
}

// ── widget-admin tokens (HMAC, per project, expiring) ──────────────────────
function widgetTokenSecret() {
  const s = process.env.FEEDBACK_ADMIN_TOKEN_SECRET;
  if (!s || s.length < 32) throw new HttpError(503, 'Widget admin mode is not configured');
  return s;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signWidgetToken(projectId, nowSec = Math.floor(Date.now() / 1000)) {
  const payload = b64url(JSON.stringify({ p: projectId, exp: nowSec + WIDGET_TOKEN_TTL_SECONDS, v: 1 }));
  const sig = b64url(crypto.createHmac('sha256', widgetTokenSecret()).update(payload).digest());
  return `wa1.${payload}.${sig}`;
}

function verifyWidgetToken(token, nowSec = Math.floor(Date.now() / 1000)) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts[0] !== 'wa1') return null;
  const expected = b64url(crypto.createHmac('sha256', widgetTokenSecret()).update(parts[1]).digest());
  const a = Buffer.from(expected);
  const b = Buffer.from(parts[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.p !== 'string' || typeof payload.exp !== 'number' || payload.exp < nowSec) return null;
  return { projectId: payload.p, exp: payload.exp };
}

// Resolves the caller for admin actions: Firebase admin (any project) or
// widget token (one project). Returns { kind, actor, projectId }.
async function feedbackAdmin(req) {
  const token = bearerToken(req);
  if (token.startsWith('wa1.')) {
    const w = verifyWidgetToken(token);
    if (!w) throw new HttpError(401, 'Admin link expired — open it again from Mission Control');
    return { kind: 'widget', actor: { uid: null, email: 'widget-admin-link' }, projectId: w.projectId };
  }
  const decoded = await verifyAdmin(req);
  return { kind: 'firebase', actor: decoded, projectId: null };
}

async function loadPinForAdmin(db, pinId, caller) {
  const ref = db.collection('feedbackPins').doc(pinId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, 'Pin not found');
  if (caller.projectId && snap.data().project_id !== caller.projectId) throw new HttpError(403, 'Not allowed for this project');
  return { ref, snap };
}

// ── schemas ────────────────────────────────────────────────────────────────
const clipStr = (max) => z.preprocess((v) => (v == null ? null : String(v).trim().slice(0, max) || null), z.string().nullable());
const PinSchema = z
  .object({
    project_id: DocId,
    session_id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
    client_name: clipStr(100).optional(),
    // Optional contact email: keep it only if it is a real address.
    client_email: z
      .preprocess((v) => {
        const e = v == null ? '' : String(v).trim();
        return /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e) && e.length <= 254 ? e : null;
      }, z.string().nullable())
      .optional(),
    page_url: z.string().max(4096).refine((v) => !!safeHttpUrl(v), 'http(s) URL required'),
    page_title: clipStr(300).optional(),
    x_percent: z.coerce.number().finite().min(0).max(100),
    y_percent: z.coerce.number().finite().min(0).max(100),
    selector: clipStr(1000).optional(),
    note: z.string().trim().min(1).max(5000),
    // An oversized or malformed screenshot is dropped, never a reason to lose the note.
    screenshot_base64: z
      .preprocess(
        (v) =>
          typeof v === 'string' && v.length <= MAX_SCREENSHOT_CHARS && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v)
            ? v
            : null,
        z.string().nullable()
      )
      .optional(),
  })
  .strict(); // rejects client-set resolved/hidden/reply/admin fields

const ResolveSchema = z.object({ pin_id: DocId, resolved: z.boolean() });
const ReplySchema = z.object({ pin_id: DocId, reply_text: z.string().trim().min(1).max(5000) });
const HideSchema = z.object({ pin_id: DocId, hidden: z.boolean() });
const HideAllSchema = z.object({ project_id: DocId });
const AdminLinkSchema = z.object({ project_id: DocId });

// ── handlers ───────────────────────────────────────────────────────────────
async function handlePostPin(req, res) {
  const rl = await checkRateLimit({ key: `feedback-pin:${clientIp(req) || 'unknown'}`, limit: 60, windowMs: 10 * 60 * 1000, durable: true });
  if (!rl.allowed) throw new HttpError(429, 'Too many notes — please wait a few minutes');

  const body = validate(PinSchema, parseJsonBody(req, { maxBytes: 4 * 1024 * 1024 }));
  const db = getMcDb();
  const projectDoc = await db.collection('webProjects').doc(body.project_id).get();
  if (!projectDoc.exists) throw new HttpError(404, 'Project not found');
  const project = projectDoc.data() || {};
  if (project.status === 'archived') throw new HttpError(403, 'Feedback is closed for this project');
  const daily = await checkRateLimit({ key: `feedback-pin-project:${body.project_id}`, limit: 500, windowMs: 24 * 60 * 60 * 1000, durable: true });
  if (!daily.allowed) throw new HttpError(429, 'This project has reached today’s feedback limit');

  const pinData = {
    project_id: body.project_id,
    session_id: body.session_id,
    client_name: body.client_name || null,
    client_email: body.client_email || null,
    page_url: safeHttpUrl(body.page_url),
    page_title: body.page_title || null,
    x_percent: body.x_percent,
    y_percent: body.y_percent,
    selector: body.selector || null,
    note: body.note,
    resolved: false,
    resolved_at: null,
    hidden: false,
    hidden_at: null,
    created_at: FieldValue.serverTimestamp(),
    screenshotDataUrl: body.screenshot_base64 || null,
  };
  const pinRef = await db.collection('feedbackPins').add(pinData);

  const preview = safeHttpUrl(project.preview_url);
  const viewLink = preview ? `${preview}#dal-pin-${pinRef.id}` : pinData.page_url;
  const html = `
    <p><strong>Client:</strong> ${escHtml(body.client_name || 'Anonymous')}</p>
    <p><strong>Note:</strong> ${escHtml(body.note)}</p>
    <p><strong>Page:</strong> <a href="${escHtml(pinData.page_url)}">${escHtml(pinData.page_url)}</a></p>
    <p><a href="${escHtml(viewLink)}" style="background:#4CC1F3;color:#000;padding:8px 16px;border-radius:6px;text-decoration:none;font-weight:bold;">View on page →</a></p>
    ${body.screenshot_base64 ? '<p>A screenshot is attached to this note in Mission Control.</p>' : ''}
  `;
  await sendMailgun(labInbox(), `📍 New feedback — ${String(project.project_name || body.project_id).slice(0, 120)}`, html);

  const pinSnap = await pinRef.get();
  return res.status(200).json({ ok: true, pin: publicPin(pinSnap, body.session_id) });
}

async function handleGetPins(req, res) {
  const projectId = typeof req.query.project_id === 'string' ? req.query.project_id : '';
  const sessionId = typeof req.query.session_id === 'string' ? req.query.session_id.slice(0, 64) : '';
  if (!ID_RE.test(projectId)) throw new HttpError(400, 'Missing project_id');

  const snap = await getMcDb().collection('feedbackPins').where('project_id', '==', projectId).get();
  const ms = (t) => (t && typeof t.toDate === 'function' ? t.toDate().getTime() : new Date(t || 0).getTime());
  const pins = snap.docs
    .filter((d) => !d.data().hidden)
    .sort((a, b) => ms(a.data().created_at) - ms(b.data().created_at))
    .map((d) => publicPin(d, sessionId));
  return res.status(200).json({ ok: true, pins });
}

async function handleResolve(req, res) {
  const caller = await feedbackAdmin(req);
  const { pin_id, resolved } = validate(ResolveSchema, parseJsonBody(req));
  const { ref } = await loadPinForAdmin(getMcDb(), pin_id, caller);
  await ref.update({ resolved, resolved_at: resolved ? new Date().toISOString() : null });
  const snap = await ref.get();
  return res.status(200).json({ ok: true, pin: publicPin(snap) });
}

async function handleReply(req, res) {
  const caller = await feedbackAdmin(req);
  const { pin_id, reply_text } = validate(ReplySchema, parseJsonBody(req));
  const db = getMcDb();
  const { ref, snap: pinSnap } = await loadPinForAdmin(db, pin_id, caller);
  const pin = pinSnap.data();
  const reply_at = new Date().toISOString();
  await ref.update({ reply_text, reply_at });

  if (pin.client_email) {
    let projectName = pin.project_id;
    let preview = safeHttpUrl(pin.page_url);
    try {
      const projSnap = await db.collection('webProjects').doc(pin.project_id).get();
      if (projSnap.exists) {
        projectName = projSnap.data().project_name || projectName;
        preview = safeHttpUrl(projSnap.data().preview_url) || preview;
      }
    } catch (_) { /* best effort */ }
    const viewLink = preview ? `${preview}#dal-pin-${pin_id}` : '';
    const html = `
      <p>Hi ${escHtml(pin.client_name || 'there')},</p>
      <p>Eddie from Dream App Lab replied to your feedback note:</p>
      <blockquote style="border-left:3px solid #4CC1F3;padding-left:12px;color:#555;">${escHtml(pin.note)}</blockquote>
      <p><strong>Reply:</strong> ${escHtml(reply_text)}</p>
      ${viewLink ? `<p>You can view your feedback at <a href="${escHtml(viewLink)}">${escHtml(viewLink)}</a>.</p>` : ''}
      <p>— Dream App Lab</p>
    `;
    await sendMailgun(pin.client_email, `Re: Your feedback on ${String(projectName).slice(0, 120)}`, html);
  }
  return res.status(200).json({ ok: true, reply_at });
}

async function handleHide(req, res) {
  const caller = await feedbackAdmin(req);
  const { pin_id, hidden } = validate(HideSchema, parseJsonBody(req));
  const { ref } = await loadPinForAdmin(getMcDb(), pin_id, caller);
  await ref.update({ hidden, hidden_at: hidden ? new Date().toISOString() : null });
  const snap = await ref.get();
  return res.status(200).json({ ok: true, pin: publicPin(snap) });
}

async function handleHideAll(req, res) {
  const caller = await feedbackAdmin(req);
  const { project_id } = validate(HideAllSchema, parseJsonBody(req));
  if (caller.projectId && caller.projectId !== project_id) throw new HttpError(403, 'Not allowed for this project');
  const db = getMcDb();
  const snap = await db.collection('feedbackPins').where('project_id', '==', project_id).get();
  const now = new Date().toISOString();
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db.batch();
    snap.docs.slice(i, i + 400).forEach((d) => batch.update(d.ref, { hidden: true, hidden_at: now }));
    await batch.commit();
  }
  await writeAudit({ type: 'delete', actor: caller.actor, target: `webProjects/${project_id}/feedbackPins`, meta: { action: 'hide-all', count: snap.size } }, req);
  return res.status(200).json({ ok: true, count: snap.size });
}

async function handleAdminLink(req, res) {
  const decoded = await verifyAdmin(req); // Firebase admin only — widget tokens cannot mint tokens
  const { project_id } = validate(AdminLinkSchema, parseJsonBody(req));
  const projSnap = await getMcDb().collection('webProjects').doc(project_id).get();
  if (!projSnap.exists) throw new HttpError(404, 'Project not found');
  const preview = safeHttpUrl(projSnap.data().preview_url);
  if (!preview) throw new HttpError(400, 'Set a preview URL on this project first');
  const token = signWidgetToken(project_id);
  const url = `${preview.split('#')[0]}#dal_admin_token=${encodeURIComponent(token)}`;
  void decoded;
  return res.status(200).json({ ok: true, url, expiresInSeconds: WIDGET_TOKEN_TTL_SECONDS });
}

const ROUTES = {
  'POST /pin': handlePostPin,
  'GET /pins': handleGetPins,
  'POST /resolve': handleResolve,
  'POST /reply': handleReply,
  'POST /hide': handleHide,
  'POST /hide-all': handleHideAll,
  'POST /admin-link': handleAdminLink,
};

async function router(req, res) {
  const path = String(req.url || '').split('?')[0];
  // Works for both /api/feedback/pin (rewrite) and direct invocations.
  const sub = '/' + (path.split('/').filter(Boolean).pop() || '');
  const fn = ROUTES[`${req.method} ${sub}`];
  if (!fn) return res.status(404).json({ error: 'Not found' });
  return fn(req, res);
}

// Per-route auth happens inside the handlers above (public vs admin vs widget token).
module.exports = withSecurity(
  { name: 'feedback', methods: ['GET', 'POST'], auth: 'public', cors: corsForFeedback, rateLimit: { limit: 120, windowMs: 60_000 } },
  router
);
module.exports.__test = { signWidgetToken, verifyWidgetToken, publicPin, PinSchema, escHtml, resetOriginCache: () => { originCache = { at: 0, origins: new Set() }; } };
