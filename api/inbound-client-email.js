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
// { clientId, projectId, source, threadId, subject, body, to, sentAt, direction, read, parentId }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    // Mailgun sends multipart/form-data for inbound emails
    // Key fields: sender, recipient, subject, body-plain, In-Reply-To, Message-Id
    const sender = req.body['sender'] || req.body['from'] || '';
    const subject = req.body['subject'] || '';
    const bodyText = req.body['body-plain'] || req.body['stripped-text'] || '';
    const inReplyTo = req.body['In-Reply-To'] || req.body['in-reply-to'] || '';
    const messageId = req.body['Message-Id'] || req.body['message-id'] || '';

    if (!inReplyTo && !messageId) {
      return res.status(200).json({ ok: true, note: 'No thread ID found, ignored' });
    }

    // Initialize Firebase Admin
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
      await saveReply(adminDb, FieldValue, original, retryQuery.docs[0].id, sender, subject, bodyText, messageId);
      return res.status(200).json({ ok: true });
    }

    const original = originalQuery.docs[0].data();
    await saveReply(adminDb, FieldValue, original, originalQuery.docs[0].id, sender, subject, bodyText, messageId);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('inbound-client-email error:', err);
    return res.status(500).json({ error: err.message });
  }
}

async function saveReply(adminDb, FieldValue, original, parentId, sender, subject, bodyText, messageId) {
  await adminDb.collection('clientEmails').add({
    clientId: original.clientId,
    projectId: original.projectId || null,
    source: original.source,
    threadId: messageId,
    subject: subject,
    body: bodyText,
    to: sender,
    sentAt: FieldValue.serverTimestamp(),
    direction: 'inbound',
    read: false,
    parentId: parentId,
  });
}
