// Inbound client email (Mailgun route → /api/inbound-client-email).
//
// Every message that reaches Mission Control is:
//   1. filed in clientEmails — under the thread it replies to, or, if it
//      isn't a reply to a Mission Control email, under the contact whose
//      address sent it; and
//   2. copied to lab@dreamapplab.com, whether or not it could be filed, so
//      nothing that comes in is ever only in Mission Control (or lost).
//
// clientEmails schema:
// { clientId, projectId, source, threadId, subject, body, bodyFull, to, sentAt, direction, read, parentId }

const { FieldValue } = require('firebase-admin/firestore');
const { sendMail, labInbox, escHtml } = require('./mail');

const clip = (v, n) => String(v || '').slice(0, n);

function field(body, ...names) {
  for (const n of names) {
    const v = body[n];
    if (v != null && v !== '') return Array.isArray(v) ? String(v[0] || '') : String(v);
  }
  return '';
}

// "Jaclyn T <Jaclyn@Example.com>" → "jaclyn@example.com"
function emailAddress(raw) {
  const s = String(raw || '');
  const m = s.match(/<([^<>\s]+@[^<>\s]+)>/) || s.match(/([^\s<>"',;]+@[^\s<>"',;]+)/);
  return m ? m[1].trim().toLowerCase() : '';
}

function parseInbound(body) {
  const fullText = field(body, 'body-plain', 'stripped-text');
  return {
    sender: field(body, 'sender', 'from'),
    from: field(body, 'from', 'From', 'sender'),
    recipient: field(body, 'recipient', 'To', 'to'),
    subject: field(body, 'subject', 'Subject'),
    fullText,
    bodyText: field(body, 'stripped-text') || fullText,
    inReplyTo: field(body, 'In-Reply-To', 'in-reply-to').trim(),
    references: field(body, 'References', 'references'),
    messageId: field(body, 'Message-Id', 'message-id', 'Message-ID').trim(),
  };
}

async function findThreadOriginal(db, msg) {
  // In-Reply-To first, then every id in References (newest first).
  const ids = [];
  if (msg.inReplyTo) ids.push(msg.inReplyTo);
  (msg.references.match(/<[^<>]+>/g) || []).reverse().forEach((r) => ids.push(r));
  const tried = new Set();
  for (const raw of ids) {
    for (const id of [raw, raw.replace(/[<>]/g, '')]) {
      if (!id || tried.has(id)) continue;
      tried.add(id);
      const snap = await db.collection('clientEmails').where('threadId', '==', id).get();
      if (!snap.empty) return { id: snap.docs[0].id, data: snap.docs[0].data() };
    }
  }
  return null;
}

async function findClientByEmail(db, address) {
  if (!address) return null;
  const snap = await db.collection('clients').get();
  const doc = snap.docs.find((d) => String((d.data() || {}).email || '').trim().toLowerCase() === address);
  return doc ? { id: doc.id, data: doc.data() || {} } : null;
}

function copyHtml(msg, filedAs) {
  const text = msg.fullText || msg.bodyText || '(no text body)';
  return (
    `<p style="color:#555;font-size:13px;margin:0 0 4px">Received by Mission Control · ${escHtml(filedAs)}</p>` +
    `<p style="color:#555;font-size:13px;margin:0 0 12px"><strong>From:</strong> ${escHtml(msg.from || msg.sender)}` +
    (msg.recipient ? ` &nbsp; <strong>To:</strong> ${escHtml(msg.recipient)}` : '') +
    `</p><pre style="white-space:pre-wrap;font-family:inherit;font-size:14px;margin:0">${escHtml(text.slice(0, 200_000))}</pre>` +
    `<p style="color:#888;font-size:12px;margin-top:16px">Reply to this email to answer the sender directly, or reply from Mission Control to keep the thread there.</p>`
  );
}

/**
 * File one inbound message and copy it to the lab inbox.
 * Returns { filed: 'thread'|'contact'|null, copied: boolean }.
 * Throws only if saving to Firestore fails (so Mailgun retries).
 */
async function handleInbound(db, body, { send = sendMail } = {}) {
  const msg = parseInbound(body);
  const senderAddr = emailAddress(msg.sender || msg.from);

  let filed = null;
  let filedAs = 'not matched to a contact';
  let saveError = null;
  try {
    const original = await findThreadOriginal(db, msg);
    let record = null;
    if (original) {
      record = {
        clientId: original.data.clientId || null,
        projectId: original.data.projectId || null,
        source: original.data.source || 'contact',
        parentId: original.id,
      };
      filed = 'thread';
    } else {
      const client = await findClientByEmail(db, senderAddr);
      if (client) {
        record = { clientId: client.id, projectId: null, source: 'contact', parentId: null };
        filed = 'contact';
      }
    }
    if (record) {
      await db.collection('clientEmails').add({
        ...record,
        threadId: clip(msg.messageId, 500),
        subject: clip(msg.subject, 500),
        body: clip(msg.bodyText, 100_000),
        bodyFull: clip(msg.fullText, 300_000),
        to: clip(msg.sender || msg.from, 320),
        sentAt: FieldValue.serverTimestamp(),
        direction: 'inbound',
        read: false,
      });
      filedAs = filed === 'thread' ? 'filed in the email thread' : 'filed under the sender’s contact';
    }
  } catch (e) {
    saveError = e;
    filedAs = 'could not be filed (Mission Control error)';
  }

  // Never copy our own outbound/inbound domain back to itself (mail loops).
  let copied = false;
  if (!/@inbound\.dreamapplab\.com$/i.test(senderAddr)) {
    const r = await send({
      to: labInbox(),
      subject: `[Mission Control] ${msg.subject || '(no subject)'}`,
      html: copyHtml(msg, filedAs),
      replyTo: senderAddr || undefined,
    });
    copied = !!(r && r.ok);
  }

  if (saveError) throw saveError;
  return { filed, copied };
}

module.exports = { handleInbound, parseInbound, emailAddress };
