// clientEmails collection schema:
// { clientId, projectId, source, threadId, subject, body, to, sentAt, sentBy, direction, read, parentId }

const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
const MAILGUN_DOMAIN = 'inbound.dreamapplab.com';
const MAILGUN_FROM = 'Dream App Lab <lab@inbound.dreamapplab.com>';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { to, clientId, subject, body, source, projectId } = req.body;

  if (!to || !clientId || !subject || !body) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Send via Mailgun
    const params = new URLSearchParams();
    params.append('from', MAILGUN_FROM);
    params.append('to', to);
    params.append('subject', subject);
    params.append('text', body);
    params.append('h:Reply-To', 'lab@inbound.dreamapplab.com');

    const mgRes = await fetch(
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

    if (!mgRes.ok) {
      const err = await mgRes.text();
      return res.status(500).json({ error: err });
    }

    const mgData = await mgRes.json();
    const threadId = mgData.id || '';

    // Save to Firestore via firebase-admin
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
      sentAt: FieldValue.serverTimestamp(),
      direction: 'outbound',
      read: true,
      parentId: null,
    });

    return res.status(200).json({ ok: true, threadId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
