/*
  MAILGUN INBOUND ROUTING SETUP REQUIRED:
  
  In Mailgun dashboard → Receiving → Create Route:
  - Filter: match_recipient("lab@inbound.dreamapplab.com")
  - Action: forward("https://dal-tracker.vercel.app/api/inbound-client-email")
  - Priority: 10
  - Description: "Mission Control client email replies"
  
  This route catches client replies and threads them back into
  Mission Control under the correct project or contact.
  
  Required Vercel env vars (dal-tracker):
  - FIREBASE_PROJECT_ID
  - FIREBASE_CLIENT_EMAIL  
  - FIREBASE_PRIVATE_KEY
  - MAILGUN_API_KEY
*/

// clientEmails collection schema:
// { clientId, projectId, source, threadId, subject, body, bodyFull, to, sentAt, direction, read, parentId }
// For inbound replies, `body` is the reply only (Mailgun stripped-text when available)
// and `bodyFull` keeps the complete raw email text for reference.

import { FieldValue } from 'firebase-admin/firestore';
import security from './_lib/security';
import firebaseAdmin from './_lib/firebaseAdmin';
import mailgunWebhook from './_lib/mailgunWebhook';

const { withSecurity } = security;
const { getMcDb } = firebaseAdmin;
const { verifyMailgunRequest } = mailgunWebhook;

const clip = (v, n) => String(v || '').slice(0, n);

async function handler(req, res) {
  if (!req.body || typeof req.body !== 'object' || !(await verifyMailgunRequest(req.body))) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  try {
    // Mailgun sends multipart/form-data for inbound emails
    // Key fields: sender, recipient, subject, body-plain, In-Reply-To, Message-Id
    const sender = req.body['sender'] || req.body['from'] || '';
    const subject = req.body['subject'] || '';
    // Prefer Mailgun's stripped-text (the reply only, without the quoted thread or
    // signature). Mission Control also strips quoted history when displaying, so
    // older messages and replies without stripped-text read cleanly too
    // (see src/lib/emailReply.js).
    const fullText = req.body['body-plain'] || req.body['stripped-text'] || '';
    const bodyText = req.body['stripped-text'] || fullText;
    const inReplyTo = req.body['In-Reply-To'] || req.body['in-reply-to'] || '';
    const messageId = req.body['Message-Id'] || req.body['message-id'] || '';

    if (!inReplyTo && !messageId) {
      return res.status(200).json({ ok: true, note: 'No thread ID found, ignored' });
    }

    const adminDb = getMcDb();

    // Find the original email by threadId matching inReplyTo
    const threadIdToMatch = inReplyTo.trim();
    const originalQuery = await adminDb
      .collection('clientEmails')
      .where('threadId', '==', threadIdToMatch)
      .limit(1)
      .get();

    if (originalQuery.empty) {
      // Try matching without angle brackets
      const cleaned = threadIdToMatch.replace(/[<>]/g, '');
      const retryQuery = await adminDb
        .collection('clientEmails')
        .where('threadId', '==', cleaned)
        .limit(1)
        .get();

      if (retryQuery.empty) {
        return res.status(200).json({ ok: true, note: 'No matching thread found, ignored' });
      }

      const original = retryQuery.docs[0].data();
      await saveReply(adminDb, FieldValue, original, retryQuery.docs[0].id, sender, subject, bodyText, fullText, messageId);
      return res.status(200).json({ ok: true });
    }

    const original = originalQuery.docs[0].data();
    await saveReply(adminDb, FieldValue, original, originalQuery.docs[0].id, sender, subject, bodyText, fullText, messageId);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('inbound-client-email error:', err && err.message);
    return res.status(500).json({ error: 'Inbound processing failed' });
  }
}

// Server-to-server (Mailgun route): no CORS; authenticity = Mailgun signature.
export default withSecurity(
  { name: 'inbound-client-email', methods: ['POST'], auth: 'public', cors: 'none', rateLimit: { limit: 60, windowMs: 60_000 } },
  handler
);

async function saveReply(adminDb, FieldValue, original, parentId, sender, subject, bodyText, fullText, messageId) {
  await adminDb.collection('clientEmails').add({
    clientId: original.clientId,
    projectId: original.projectId || null,
    source: original.source,
    threadId: clip(messageId, 500),
    subject: clip(subject, 500),
    body: clip(bodyText, 100_000),
    bodyFull: clip(fullText, 300_000),
    to: clip(sender, 320),
    sentAt: FieldValue.serverTimestamp(),
    direction: 'inbound',
    read: false,
    parentId: parentId,
  });
}
