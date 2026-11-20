import formidable from 'formidable';
import fs from 'fs';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { getDownloadURL } from 'firebase-admin/storage';
import security from './_lib/security';
import firebaseAdmin from './_lib/firebaseAdmin';

const { withSecurity, validate } = security;
const { getMcDb, getMcBucket } = firebaseAdmin;

export const config = { api: { bodyParser: false } };

const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
const MAILGUN_DOMAIN = 'inbound.dreamapplab.com';
const MAILGUN_FROM = 'Dream App Lab <lab@inbound.dreamapplab.com>';

const ID = z.string().trim().regex(/^[A-Za-z0-9_-]{1,128}$/);
const EmailSchema = z.object({
  to: z.string().trim().email().max(254),
  clientId: ID,
  subject: z.string().trim().min(1).max(300),
  body: z.string().min(1).max(200_000),
  source: z.enum(['contact', 'project', 'client', 'quote']).catch('contact'),
  projectId: ID.optional().nullable(),
});

async function handler(req, res) {
  const form = formidable({ maxFileSize: 10 * 1024 * 1024 });
  let fields, files;
  try {
    [fields, files] = await form.parse(req);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid upload' });
  }

  const first = (v) => (Array.isArray(v) ? v[0] : v);
  const { to, clientId, subject, body, source, projectId } = validate(EmailSchema, {
    to: first(fields.to),
    clientId: first(fields.clientId),
    subject: first(fields.subject),
    body: first(fields.body),
    source: first(fields.source) || 'contact',
    projectId: first(fields.projectId) || null,
  });

  try {
    const attachment = files.attachment?.[0];
    let fileBuffer = null;
    if (attachment) {
      fileBuffer = fs.readFileSync(attachment.filepath);
    }

    let mgRes;
    if (!attachment) {
      const params = new URLSearchParams();
      params.append('from', MAILGUN_FROM);
      params.append('to', to);
      params.append('subject', subject);
      params.append('html', body);
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
      const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);

      const addField = (name, value) =>
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;

      let bodyParts = '';
      bodyParts += addField('from', MAILGUN_FROM);
      bodyParts += addField('to', to);
      bodyParts += addField('subject', subject);
      bodyParts += addField('html', body);
      bodyParts += addField('h:Reply-To', 'clients@inbound.dreamapplab.com');

      const textBuffer = Buffer.from(bodyParts, 'utf-8');
      const fileHeader = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="attachment"; filename="${String(attachment.originalFilename || 'attachment').replace(/[\\/\r\n"]/g, '_')}"\r\nContent-Type: ${attachment.mimetype || 'application/octet-stream'}\r\n\r\n`,
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
      console.error('client-email mailgun error', mgRes.status);
      return res.status(502).json({ error: 'Email send failed' });
    }

    const mgData = await mgRes.json();
    const threadId = mgData.id || '';

    const adminDb = getMcDb();
    const emailRef = await adminDb.collection('clientEmails').add({
      clientId,
      projectId: projectId || null,
      source: source || 'contact',
      threadId,
      subject,
      body,
      to,
      hasAttachment: !!attachment,
      attachmentName: attachment?.originalFilename || null,
      sentAt: FieldValue.serverTimestamp(),
      direction: 'outbound',
      read: true,
      parentId: null,
    });

    if (attachment && fileBuffer) {
      const attachmentName = String(attachment.originalFilename || 'attachment').replace(/[\\/\r\n"]/g, '_').slice(0, 200);
      const storagePath = `clientAttachments/${clientId}/${emailRef.id}/${attachmentName}`;
      const file = getMcBucket().file(storagePath);
      await file.save(fileBuffer, {
        contentType: attachment.mimetype || 'application/octet-stream',
        resumable: false,
      });
      const attachmentUrl = await getDownloadURL(file);
      await emailRef.update({ attachmentUrl });
    }

    if (attachment) {
      try { fs.unlinkSync(attachment.filepath); } catch (_) {}
    }

    return res.status(200).json({ ok: true, threadId });
  } catch (err) {
    console.error('client-email error:', err && err.message);
    return res.status(500).json({ error: 'Email send failed' });
  }
}

export default withSecurity({ name: 'client-email', methods: ['POST'], auth: 'admin', rateLimit: { limit: 30, windowMs: 60_000 } }, handler);
