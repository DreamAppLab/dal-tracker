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
  // A planted duplicate result header makes it unverified.
  assert.equal(parseInbound({ from: 'jaclyn@example.com', sender: 'jaclyn@example.com', 'message-headers': headers([['X-Mailgun-Spf', 'Pass'], ['X-Mailgun-Spf', 'Pass']]) }).verified, false);
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
