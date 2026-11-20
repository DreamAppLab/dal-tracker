const { google } = require('googleapis');

const CALENDAR_ID = 'lab@dreamapplab.com';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';

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

const { z } = require('zod');
const { withSecurity, parseJsonBody, validate } = require('./_lib/security');

const CalendarSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    appName: z.string().max(200).optional().nullable(),
    label: z.string().max(300).optional().nullable(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    tasks: z.array(z.union([z.string().max(500), z.object({ label: z.string().max(500).optional() }).passthrough()])).max(200).optional(),
  }).passthrough(),
  z.object({
    action: z.literal('update'),
    calendarEventId: z.string().regex(/^[A-Za-z0-9_-]{1,1024}$/),
    appName: z.string().max(200).optional().nullable(),
    label: z.string().max(300).optional().nullable(),
  }).passthrough(),
  z.object({
    action: z.literal('delete'),
    calendarEventId: z.string().regex(/^[A-Za-z0-9_-]{1,1024}$/),
  }).passthrough(),
]);

module.exports = withSecurity({ name: 'calendar', methods: ['POST'], auth: 'admin' }, async function handler(req, res) {
  try {
    const body = validate(CalendarSchema, parseJsonBody(req));
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
    if (err && err.expose) throw err;
    console.error('calendar error:', err && err.message);
    return res.status(502).json({ error: 'Calendar request failed' });
  }
});
