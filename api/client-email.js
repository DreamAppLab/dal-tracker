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
    const { FormData, Blob } = await import('node-fetch');
    const formData = new FormData();
    formData.append('from', MAILGUN_FROM);
    formData.append('to', to);
    formData.append('subject', subject);
    formData.append('text', body);
    formData.append('h:Reply-To', 'clients@inbound.dreamapplab.com');

    const attachment = files.attachment?.[0];
    if (attachment) {
      const fileBuffer = fs.readFileSync(attachment.filepath);
      const blob = new Blob([fileBuffer], { type: attachment.mimetype || 'application/octet-stream' });
      formData.append('attachment', blob, attachment.originalFilename || 'attachment');
    }

    const mgRes = await fetch(
      `https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from('api:' + MAILGUN_API_KEY).toString('base64'),
        },
        body: formData,
      }
    );

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
    await adminDb.collection('clientEmails').add({
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

    if (attachment) {
      try { fs.unlinkSync(attachment.filepath); } catch (_) {}
    }

    return res.status(200).json({ ok: true, threadId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
