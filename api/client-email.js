import formidable from 'formidable';
import fs from 'fs';
import path from 'path';

export const config = { api: { bodyParser: false } };

const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
const MAILGUN_DOMAIN = 'inbound.dreamapplab.com';
const MAILGUN_FROM = 'Dream App Lab <lab@inbound.dreamapplab.com>';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const form = formidable({ maxFileSize: 10 * 1024 * 1024 });
  let fields, files;
  try {
    [fields, files] = await form.parse(req);
  } catch (err) {
    return res.status(400).json({ error: 'Failed to parse form: ' + err.message });
  }

  const to = Array.isArray(fields.to) ? fields.to[0] : fields.to;
  const clientId = Array.isArray(fields.clientId) ? fields.clientId[0] : fields.clientId;
  const subject = Array.isArray(fields.subject) ? fields.subject[0] : fields.subject;
  const body = Array.isArray(fields.body) ? fields.body[0] : fields.body;
  const source = Array.isArray(fields.source) ? fields.source[0] : (fields.source || 'contact');
  const projectId = Array.isArray(fields.projectId) ? fields.projectId[0] : fields.projectId;

  if (!to || !clientId || !subject || !body) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const attachment = files.attachment?.[0];
    let mgRes;
    if (!attachment) {
      // No attachment — use simple URLSearchParams (most reliable)
      const params = new URLSearchParams();
      params.append('from', MAILGUN_FROM);
      params.append('to', to);
      params.append('subject', subject);
      params.append('text', body);
      params.append('h:Reply-To', 'clients@inbound.dreamapplab.com');
      mgRes = await fetch(
        `https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: 'Basic ' + Buffer.from('api:' + MAILGUN_API_KEY).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        }
      );
    } else {
      // Has attachment — use native Node.js FormData (available in Node 18+)
      const fileBuffer = fs.readFileSync(attachment.filepath);

      // Build multipart manually using boundary
      const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);

      const addField = (name, value) =>
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;

      let bodyParts = '';
      bodyParts += addField('from', MAILGUN_FROM);
      bodyParts += addField('to', to);
      bodyParts += addField('subject', subject);
      bodyParts += addField('text', body);
      bodyParts += addField('h:Reply-To', 'clients@inbound.dreamapplab.com');

      const textBuffer = Buffer.from(bodyParts, 'utf-8');
      const fileHeader = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="attachment"; filename="${attachment.originalFilename || 'attachment'}"\r\nContent-Type: ${attachment.mimetype || 'application/octet-stream'}\r\n\r\n`,
        'utf-8'
      );
      const closingBuffer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');

      const multipartBody = Buffer.concat([textBuffer, fileHeader, fileBuffer, closingBuffer]);

      mgRes = await fetch(
        `https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: 'Basic ' + Buffer.from('api:' + MAILGUN_API_KEY).toString('base64'),
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': multipartBody.length,
          },
          body: multipartBody,
        }
      );
    }
    if (!mgRes.ok) {
      const err = await mgRes.text();
      return res.status(500).json({ error: err });
    }
    const mgData = await mgRes.json();
    const threadId = mgData.id || '';
    const { initializeApp, getApps, cert } = await import('firebase-admin/app');
    const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
    if (!getApps().length) {
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
      });
    }
    const adminDb = getFirestore();
    const attachment2 = files.attachment?.[0];
    await adminDb.collection('clientEmails').add({
      clientId,
      projectId: projectId || null,
      source: source || 'contact',
      threadId,
      subject,
      body,
      to,
      hasAttachment: !!attachment2,
      attachmentName: attachment2?.originalFilename || null,
      sentAt: FieldValue.serverTimestamp(),
      direction: 'outbound',
      read: true,
      parentId: null,
    });
    if (attachment2) {
      try { fs.unlinkSync(attachment2.filepath); } catch (_) {}
    }
    return res.status(200).json({ ok: true, threadId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
