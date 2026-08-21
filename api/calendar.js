const { google } = require('googleapis');

const CALENDAR_ID = 'lab@dreamapplab.com';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';

function setCors(req, res) {
  const origin = String(req.headers.origin || '');
  const allowed =
    origin === 'https://dal-tracker.vercel.app' ||
    /^https:\/\/dal-tracker[a-z0-9-]*\.vercel\.app$/i.test(origin);
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : 'https://dal-tracker.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function getCalendarClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not configured');
  }
  const credentials = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (credentials.private_key) {
    credentials.private_key = String(credentials.private_key).replace(/\\n/g, '\n');
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [CALENDAR_SCOPE],
  });
  return google.calendar({ version: 'v3', auth });
}

function eventSummary(appName, label) {
  return `${appName || ''} — ${label || ''}`.replace(/^\s*—\s*/, '').trim();
}

function completedSummary(appName, label) {
  const base = eventSummary(appName, label);
  return base.startsWith('✅') ? base : `✅ ${base}`;
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const action = body.action;
    const calendar = getCalendarClient();

    if (action === 'create') {
      const { appName, label, dueDate, tasks } = body;
      if (!dueDate) {
        return res.status(400).json({ error: 'dueDate is required' });
      }
      const taskLines = Array.isArray(tasks)
        ? tasks.map((t) => (typeof t === 'string' ? t : t?.label)).filter(Boolean)
        : [];
      const event = await calendar.events.insert({
        calendarId: CALENDAR_ID,
        requestBody: {
          summary: eventSummary(appName, label),
          description: taskLines.join('\n'),
          start: { date: dueDate },
          end: { date: dueDate },
          colorId: '5',
        },
      });
      return res.status(200).json({ calendarEventId: event.data.id });
    }

    if (action === 'update') {
      const { calendarEventId, appName, label } = body;
      if (!calendarEventId) {
        return res.status(400).json({ error: 'calendarEventId is required' });
      }
      await calendar.events.patch({
        calendarId: CALENDAR_ID,
        eventId: calendarEventId,
        requestBody: {
          summary: completedSummary(appName, label),
        },
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'delete') {
      const { calendarEventId } = body;
      if (!calendarEventId) {
        return res.status(400).json({ error: 'calendarEventId is required' });
      }
      await calendar.events.delete({
        calendarId: CALENDAR_ID,
        eventId: calendarEventId,
      });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Calendar request failed' });
  }
};
