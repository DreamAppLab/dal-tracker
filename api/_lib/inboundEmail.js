// Inbound client email (Mailgun route → /api/inbound-client-email).
//
// Every message that reaches Mission Control is:
//   1. filed in clientEmails — under the Mission Control email it replies to,
//      or (if it isn't a reply) under the contact whose address sent it, but
//      only when Mailgun verified the sender (SPF or DKIM pass) and exactly one
//      contact has that address; and
//   2. copied to lab@dreamapplab.com with its attachments, whether or not it
//      could be filed, so nothing that comes in is lost or only in Mission
//      Control. Auto-replies and our own mail are not copied (no loops); spam
//      and unverified senders are labelled.
// Processing is idempotent per message (inboundMessages/{hash}), so a Mailgun
// retry redoes only what failed and never duplicates.
//
// clientEmails schema:
// { clientId, projectId, source, threadId, subject, body, bodyFull, to, sentAt, direction, read, parentId }

const crypto = require('crypto');
const { FieldValue } = require('firebase-admin/firestore');
const { sendMail, labInbox, escHtml } = require('./mail');

const clip = (v, n) => String(v || '').slice(0, n);
const MAX_THREAD_IDS = 10;

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

// Mailgun's message-headers: JSON list of [name, value]. Map lower-case name → first value.
function headerMap(body) {
  const out = {};
  let list = body['message-headers'];
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = null; }
  }
  if (Array.isArray(list)) {
    for (const pair of list) {
      if (Array.isArray(pair) && pair.length >= 2) {
        const k = String(pair[0]).toLowerCase();
        if (!(k in out)) out[k] = String(pair[1]);
      }
    }
  }
  return out;
}

const msgIds = (s) => String(s || '').match(/<[^<>\s]+>/g) || [];

function parseInbound(body) {
  const h = headerMap(body);
  const hdr = (name, ...fields) => field(body, ...fields) || h[name] || '';
  const fullText = field(body, 'body-plain', 'stripped-text');
  return {
    sender: field(body, 'sender'),
    from: hdr('from', 'from', 'From'),
    recipient: field(body, 'recipient', 'To', 'to'),
    subject: hdr('subject', 'subject', 'Subject'),
    fullText,
    bodyText: field(body, 'stripped-text') || fullText,
    inReplyTo: hdr('in-reply-to', 'In-Reply-To', 'in-reply-to').trim(),
    references: hdr('references', 'References', 'references'),
    messageId: hdr('message-id', 'Message-Id', 'message-id', 'Message-ID').trim(),
    verified: /^pass/i.test(h['x-mailgun-spf'] || '') || /^pass/i.test(h['x-mailgun-dkim-check-result'] || ''),
    spam: /^yes/i.test(h['x-mailgun-sflag'] || ''),
    autoReply:
      (!!h['auto-submitted'] && !/^no\b/i.test(h['auto-submitted'])) ||
      /^(bulk|junk|list|auto_reply)$/i.test((h['precedence'] || '').trim()) ||
      !!h['x-autoreply'] || !!h['x-autorespond'],
  };
}

async function findThreadOriginal(db, msg) {
  // In-Reply-To, then the newest References — at most MAX_THREAD_IDS ids.
  const ids = [...msgIds(msg.inReplyTo), ...msgIds(msg.references).reverse()];
  if (!ids.length && msg.inReplyTo) ids.push(msg.inReplyTo);
  const unique = [...new Set(ids)].slice(0, MAX_THREAD_IDS);
  for (const raw of unique) {
    for (const id of new Set([raw, raw.replace(/[<>]/g, '')])) {
      if (!id) continue;
      const snap = await db.collection('clientEmails').where('threadId', '==', id).get();
      // Only emails Mission Control sent can start a thread (inbound ids are sender-controlled).
      const outbound = snap.docs.filter((d) => (d.data() || {}).direction === 'outbound');
      if (outbound.length) return { id: outbound[0].id, data: outbound[0].data() };
    }
  }
  return null;
}

async function findClientsByEmail(db, address) {
  if (!address) return [];
  const snap = await db.collection('clients').get();
  return snap.docs
    .filter((d) => String((d.data() || {}).email || '').trim().toLowerCase() === address)
    .map((d) => ({ id: d.id, data: d.data() || {} }));
}

function copyHtml(msg, { fromAddr, filedAs, attachments }) {
  const text = msg.fullText || msg.bodyText || '(no text body)';
  const envelope = emailAddress(msg.sender);
  const warn = [];
  if (msg.spam) warn.push('Mailgun flagged this as possible spam.');
  if (!msg.verified) warn.push('Sender not verified (SPF/DKIM did not pass) — be careful with links, payment or account changes.');
  return (
    (warn.length ? `<p style="background:#fff4e5;border:1px solid #f0b866;padding:8px 10px;font-size:13px;margin:0 0 10px">⚠️ ${warn.map(escHtml).join(' ')}</p>` : '') +
    `<p style="color:#555;font-size:13px;margin:0 0 4px">Received by Mission Control · ${escHtml(filedAs)}</p>` +
    `<p style="color:#555;font-size:13px;margin:0 0 12px"><strong>From:</strong> ${escHtml(msg.from || fromAddr)}` +
    (envelope && envelope !== fromAddr ? ` (sent via ${escHtml(envelope)})` : '') +
    (msg.recipient ? ` &nbsp; <strong>To:</strong> ${escHtml(msg.recipient)}` : '') +
    `</p><pre style="white-space:pre-wrap;font-family:inherit;font-size:14px;margin:0">${escHtml(text.slice(0, 200_000))}</pre>` +
    (attachments && attachments.length ? `<p style="color:#555;font-size:13px">📎 ${attachments.length} attachment(s) included.</p>` : '') +
    `<p style="color:#888;font-size:12px;margin-top:16px">Replying to this email answers the sender directly, but that reply won't appear in Mission Control. Reply from Mission Control (Web Projects or Contacts) to keep the conversation there.</p>`
  );
}

function messageKey(body, msg) {
  const basis = msg.messageId || field(body, 'token') || `${msg.from}|${msg.subject}|${field(body, 'timestamp')}`;
  return crypto.createHash('sha256').update(basis).digest('hex');
}

/**
 * File one inbound message and copy it to the lab inbox (idempotent per message).
 * Returns { filed: 'thread'|'contact'|null, copied: boolean, skippedCopy?: string }.
 * Throws if saving or copying failed, so Mailgun retries (the retry skips what already succeeded).
 */
async function handleInbound(db, body, { send = sendMail, attachments = [] } = {}) {
  const msg = parseInbound(body);
  const fromAddr = emailAddress(msg.from) || emailAddress(msg.sender);
  const markerRef = db.collection('inboundMessages').doc(messageKey(body, msg));
  const markerSnap = await markerRef.get();
  const marker = markerSnap.exists ? markerSnap.data() || {} : {};

  let filed = marker.filedAs || null;
  let filedAs = marker.filedLabel || 'not matched to a contact';
  let saveError = null;

  if (!marker.filedDone) {
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
        filedAs = 'filed in the email thread';
      } else if (!msg.spam && !msg.autoReply) {
        const matches = await findClientsByEmail(db, fromAddr);
        if (matches.length === 1 && msg.verified) {
          record = { clientId: matches[0].id, projectId: null, source: 'contact', parentId: null };
          filed = 'contact';
          filedAs = 'filed under the sender’s contact';
        } else if (matches.length > 1) {
          filedAs = 'not filed: several contacts share this address';
        } else if (matches.length === 1) {
          filedAs = 'not filed: sender could not be verified';
        }
      }
      if (record) {
        await db.collection('clientEmails').add({
          ...record,
          threadId: clip(msg.messageId, 500),
          subject: clip(msg.subject, 500),
          body: clip(msg.bodyText, 100_000),
          bodyFull: clip(msg.fullText, 300_000),
          to: clip(fromAddr || msg.sender, 320),
          sentAt: FieldValue.serverTimestamp(),
          direction: 'inbound',
          read: false,
        });
      }
      await markerRef.set({ filedDone: true, filedAs: filed, filedLabel: filedAs, at: FieldValue.serverTimestamp() }, { merge: true });
    } catch (e) {
      saveError = e;
      filedAs = 'could not be filed (Mission Control error)';
    }
  }

  // No copies of our own mail or of auto-replies (mail loops).
  let skippedCopy = null;
  if (/@inbound\.dreamapplab\.com$/i.test(fromAddr) || /@inbound\.dreamapplab\.com$/i.test(emailAddress(msg.sender))) skippedCopy = 'own-domain';
  else if (fromAddr && fromAddr === labInbox().toLowerCase()) skippedCopy = 'from-lab-inbox';
  else if (msg.autoReply) skippedCopy = 'auto-reply';

  let copied = !!marker.copied;
  if (!copied && !skippedCopy) {
    const tag = msg.spam ? '[Spam?] ' : !msg.verified ? '[Unverified] ' : '';
    const r = await send({
      to: labInbox(),
      subject: `[Mission Control] ${tag}${msg.subject || '(no subject)'}`,
      html: copyHtml(msg, { fromAddr, filedAs, attachments }),
      replyTo: fromAddr || undefined,
      attachments,
    });
    copied = !!(r && r.ok);
    if (copied) {
      try { await markerRef.set({ copied: true }, { merge: true }); } catch (_) { /* best effort */ }
    }
  }

  if (saveError) throw saveError;
  if (!copied && !skippedCopy) throw new Error('Copy to lab inbox failed');
  return skippedCopy ? { filed, copied, skippedCopy } : { filed, copied };
}

module.exports = { handleInbound, parseInbound, emailAddress, headerMap };
