// DAL Feedback API
// POST /api/feedback/pin      – submit a new feedback pin
// GET  /api/feedback/pins     – get pins for a project
// POST /api/feedback/resolve  – resolve or reopen a pin

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_FEEDBACK_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_FEEDBACK_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_FEEDBACK_SERVICE_KEY;
const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || 'inbound.dreamapplab.com';
const MAILGUN_FROM = process.env.MAILGUN_FROM || 'Dream App Lab <lab@inbound.dreamapplab.com>';

function getAnonClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

function getServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function sendFeedbackEmail({ project_name, preview_url, client_name, note, page_url, pin_id, screenshot_url }) {
  if (!MAILGUN_API_KEY) return;
  const viewLink = preview_url ? `${preview_url}#dal-pin-${pin_id}` : page_url;
  const screenshotHtml = screenshot_url
    ? `<p><img src="${screenshot_url}" alt="Screenshot" style="max-width:400px;border-radius:8px;" /></p>`
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

  const supabase = getAnonClient();

  // Validate project exists
  const { data: project, error: projErr } = await supabase
    .from('web_projects')
    .select('project_id, project_name, preview_url')
    .eq('project_id', project_id)
    .single();

  if (projErr || !project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // Insert pin first to get ID
  const { data: pin, error: pinErr } = await supabase
    .from('feedback_pins')
    .insert({
      project_id,
      session_id,
      client_name,
      client_email,
      page_url,
      page_title,
      x_percent,
      y_percent,
      selector,
      note,
    })
    .select()
    .single();

  if (pinErr || !pin) {
    return res.status(500).json({ error: pinErr?.message || 'Failed to insert pin' });
  }

  let screenshot_url = null;

  // Upload screenshot if provided
  if (screenshot_base64) {
    try {
      const base64Data = screenshot_base64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const storagePath = `${project_id}/${pin.id}.png`;

      const serviceClient = getServiceClient();
      const { error: uploadErr } = await serviceClient.storage
        .from('feedback-screenshots')
        .upload(storagePath, buffer, { contentType: 'image/png', upsert: true });

      if (!uploadErr) {
        const { data: urlData } = serviceClient.storage
          .from('feedback-screenshots')
          .getPublicUrl(storagePath);
        screenshot_url = urlData?.publicUrl || null;

        // Save screenshot record
        await serviceClient.from('feedback_screenshots').insert({
          pin_id: pin.id,
          storage_path: storagePath,
        });

        // Update pin with screenshot_url
        await serviceClient.from('feedback_pins').update({ screenshot_url }).eq('id', pin.id);
      }
    } catch (e) {
      console.error('Screenshot upload error:', e.message);
    }
  }

  // Send email notification
  await sendFeedbackEmail({
    project_name: project.project_name,
    preview_url: project.preview_url,
    client_name,
    note,
    page_url,
    pin_id: pin.id,
    screenshot_url,
  });

  return res.status(200).json({ ok: true, pin: { ...pin, screenshot_url } });
}

async function handleGetPins(req, res) {
  const { project_id, session_id } = req.query;
  if (!project_id) return res.status(400).json({ error: 'Missing project_id' });

  const supabase = getAnonClient();
  const { data: pins, error } = await supabase
    .from('feedback_pins')
    .select('id, x_percent, y_percent, resolved, resolved_at, note, client_name, created_at, session_id, page_url, screenshot_url')
    .eq('project_id', project_id)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  // Only include full details if session_id matches
  const result = (pins || []).map((p) => {
    if (session_id && p.session_id === session_id) return p;
    const { session_id: _s, ...rest } = p;
    return rest;
  });

  return res.status(200).json({ ok: true, pins: result });
}

async function handleResolve(req, res) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { pin_id, resolved } = body || {};
  if (!pin_id || resolved === undefined) return res.status(400).json({ error: 'Missing pin_id or resolved' });

  const serviceClient = getServiceClient();
  const { data: pin, error } = await serviceClient
    .from('feedback_pins')
    .update({ resolved: !!resolved, resolved_at: resolved ? new Date().toISOString() : null })
    .eq('id', pin_id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true, pin });
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = req.url || '';
  const path = url.split('?')[0];

  if (path.endsWith('/pin') && req.method === 'POST') return handlePostPin(req, res);
  if (path.endsWith('/pins') && req.method === 'GET') return handleGetPins(req, res);
  if (path.endsWith('/resolve') && req.method === 'POST') return handleResolve(req, res);

  return res.status(404).json({ error: 'Not found' });
};
