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
const FIRST_SIGHTING_MAX_AGE_SECONDS = 15 * 60;

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

// Mailgun's message-headers: JSON list of [name, value]. Map lower-case name → all values.
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
        (out[k] = out[k] || []).push(String(pair[1]));
      }
    }
  }
  return out;
}

const msgIds = (s) => String(s || '').match(/<[^<>\s]+>/g) || [];

const domainOf = (addr) => (String(addr || '').split('@')[1] || '').toLowerCase();
// "spf=pass smtp.mailfrom=jo@client.com; dkim=pass header.d=client.com" →
// "spf=pass dkim=pass header.d=client.com" (addresses' local parts and IPs dropped).
const authTags = (v) =>
  (String(v || '').match(/\b(?:spf|dkim|dmarc|arc)=\w+|\bheader\.[di]=[^\s;]+/gi) || [])
    .map((t) => t.replace(/^(header\.i=)[^@]*@/i, '$1@').toLowerCase())
    .join(' ')
    .slice(0, 300);
// d= tag of a DKIM-Signature header (tags may be folded across lines).
const dkimDomain = (sig) => ((String(sig || '').match(/(?:^|;)\s*d\s*=\s*([^;\s]+)/i) || [])[1] || '').toLowerCase();
// Aligned = same domain, or one is a subdomain of the other (mail.client.com ~
// client.com). Never "same last two labels": evil.co.uk must not match client.co.uk.
const normDomain = (d) => String(d || '').toLowerCase().replace(/\.+$/, '');
const aligned = (a, b) => {
  const x = normDomain(a);
  const y = normDomain(b);
  return !!x && !!y && (x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`));
};

// "Verified" only when Mailgun's check passed for the From domain: SPF pass with
// the envelope domain aligned to From, or Mailgun DKIM pass with a DKIM-Signature
// d= aligned to From. Duplicated Mailgun result headers (a sender could plant
// one) count as unverified.
// Mailgun's receiving servers, as they sign their Authentication-Results header
// (observed live: "mxa.mailgun.org"). Pinned on purpose: no substring matching.
const MAILGUN_AUTHSERV_IDS = new Set(['mxa.mailgun.org', 'mxb.mailgun.org', 'mxa.eu.mailgun.org', 'mxb.eu.mailgun.org']);

const authServId = (v) => (String(v || '').trim().split(/[;\s]/)[0] || '').toLowerCase();

// Mailgun's own Authentication-Results (RFC 8601): trusted only when the topmost
// A-R header is written by a Mailgun receiving host and no second header claims a
// Mailgun id (a sender can plant A-R headers lower in the message; fail closed).
// Verified = dmarc=pass with header.from aligned to From, or dkim=pass with an
// aligned header.d/header.i, or spf=pass with an aligned smtp.mailfrom.
function mailgunAuthResultsVerified(arHeaders, fromDomain) {
  if (!arHeaders.length || !MAILGUN_AUTHSERV_IDS.has(authServId(arHeaders[0]))) return false;
  if (arHeaders.filter((v) => MAILGUN_AUTHSERV_IDS.has(authServId(v))).length !== 1) return false;
  // Drop the authserv-id, and comments like "(i=1 spf=pass ...)" which are not results.
  let text = String(arHeaders[0]).trim().replace(/^[^;]*;/, '');
  for (let i = 0; i < 5; i += 1) text = text.replace(/\([^()]*\)/g, ' ');
  for (const seg of text.split(';')) {
    const m = seg.trim().match(/^([a-z-]+)\s*=\s*([a-z]+)\b(.*)$/i);
    if (!m) continue;
    const method = m[1].toLowerCase();
    const result = m[2].toLowerCase();
    const props = {};
    (m[3].match(/[a-z-]+\.[a-z-]+\s*=\s*[^\s;]+/gi) || []).forEach((p) => {
      const [k, ...rest] = p.split('=');
      props[k.trim().toLowerCase()] = rest.join('=').trim().replace(/^"|"$/g, '').toLowerCase();
    });
    if (result !== 'pass') continue;
    const domainProp = (v) => (v && v.includes('@') ? v.split('@').pop() : v);
    if (method === 'dmarc' && aligned(props['header.from'], fromDomain)) return true;
    if (method === 'dkim' && (aligned(props['header.d'], fromDomain) || aligned(domainProp(props['header.i']), fromDomain))) return true;
    if (method === 'spf' && aligned(domainProp(props['smtp.mailfrom']), fromDomain)) return true;
  }
  return false;
}

function senderVerified(h, fromAddr, envelopeAddr) {
  if (mailgunAuthResultsVerified(h['authentication-results'] || [], domainOf(fromAddr))) return true;
  const spf = h['x-mailgun-spf'] || [];
  const dkim = h['x-mailgun-dkim-check-result'] || [];
  // Mailgun can repeat a header (different case); only conflicting values count.
  const distinct = (vals) => new Set(vals.map((v) => String(v).trim().toLowerCase())).size;
  if (distinct(spf) > 1 || distinct(dkim) > 1) return false;
  const fromDomain = domainOf(fromAddr);
  if (!fromDomain) return false;
  if (/^pass/i.test(spf[0] || '') && aligned(domainOf(envelopeAddr), fromDomain)) return true;
  if (/^pass/i.test(dkim[0] || '')) {
    // Mailgun reports one DKIM result for the whole message, so only trust it
    // when there is exactly one signature and it is the From domain's.
    const sigs = h['dkim-signature'] || [];
    if (sigs.length === 1) {
      const d = dkimDomain(sigs[0]);
      if (aligned(d, fromDomain)) return true;
    }
  }
  return false;
}

function parseInbound(body) {
  const hm = headerMap(body);
  const h = {};
  Object.keys(hm).forEach((k) => { h[k] = hm[k][0]; });
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
    verified: senderVerified(hm, emailAddress(hdr('from', 'from', 'From')) || emailAddress(field(body, 'sender')), emailAddress(field(body, 'sender'))),
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
  const key = messageKey(body, msg);
  const markerRef = db.collection('inboundMessages').doc(key);
  const claimRef = db.collection('inboundMessages').doc(`${key}_copy`);
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
        // Deterministic id: a duplicate delivery overwrites instead of filing twice.
        await db.collection('clientEmails').doc(`in_${key}`).set({
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
      await markerRef.set({ filedDone: true, filedAs: filed, filedLabel: filedAs, verified: msg.verified, auth: authSummary(body), at: FieldValue.serverTimestamp() }, { merge: true });
    } catch (e) {
      saveError = e;
      filedAs = 'could not be filed (Mission Control error)';
    }
  }

  // No copies of our own mail (mail loops). Auto-replies are copied, tagged.
  let skippedCopy = null;
  if (/@inbound\.dreamapplab\.com$/i.test(fromAddr) || /@inbound\.dreamapplab\.com$/i.test(emailAddress(msg.sender))) skippedCopy = 'own-domain';
  else if (fromAddr && fromAddr === labInbox().toLowerCase()) skippedCopy = 'from-lab-inbox';

  let copied = !!marker.copied;
  let claimed = false;
  if (!copied && !skippedCopy) {
    // Claim the copy so two simultaneous deliveries send it once. A stale claim
    // (the sender crashed) is taken over after 5 minutes.
    try {
      await claimRef.create({ claimedAt: Date.now() });
      claimed = true;
    } catch (_) {
      const c = await claimRef.get();
      const data = c.exists ? c.data() || {} : {};
      if (data.sent) copied = true;
      else if (!data.claimedAt || Date.now() - data.claimedAt > 5 * 60 * 1000) {
        await claimRef.set({ claimedAt: Date.now() });
        claimed = true;
      } else {
        throw new Error('Copy already in progress');
      }
    }
  }
  if (claimed) {
    const tag = (msg.spam ? '[Spam?] ' : '') + (msg.autoReply ? '[Auto-reply] ' : '') + (!msg.spam && !msg.verified ? '[Unverified] ' : '');
    const r = await send({
      to: labInbox(),
      subject: `[Mission Control] ${tag}${msg.subject || '(no subject)'}`,
      html: copyHtml(msg, { fromAddr, filedAs, attachments }),
      replyTo: fromAddr || undefined,
      attachments,
    });
    copied = !!(r && r.ok);
    if (copied) {
      try { await claimRef.set({ sent: true, claimedAt: Date.now() }); } catch (_) { /* best effort */ }
      try { await markerRef.set({ copied: true }, { merge: true }); } catch (_) { /* best effort */ }
    } else {
      try { await claimRef.delete(); } catch (_) { /* let it go stale */ }
    }
  }

  if (saveError) throw saveError;
  if (!copied && !skippedCopy) throw new Error('Copy to lab inbox failed');
  return skippedCopy ? { filed, copied, skippedCopy } : { filed, copied };
}

/**
 * Mailgun's signature covers only timestamp+token, not the body. Bind each token
 * to the first message it arrived with, durably, so a leaked signature can only
 * re-deliver that same message (a genuine retry) — never different content.
 * Returns true if this body may be processed.
 */
async function bindToken(db, body, { now = Date.now() } = {}) {
  const token = field(body, 'token');
  if (!token) return false;
  // Fingerprint of every posted field except the signature trio; a genuine
  // Mailgun retry resends exactly the same body.
  const entries = Object.keys(body)
    .filter((k) => !['timestamp', 'token', 'signature'].includes(k))
    .sort()
    .map((k) => [k, field(body, k)]);
  const key = crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');
  const ref = db.collection('inboundMessages').doc(`tok_${crypto.createHash('sha256').update(token).digest('hex')}`);
  // A token seen here for the first time must be fresh (a genuine first delivery
  // arrives within seconds). Only already-bound tokens get the long retry window,
  // so signatures from the account's other webhooks can't open a new message.
  const ageSeconds = now / 1000 - Number(field(body, 'timestamp'));
  if (!Number.isFinite(ageSeconds) || ageSeconds > FIRST_SIGHTING_MAX_AGE_SECONDS) {
    const snap = await ref.get();
    return snap.exists && (snap.data() || {}).key === key;
  }
  try {
    await ref.create({ key, at: FieldValue.serverTimestamp() });
    return true;
  } catch (e) {
    const snap = await ref.get();
    if (!snap.exists) throw e;
    return (snap.data() || {}).key === key;
  }
}

// What Mailgun told us about authentication (no message content): stored on the
// processing record so "why was this [Unverified]?" can be answered later.
function authSummary(body) {
  const hm = headerMap(body);
  const dkimD = (hm['dkim-signature'] || []).map(dkimDomain);
  return {
    spf: (hm['x-mailgun-spf'] || []).slice(0, 3),
    dkim: (hm['x-mailgun-dkim-check-result'] || []).slice(0, 3),
    dkimDomains: dkimD.slice(0, 5),
    // Result tags and domains only (no addresses or IPs).
    authResults: (hm['authentication-results'] || []).map(authTags).slice(0, 3),
    // Which server wrote each Authentication-Results header, in order (host names only).
    authServIds: (hm['authentication-results'] || []).map((v) => (String(v).trim().split(/[;\s]/)[0] || '').toLowerCase().slice(0, 80)).slice(0, 6),
    receivedBy: (hm['received'] || []).slice(0, 3).map((v) => ((String(v).match(/\bby\s+([^\s;()]+)/i) || [])[1] || '').toLowerCase().slice(0, 80)),
    receivedSpf: (hm['received-spf'] || []).map((v) => (String(v).trim().match(/^\w+/) || [''])[0].toLowerCase()).slice(0, 3),
    envelopeDomain: domainOf(emailAddress(field(body, 'sender'))),
    fromDomain: domainOf(emailAddress(field(body, 'from', 'From'))),
    hasMessageHeaders: !!body['message-headers'],
    fields: Object.keys(body).filter((k) => !['body-plain', 'stripped-text', 'body-html', 'stripped-html', 'stripped-signature', 'message-headers', 'token', 'signature'].includes(k)).slice(0, 40),
  };
}

module.exports = { authSummary, handleInbound, parseInbound, emailAddress, headerMap, bindToken };
