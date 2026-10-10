// DAL Feedback API — backed by Firebase/Firestore (dal-mission-control)
// POST /api/feedback/pin      – submit a new feedback pin
// GET  /api/feedback/pins     – get pins for a project
// POST /api/feedback/resolve  – resolve or reopen a pin

const { initializeApp, getApp } = require('firebase-admin/app');
const { cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || 'inbound.dreamapplab.com';
const MAILGUN_FROM = process.env.MAILGUN_FROM || 'Dream App Lab <lab@inbound.dreamapplab.com>';

// ── Firebase Admin (dal-mission-control) ────────────────────────────────────
let _mcDb = null;

function getMcDb() {
  if (_mcDb) return _mcDb;

  const projectId = process.env.DAL_MC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.DAL_MC_FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.DAL_MC_FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing DAL_MC_FIREBASE env vars');
  }

  const appName = 'dalMcFeedback';
  let app;
  try {
    app = getApp(appName);
  } catch (_) {
    app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) }, appName);
  }
  _mcDb = getFirestore(app);
  return _mcDb;
}

// ── CORS ─────────────────────────────────────────────────────────────────────
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── Mailgun ───────────────────────────────────────────────────────────────────
async function sendFeedbackEmail({ project_name, preview_url, client_name, note, page_url, pin_id, screenshot_data_url }) {
  if (!MAILGUN_API_KEY) return;
  const viewLink = preview_url ? `${preview_url}#dal-pin-${pin_id}` : page_url;
  const screenshotHtml = screenshot_data_url
    ? `<p><img src="${screenshot_data_url}" alt="Screenshot" style="max-width:400px;border-radius:8px;" /></p>`
    : '';
  const html = `
    <p><strong>Client:</strong> ${client_name || 'Anonymous'}</p>
    <p><strong>Note:</strong> ${note}</p>
    <p><strong>Page:</strong> <a href="${page_url}">${page_url}</a></p>
    <p><a href="${viewLink}" style="background:#4CC1F3;color:#000;padding:8px 16px;border-radius:6px;text-decoration:none;font-weight:bold;">View on page →</a></p>
    ${screenshotHtml}
  `;
  const params = new URLSearchParams();
  params.append('from', MAILGUN_FROM);
  params.append('to', 'lab@dreamapplab.com');
  params.append('subject', `📍 New feedback — ${project_name}`);
  params.append('html', html);
  try {
    await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from('api:' + MAILGUN_API_KEY).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
  } catch (e) {
    console.error('Mailgun error:', e.message);
  }
}

// ── Serialize Firestore doc ───────────────────────────────────────────────────
function serializeDoc(doc) {
  const data = doc.data();
  const result = { id: doc.id };
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v.toDate === 'function') {
      result[k] = v.toDate().toISOString();
    } else {
      result[k] = v;
    }
  }
  return result;
}

// ── POST /api/feedback/pin ───────────────────────────────────────────────────
async function handlePostPin(req, res) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const {
    project_id, session_id, client_name, client_email,
    page_url, page_title, x_percent, y_percent, selector, note,
    screenshot_base64,
  } = body || {};

  if (!project_id || !session_id || !page_url || !note) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const db = getMcDb();

  // Validate project exists
  const projectDoc = await db.collection('webProjects').doc(project_id).get();
  if (!projectDoc.exists) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const project = projectDoc.data();

  // Build pin data
  const pinData = {
    project_id,
    session_id,
    client_name: client_name || null,
    client_email: client_email || null,
    page_url,
    page_title: page_title || null,
    x_percent,
    y_percent,
    selector: selector || null,
    note,
    resolved: false,
    resolved_at: null,
    created_at: FieldValue.serverTimestamp(),
    screenshotDataUrl: screenshot_base64 || null,
  };

  const pinRef = await db.collection('feedbackPins').add(pinData);

  // Send email
  await sendFeedbackEmail({
    project_name: project.project_name,
    preview_url: project.preview_url,
    client_name,
    note,
    page_url,
    pin_id: pinRef.id,
    screenshot_data_url: screenshot_base64 || null,
  });

  const pinSnap = await pinRef.get();
  return res.status(200).json({ ok: true, pin: serializeDoc(pinSnap) });
}

// ── GET /api/feedback/pins ───────────────────────────────────────────────────
async function handleGetPins(req, res) {
  const { project_id, session_id } = req.query;
  if (!project_id) return res.status(400).json({ error: 'Missing project_id' });

  const db = getMcDb();
  // No composite index required — sort in-memory after fetch
  const snap = await db.collection('feedbackPins')
    .where('project_id', '==', project_id)
    .get();

  const sorted = snap.docs.slice().sort((a, b) => {
    const ta = a.data().created_at;
    const tb = b.data().created_at;
    const getMs = (t) => t && typeof t.toDate === 'function' ? t.toDate().getTime() : new Date(t || 0).getTime();
    return getMs(ta) - getMs(tb);
  });
  const pins = sorted.map((doc) => {
    const p = serializeDoc(doc);
    // Strip session_id from response unless it matches the requester
    const isOwn = session_id && p.session_id === session_id;
    if (!isOwn) delete p.session_id;
    // Never expose full screenshotDataUrl in list (can be large); just flag presence
    const hasScreenshot = !!p.screenshotDataUrl;
    // Keep screenshotDataUrl for own pins or if it's small enough (< 50kb)
    if (p.screenshotDataUrl && p.screenshotDataUrl.length > 100000) {
      p.screenshotDataUrl = null;
    }
    p.hasScreenshot = hasScreenshot;
    return p;
  });

  return res.status(200).json({ ok: true, pins });
}

// ── POST /api/feedback/resolve ───────────────────────────────────────────────
async function handleResolve(req, res) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { pin_id, resolved } = body || {};
  if (!pin_id || resolved === undefined) return res.status(400).json({ error: 'Missing pin_id or resolved' });

  const db = getMcDb();
  const ref = db.collection('feedbackPins').doc(pin_id);
  await ref.update({
    resolved: !!resolved,
    resolved_at: resolved ? new Date().toISOString() : null,
  });
  const snap = await ref.get();
  return res.status(200).json({ ok: true, pin: serializeDoc(snap) });
}

// ── POST /api/feedback/reply ─────────────────────────────────────────────────
async function handleReply(req, res) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { pin_id, reply_text } = body || {};
  if (!pin_id || !reply_text) return res.status(400).json({ error: 'Missing pin_id or reply_text' });

  const db = getMcDb();
  const ref = db.collection('feedbackPins').doc(pin_id);
  const pinSnap = await ref.get();
  if (!pinSnap.exists) return res.status(404).json({ error: 'Pin not found' });
  const pin = pinSnap.data();

  const reply_at = new Date().toISOString();
  await ref.update({ reply_text, reply_at });

  // Send email to client if they have an email on the pin
  const client_email = pin.client_email;
  if (client_email && MAILGUN_API_KEY) {
    // Fetch project for name + preview_url
    let project_name = pin.project_id;
    let preview_url = pin.page_url;
    try {
      const projSnap = await db.collection('webProjects').doc(pin.project_id).get();
      if (projSnap.exists) {
        project_name = projSnap.data().project_name || project_name;
        preview_url = projSnap.data().preview_url || preview_url;
      }
    } catch (_) {}

    const viewLink = preview_url ? `${preview_url}#dal-pin-${pin_id}` : pin.page_url;
    const html = `
      <p>Hi ${pin.client_name || 'there'},</p>
      <p>Eddie from Dream App Lab replied to your feedback note:</p>
      <blockquote style="border-left:3px solid #4CC1F3;padding-left:12px;color:#555;">${pin.note}</blockquote>
      <p><strong>Reply:</strong> ${reply_text}</p>
      <p>You can view your feedback at <a href="${viewLink}">${viewLink}</a>.</p>
      <p>— Dream App Lab</p>
    `;
    const params = new URLSearchParams();
    params.append('from', MAILGUN_FROM);
    params.append('to', client_email);
    params.append('subject', `Re: Your feedback on ${project_name}`);
    params.append('html', html);
    try {
      await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from('api:' + MAILGUN_API_KEY).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
    } catch (e) {
      console.error('Mailgun reply error:', e.message);
    }
  }

  return res.status(200).json({ ok: true, reply_at });
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = req.url || '';
  const path = url.split('?')[0];

  try {
    if (path.endsWith('/pin') && req.method === 'POST') return await handlePostPin(req, res);
    if (path.endsWith('/pins') && req.method === 'GET') return await handleGetPins(req, res);
    if (path.endsWith('/resolve') && req.method === 'POST') return await handleResolve(req, res);
    if (path.endsWith('/reply') && req.method === 'POST') return await handleReply(req, res);
    return res.status(404).json({ error: 'Not found' });
  } catch (e) {
    console.error('feedback api error:', e);
    return res.status(500).json({ error: e.message });
  }
};
