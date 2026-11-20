const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('stream');
const { setup } = require('../helpers');
const { handleInbound, emailAddress, parseInbound } = require('../../api/_lib/inboundEmail');
const { parseInboundForm } = require('../../api/_lib/inboundForm');

function sender(ok = true) {
  const sent = [];
  const send = async (m) => { sent.push(m); return { ok }; };
  return { sent, send };
}
const inbound = (db) => [...db.store.entries()].filter(([p, d]) => p.startsWith('clientEmails/') && d.direction === 'inbound').map(([, d]) => d);
const headers = (pairs) => JSON.stringify(pairs);
// Mailgun DKIM pass with a signature from the From domain (example.com).
const VERIFIED = headers([['X-Mailgun-Dkim-Check-Result', 'Pass'], ['DKIM-Signature', 'v=1; a=rsa-sha256; d=example.com; s=s1; b=xyz']]);
const OUTBOUND = { clientId: 'c1', projectId: 'wright-way', source: 'webProject', threadId: '<abc@inbound.dreamapplab.com>', direction: 'outbound' };

test('emailAddress extracts and lower-cases the address', () => {
  assert.equal(emailAddress('Jaclyn T <Jaclyn@Example.com>'), 'jaclyn@example.com');
  assert.equal(emailAddress('jaclyn@example.com'), 'jaclyn@example.com');
  assert.equal(emailAddress('nobody'), '');
});

test('headers are read from message-headers when not posted as top-level fields', () => {
  const m = parseInbound({
    'message-headers': headers([['Message-Id', '<m1@x>'], ['In-Reply-To', '<abc@inbound.dreamapplab.com> (comment)'], ['References', '<a@x> <b@x>'], ['X-Mailgun-Sflag', 'Yes'], ['Auto-Submitted', 'auto-replied']]),
    from: 'J <j@example.com>',
  });
  assert.equal(m.messageId, '<m1@x>');
  assert.match(m.inReplyTo, /<abc@inbound\.dreamapplab\.com>/);
  assert.equal(m.spam, true);
  assert.equal(m.autoReply, true);
  assert.equal(m.verified, false);
});

test('a reply is filed in its thread and copied to lab@ with the From address as Reply-To', async () => {
  const db = setup({ 'clientEmails/o1': OUTBOUND });
  const { sent, send } = sender();
  const attachments = [{ filename: 'shot.png', contentType: 'image/png', buffer: Buffer.from('png') }];
  const r = await handleInbound(db, {
    sender: 'bounce+srs=jaclyn@relay.example.net', from: 'Jaclyn <Jaclyn@Example.com>', subject: 'Re: Draft',
    'stripped-text': 'Love it', 'body-plain': 'Love it\n> quoted', 'Message-Id': '<r1@mail>',
    'message-headers': headers([['In-Reply-To', '<abc@inbound.dreamapplab.com>'], ['X-Mailgun-Dkim-Check-Result', 'Pass'], ['DKIM-Signature', 'v=1; d=mail.example.com; b=x']]),
  }, { send, attachments });
  assert.deepEqual(r, { filed: 'thread', copied: true });
  const [row] = inbound(db);
  assert.equal(row.clientId, 'c1');
  assert.equal(row.projectId, 'wright-way');
  assert.equal(row.source, 'webProject');
  assert.equal(row.parentId, 'o1');
  assert.equal(row.body, 'Love it');
  assert.equal(row.to, 'jaclyn@example.com');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'lab@dreamapplab.com');
  assert.equal(sent[0].replyTo, 'jaclyn@example.com');
  assert.equal(sent[0].subject, '[Mission Control] Re: Draft');
  assert.equal(sent[0].attachments, attachments);
  assert.match(sent[0].html, /filed in the email thread/);
  assert.match(sent[0].html, /sent via bounce\+srs=jaclyn@relay\.example\.net/);
});

test('the same message delivered twice is filed and copied once', async () => {
  const db = setup({ 'clientEmails/o1': OUTBOUND });
  const { sent, send } = sender();
  const msg = { from: 'j@example.com', subject: 'Re: x', 'body-plain': 'hi', 'In-Reply-To': '<abc@inbound.dreamapplab.com>', 'Message-Id': '<dup@mail>', 'message-headers': VERIFIED };
  await handleInbound(db, msg, { send });
  await handleInbound(db, msg, { send });
  assert.equal(inbound(db).length, 1);
  assert.equal(sent.length, 1);
});

test('a failed copy throws (Mailgun retries) and the retry only re-sends the copy', async () => {
  const db = setup({ 'clientEmails/o1': OUTBOUND });
  const msg = { from: 'j@example.com', subject: 'Re: x', 'body-plain': 'hi', 'In-Reply-To': '<abc@inbound.dreamapplab.com>', 'Message-Id': '<retry@mail>', 'message-headers': VERIFIED };
  await assert.rejects(handleInbound(db, msg, { send: sender(false).send }), /Copy to lab inbox failed/);
  const ok = sender();
  const r = await handleInbound(db, msg, { send: ok.send });
  assert.equal(r.copied, true);
  assert.equal(ok.sent.length, 1);
  assert.equal(inbound(db).length, 1); // filed once
});

test('threads by References (newest first) and only to emails Mission Control sent', async () => {
  const db = setup({
    'clientEmails/o1': { clientId: 'c1', projectId: null, source: 'contact', threadId: 'first@inbound.dreamapplab.com', direction: 'outbound' },
    // An inbound doc whose sender-chosen id collides must never be a thread root.
    'clientEmails/i9': { clientId: 'cX', source: 'contact', threadId: '<unknown@gmail.com>', direction: 'inbound' },
  });
  const r = await handleInbound(db, {
    from: 'jaclyn@example.com', subject: 'Re: x', 'body-plain': 'hi', 'message-headers': VERIFIED,
    'In-Reply-To': '<unknown@gmail.com>', References: '<first@inbound.dreamapplab.com> <unknown@gmail.com>', 'Message-Id': '<r2@mail>',
  }, { send: sender().send });
  assert.equal(r.filed, 'thread');
  assert.equal(inbound(db).filter((d) => d.parentId === 'o1').length, 1);
});

test('huge References headers are capped (bounded Firestore reads)', async () => {
  const db = setup({});
  let queries = 0;
  const real = db.collection;
  db.collection = (name) => {
    const c = real(name);
    if (name !== 'clientEmails') return c;
    return { ...c, where: (...a) => { queries += 1; return c.where(...a); } };
  };
  const refs = Array.from({ length: 500 }, (_, i) => `<id${i}@x>`).join(' ');
  await handleInbound(db, { from: 'x@example.com', subject: 's', 'body-plain': 'b', References: refs, 'Message-Id': '<big@x>' }, { send: sender().send });
  assert.ok(queries <= 20, `too many queries: ${queries}`);
});

test('a new email from a verified known contact is filed under that contact', async () => {
  const db = setup({ 'clients/c9': { name: 'Jaclyn', email: 'Jaclyn@Example.com ' } });
  const { sent, send } = sender();
  const r = await handleInbound(db, { from: 'Jaclyn <jaclyn@example.com>', subject: 'New idea', 'body-plain': 'What about a blog?', 'Message-Id': '<n1@mail>', 'message-headers': VERIFIED }, { send });
  assert.deepEqual(r, { filed: 'contact', copied: true });
  const [row] = inbound(db);
  assert.equal(row.clientId, 'c9');
  assert.equal(row.source, 'contact');
  assert.equal(row.parentId, null);
  assert.match(sent[0].html, /filed under the sender/);
  assert.doesNotMatch(sent[0].subject, /Unverified/);
});

test('an unverified sender is never filed under a contact, and the copy is labelled', async () => {
  const db = setup({ 'clients/c9': { email: 'jaclyn@example.com' } });
  const { sent, send } = sender();
  const r = await handleInbound(db, { from: 'jaclyn@example.com', subject: 'Change my bank details', 'body-plain': 'x', 'Message-Id': '<s1@mail>' }, { send });
  assert.equal(r.filed, null);
  assert.equal(inbound(db).length, 0);
  assert.equal(sent[0].subject, '[Mission Control] [Unverified] Change my bank details');
  assert.match(sent[0].html, /not verified/);
});

test('two contacts with the same address: not filed', async () => {
  const db = setup({ 'clients/a': { email: 'shared@example.com' }, 'clients/b': { email: 'shared@example.com' } });
  const { sent, send } = sender();
  const r = await handleInbound(db, { from: 'shared@example.com', subject: 's', 'body-plain': 'b', 'Message-Id': '<sh@mail>', 'message-headers': VERIFIED }, { send });
  assert.equal(r.filed, null);
  assert.match(sent[0].html, /several contacts/);
});

test('spam is labelled and never filed under a contact', async () => {
  const db = setup({ 'clients/c9': { email: 'jaclyn@example.com' } });
  const { sent, send } = sender();
  await handleInbound(db, { from: 'jaclyn@example.com', subject: 'Win', 'body-plain': 'x', 'Message-Id': '<sp@mail>', 'message-headers': headers([['X-Mailgun-Spf', 'Pass'], ['X-Mailgun-Sflag', 'Yes']]), sender: 'jaclyn@example.com' }, { send });
  assert.equal(inbound(db).length, 0);
  assert.match(sent[0].subject, /^\[Mission Control\] \[Spam\?\] Win$/);
});

test('mail from an unknown sender is not filed but is still copied (escaped)', async () => {
  const db = setup({});
  const { sent, send } = sender();
  const r = await handleInbound(db, { from: 'stranger@example.org', subject: 'Hello', 'body-plain': '<script>x</script>' }, { send });
  assert.equal(r.filed, null);
  assert.equal(r.copied, true);
  assert.doesNotMatch(sent[0].html, /<script>/);
});

test('auto-replies are still copied, tagged', async () => {
  const db = setup({});
  const { sent, send } = sender();
  const r = await handleInbound(db, { from: 'j@example.com', subject: 'Out of office', 'body-plain': 'x', 'Message-Id': '<l3@x>', 'message-headers': headers([['Auto-Submitted', 'auto-replied']]) }, { send });
  assert.equal(r.copied, true);
  assert.ok(sent[0].subject.includes('[Auto-reply]'), sent[0].subject);
  assert.ok(sent[0].subject.endsWith('Out of office'), sent[0].subject);
});

test('verification requires the passing domain to match the From domain', () => {
  // SPF passed for the attacker's envelope domain, From claims the client.
  assert.equal(parseInbound({ from: 'jaclyn@example.com', sender: 'x@evil.test', 'message-headers': headers([['X-Mailgun-Spf', 'Pass']]) }).verified, false);
  assert.equal(parseInbound({ from: 'jaclyn@example.com', sender: 'bounce@mail.example.com', 'message-headers': headers([['X-Mailgun-Spf', 'Pass']]) }).verified, true);
  // DKIM passed, but signed by another domain.
  assert.equal(parseInbound({ from: 'jaclyn@example.com', 'message-headers': headers([['X-Mailgun-Dkim-Check-Result', 'Pass'], ['DKIM-Signature', 'v=1; d=evil.test; b=x']]) }).verified, false);
  // A planted result header that conflicts with Mailgun's makes it unverified.
  assert.equal(parseInbound({ from: 'jaclyn@example.com', sender: 'jaclyn@example.com', 'message-headers': headers([['X-Mailgun-Spf', 'Pass'], ['X-Mailgun-Spf', 'Fail']]) }).verified, false);
});

test('a copy already being sent by a concurrent delivery is not sent twice', async () => {
  const db = setup({});
  const msg = { from: 'stranger@example.org', subject: 'Hi', 'body-plain': 'x', 'Message-Id': '<c1@x>' };
  const key = require('crypto').createHash('sha256').update('<c1@x>').digest('hex');
  await db.collection('inboundMessages').doc(key + '_copy').create({ claimedAt: Date.now() });
  const { sent, send } = sender();
  await assert.rejects(handleInbound(db, msg, { send }), /in progress/);
  assert.equal(sent.length, 0);
});

test('no copies for our own domain or the lab inbox itself (no loops)', async () => {
  for (const msg of [
    { sender: 'lab@inbound.dreamapplab.com', from: 'lab@inbound.dreamapplab.com', subject: 'loop', 'body-plain': 'x', 'Message-Id': '<l1@x>' },
    { from: 'Eddie <lab@dreamapplab.com>', subject: 'me', 'body-plain': 'x', 'Message-Id': '<l2@x>' },
  ]) {
    const db = setup({});
    const { sent, send } = sender();
    const r = await handleInbound(db, msg, { send });
    assert.equal(sent.length, 0, msg.subject);
    assert.equal(r.copied, false);
    assert.ok(r.skippedCopy);
  }
});

test('a Firestore failure still copies to lab@, then throws so Mailgun retries', async () => {
  const db = setup({ 'clients/c9': { email: 'jaclyn@example.com' } });
  const realCollection = db.collection;
  db.collection = (name) => {
    const c = realCollection(name);
    if (name === 'clientEmails') return { ...c, doc: (id) => ({ ...c.doc(id), set: async () => { throw new Error('unavailable'); } }) };
    return c;
  };
  const { sent, send } = sender();
  await assert.rejects(handleInbound(db, { from: 'jaclyn@example.com', subject: 's', 'body-plain': 'b', 'Message-Id': '<f1@x>', 'message-headers': VERIFIED }, { send }), /unavailable/);
  assert.equal(sent.length, 1);
  assert.match(sent[0].html, /could not be filed/);
});

function fakeReq(contentType, payload) {
  const req = new PassThrough();
  req.headers = { 'content-type': contentType, 'content-length': String(Buffer.byteLength(payload)) };
  req.method = 'POST';
  req.end(payload);
  return req;
}

test('parses Mailgun urlencoded posts', async () => {
  const p = new URLSearchParams({ sender: 'j@example.com', subject: 'Re: hi', 'body-plain': 'a & b', timestamp: '1', token: 't', signature: 'f'.repeat(64) });
  const { body, attachments } = await parseInboundForm(fakeReq('application/x-www-form-urlencoded', p.toString()));
  assert.equal(body.subject, 'Re: hi');
  assert.equal(body['body-plain'], 'a & b');
  assert.equal(attachments.length, 0);
});

test('parses Mailgun multipart posts with attachments', async () => {
  const b = 'XyZbound';
  const part = (name, value) => `--${b}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  const payload =
    part('sender', 'j@example.com') + part('subject', 'With file') + part('attachment-count', '1') +
    `--${b}\r\nContent-Disposition: form-data; name="attachment-1"; filename="shot.png"\r\nContent-Type: image/png\r\n\r\nPNGDATA\r\n--${b}--\r\n`;
  const { body, attachments } = await parseInboundForm(fakeReq(`multipart/form-data; boundary=${b}`, payload));
  assert.equal(body.subject, 'With file');
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].filename, 'shot.png');
  assert.equal(attachments[0].contentType, 'image/png');
  assert.equal(attachments[0].buffer.toString(), 'PNGDATA');
});

test('the replay token is recorded only after success, so Mailgun retries get through', async () => {
  const { verifyMailgunRequest, commitMailgunToken, computeSignature } = require('../../api/_lib/mailgunWebhook');
  const key = 'k-test';
  const ts = String(Math.floor(Date.now() / 1000) - 2 * 3600); // a retry 2 h later
  const body = { timestamp: ts, token: 'retry-token-1', signature: computeSignature(key, ts, 'retry-token-1') };
  const opts = { keyOverride: key, recordToken: false, maxSkewSeconds: 9 * 3600 };
  assert.equal(await verifyMailgunRequest(body, opts), true);
  assert.equal(await verifyMailgunRequest(body, opts), true, 'failed first attempt can be retried');
  commitMailgunToken(body);
  assert.equal(await verifyMailgunRequest(body, opts), false, 'replay after success is rejected');
  assert.equal(await verifyMailgunRequest(body, { keyOverride: key }), false, 'default 15-minute window still applies elsewhere');
});

test('a Mailgun token can only ever carry the message it first arrived with', async () => {
  const { bindToken } = require('../../api/_lib/inboundEmail');
  const db = setup({});
  const genuine = { token: 'tok-1', timestamp: String(Math.floor(Date.now() / 1000)), signature: 'x', from: 'jaclyn@example.com', subject: 'Re: Draft', 'body-plain': 'Love it', 'Message-Id': '<g1@mail>' };
  assert.equal(await bindToken(db, genuine), true);
  assert.equal(await bindToken(db, { ...genuine }), true, 'an identical retry is allowed');
  assert.equal(await bindToken(db, { ...genuine, 'body-plain': 'Please wire the deposit to…', 'Message-Id': '<evil@x>' }), false);
  assert.equal(await bindToken(db, { ...genuine, 'Message-Id': undefined, subject: 'other' }), false);
  assert.equal(await bindToken(db, { from: 'a@b.c' }), false, 'no token');
});

test('alignment is exact or subdomain only (no public-suffix lookalikes) and needs a single DKIM signature', () => {
  const spf = headers([['X-Mailgun-Spf', 'Pass']]);
  assert.equal(parseInbound({ from: 'jo@client.co.uk', sender: 'x@evil.co.uk', 'message-headers': spf }).verified, false);
  assert.equal(parseInbound({ from: 'jo@client.co.uk', sender: 'bounce@mail.client.co.uk', 'message-headers': spf }).verified, true);
  const twoSigs = headers([['X-Mailgun-Dkim-Check-Result', 'Pass'], ['DKIM-Signature', 'v=1; d=evil.com; b=ok'], ['DKIM-Signature', 'v=1; d=example.com; b=bogus']]);
  assert.equal(parseInbound({ from: 'jaclyn@example.com', 'message-headers': twoSigs }).verified, false);
});

test('future-dated Mailgun timestamps are rejected even with the wide retry window', async () => {
  const { verifyMailgunRequest, computeSignature } = require('../../api/_lib/mailgunWebhook');
  const ts = String(Math.floor(Date.now() / 1000) + 3600);
  const body = { timestamp: ts, token: 'future-1', signature: computeSignature('k', ts, 'future-1') };
  assert.equal(await verifyMailgunRequest(body, { keyOverride: 'k', recordToken: false, maxSkewSeconds: 9 * 3600 }), false);
});

test('a token first seen more than 15 minutes after signing is rejected; a bound one keeps the retry window', async () => {
  const { bindToken } = require('../../api/_lib/inboundEmail');
  const db = setup({});
  const now = Date.now();
  const fresh = { token: 'tok-r', timestamp: String(Math.floor(now / 1000)), signature: 'x', from: 'j@example.com', subject: 's', 'body-plain': 'b' };
  assert.equal(await bindToken(db, fresh, { now }), true);
  assert.equal(await bindToken(db, fresh, { now: now + 2 * 3600 * 1000 }), true, 'genuine retry 2 h later');
  const foreign = { token: 'tok-from-another-webhook', timestamp: String(Math.floor(now / 1000) - 3600), signature: 'x', from: 'j@example.com', subject: 's', 'body-plain': 'b' };
  assert.equal(await bindToken(db, foreign, { now }), false, 'never-seen token older than 15 min');
  assert.equal(await bindToken(db, { ...fresh, 'in-reply-to': '<other@x>' }, { now }), false, 'any extra field changes the fingerprint');
});

test('authSummary records Mailgun auth results without message content; folded DKIM d= parses', () => {
  const { authSummary } = require('../../api/_lib/inboundEmail');
  const h = headers([['X-Mailgun-Spf', 'Pass'], ['X-Mailgun-Dkim-Check-Result', 'Pass'], ['DKIM-Signature', 'v=1; a=rsa-sha256; c=relaxed/relaxed;\r\n        d=gmail.com; s=20230601; b=abc']]);
  const s = authSummary({ sender: 'a@gmail.com', from: 'A <a@gmail.com>', subject: 'secret subject', 'body-plain': 'secret body', 'message-headers': h, token: 't', signature: 's' });
  assert.deepEqual(s.dkimDomains, ['gmail.com']);
  assert.deepEqual(s.spf, ['Pass']);
  assert.equal(s.fromDomain, 'gmail.com');
  assert.ok(!JSON.stringify(s).includes('secret body'));
  assert.ok(!s.fields.includes('token') && !s.fields.includes('signature'));
  assert.equal(parseInbound({ from: 'a@gmail.com', 'message-headers': h }).verified, true);
});

test('identical repeated Mailgun result headers still verify; conflicting ones do not; summary keeps tags only', () => {
  const { authSummary } = require('../../api/_lib/inboundEmail');
  assert.equal(parseInbound({ from: 'a@gmail.com', sender: 'a@gmail.com', 'message-headers': headers([['X-Mailgun-Spf', 'Pass'], ['X-Mailgun-SPF', 'Pass']]) }).verified, true);
  assert.equal(parseInbound({ from: 'a@gmail.com', sender: 'a@gmail.com', 'message-headers': headers([['X-Mailgun-Spf', 'Fail'], ['X-Mailgun-Spf', 'Pass']]) }).verified, false);
  const s = authSummary({ sender: 'jo@client.com', from: 'jo@client.com', 'message-headers': headers([
    ['Authentication-Results', 'mx.example; spf=pass (domain of jo@client.com designates 203.0.113.9) smtp.mailfrom=jo@client.com; dkim=pass header.i=@client.com header.d=client.com; dmarc=pass'],
    ['Received-SPF', 'pass (example: domain of jo@client.com designates 203.0.113.9 as permitted sender)'],
  ]) });
  assert.equal(s.authResults[0], 'spf=pass dkim=pass header.i=@client.com header.d=client.com dmarc=pass');
  assert.deepEqual(s.receivedSpf, ['pass']);
  assert.ok(!JSON.stringify(s).includes('203.0.113.9'));
  assert.ok(!JSON.stringify(s).includes('jo@'));
});

const MG_AR = 'mxa.mailgun.org; dkim=pass header.i=@gmail.com header.s=20230601 header.b=abc; spf=pass (mxa.mailgun.org: domain of jo@gmail.com designates 209.85.128.46 as permitted sender) smtp.mailfrom=jo@gmail.com; spf=none smtp.helo=mail-yx1-f46.google.com; dmarc=pass (p=NONE sp=QUARANTINE dis=NONE) header.from=gmail.com; arc=pass (i=1 spf=pass spfdomain=gmail.com dkim=pass dkdomain=gmail.com dmarc=pass fromdomain=gmail.com)';

test('Mailgun\'s own Authentication-Results verifies a genuine sender', () => {
  const m = parseInbound({ from: 'Jo <jo@gmail.com>', sender: 'jo@gmail.com', 'message-headers': headers([['Authentication-Results', MG_AR], ['Received', 'by mxa.mailgun.org']]) });
  assert.equal(m.verified, true);
});

test('Authentication-Results: planted, foreign, misaligned or missing results stay unverified', () => {
  const v = (pairs, from = 'jo@gmail.com') => parseInbound({ from, sender: from, 'message-headers': headers(pairs) }).verified;
  // A sender-planted Mailgun-looking A-R below Mailgun's own: two Mailgun ids → fail closed.
  assert.equal(v([['Authentication-Results', MG_AR], ['Authentication-Results', 'mxa.mailgun.org; dmarc=pass header.from=gmail.com']]), false);
  // Topmost A-R not written by Mailgun.
  assert.equal(v([['Authentication-Results', 'mx.evil.test; dmarc=pass header.from=gmail.com'], ['Authentication-Results', MG_AR]]), false);
  // Loose lookalike ids are not trusted.
  assert.equal(v([['Authentication-Results', 'mxa.mailgun.org.evil.test; dmarc=pass header.from=gmail.com']]), false);
  // Passes for another domain don't verify a From claiming the client.
  assert.equal(v([['Authentication-Results', 'mxa.mailgun.org; dmarc=pass header.from=evil.test; dkim=pass header.d=evil.test; spf=pass smtp.mailfrom=x@evil.test']], 'jaclyn@client.com'), false);
  // A pass only inside a comment doesn't count.
  assert.equal(v([['Authentication-Results', 'mxa.mailgun.org; dmarc=fail (p=none; was dmarc=pass header.from=gmail.com) header.from=gmail.com; arc=pass (i=1 dkim=pass dkdomain=gmail.com)']]), false);
  // Nothing at all.
  assert.equal(v([]), false);
});
