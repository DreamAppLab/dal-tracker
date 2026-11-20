const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('../helpers');
const { handleInbound, emailAddress } = require('../../api/_lib/inboundEmail');

function sender() {
  const sent = [];
  const send = async (m) => { sent.push(m); return { ok: true }; };
  return { sent, send };
}
const inbound = (db) => [...db.store.entries()].filter(([p, d]) => p.startsWith('clientEmails/') && d.direction === 'inbound').map(([, d]) => d);

test('emailAddress extracts and lower-cases the address', () => {
  assert.equal(emailAddress('Jaclyn T <Jaclyn@Example.com>'), 'jaclyn@example.com');
  assert.equal(emailAddress('jaclyn@example.com'), 'jaclyn@example.com');
  assert.equal(emailAddress('nobody'), '');
});

test('a reply is filed in its thread and copied to lab@dreamapplab.com', async () => {
  const db = setup({
    'clientEmails/o1': { clientId: 'c1', projectId: 'wright-way', source: 'webProject', threadId: '<abc@inbound.dreamapplab.com>', direction: 'outbound' },
  });
  const { sent, send } = sender();
  const r = await handleInbound(db, {
    sender: 'jaclyn@example.com', from: 'Jaclyn <jaclyn@example.com>', subject: 'Re: Draft',
    'stripped-text': 'Love it', 'body-plain': 'Love it\n> quoted', 'In-Reply-To': '<abc@inbound.dreamapplab.com>', 'Message-Id': '<r1@mail>',
  }, { send });
  assert.deepEqual(r, { filed: 'thread', copied: true });
  const [row] = inbound(db);
  assert.equal(row.clientId, 'c1');
  assert.equal(row.projectId, 'wright-way');
  assert.equal(row.source, 'webProject');
  assert.equal(row.parentId, 'o1');
  assert.equal(row.body, 'Love it');
  assert.equal(row.read, false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'lab@dreamapplab.com');
  assert.equal(sent[0].replyTo, 'jaclyn@example.com');
  assert.match(sent[0].subject, /^\[Mission Control\] Re: Draft$/);
  assert.match(sent[0].html, /Love it/);
  assert.match(sent[0].html, /filed in the email thread/);
});

test('threads by References when In-Reply-To is missing or unknown', async () => {
  const db = setup({ 'clientEmails/o1': { clientId: 'c1', projectId: null, source: 'contact', threadId: 'first@inbound.dreamapplab.com', direction: 'outbound' } });
  const { send } = sender();
  const r = await handleInbound(db, {
    sender: 'jaclyn@example.com', subject: 'Re: x', 'body-plain': 'hi',
    'In-Reply-To': '<unknown@gmail.com>', References: '<first@inbound.dreamapplab.com> <unknown@gmail.com>', 'Message-Id': '<r2@mail>',
  }, { send });
  assert.equal(r.filed, 'thread');
  assert.equal(inbound(db)[0].parentId, 'o1');
});

test('a new email from a known contact (not a reply) is filed under that contact', async () => {
  const db = setup({ 'clients/c9': { name: 'Jaclyn', email: 'Jaclyn@Example.com ' } });
  const { sent, send } = sender();
  const r = await handleInbound(db, { sender: 'jaclyn@example.com', subject: 'New idea', 'body-plain': 'What about a blog?', 'Message-Id': '<n1@mail>' }, { send });
  assert.deepEqual(r, { filed: 'contact', copied: true });
  const [row] = inbound(db);
  assert.equal(row.clientId, 'c9');
  assert.equal(row.source, 'contact');
  assert.equal(row.parentId, null);
  assert.match(sent[0].html, /filed under the sender/);
});

test('mail from an unknown sender is not filed but is still copied to lab@', async () => {
  const db = setup({});
  const { sent, send } = sender();
  const r = await handleInbound(db, { sender: 'stranger@example.org', subject: 'Hello', 'body-plain': '<script>x</script>' }, { send });
  assert.deepEqual(r, { filed: null, copied: true });
  assert.equal(inbound(db).length, 0);
  assert.match(sent[0].html, /not matched to a contact/);
  assert.doesNotMatch(sent[0].html, /<script>/); // escaped
});

test('our own inbound domain is never copied back (no mail loops)', async () => {
  const db = setup({});
  const { sent, send } = sender();
  const r = await handleInbound(db, { sender: 'lab@inbound.dreamapplab.com', subject: 'loop', 'body-plain': 'x' }, { send });
  assert.equal(r.copied, false);
  assert.equal(sent.length, 0);
});

test('a Firestore failure still copies to lab@, then throws so Mailgun retries', async () => {
  const db = setup({ 'clients/c9': { email: 'jaclyn@example.com' } });
  const realCollection = db.collection;
  db.collection = (name) => {
    const c = realCollection(name);
    if (name === 'clientEmails') return { ...c, add: async () => { throw new Error('unavailable'); } };
    return c;
  };
  const { sent, send } = sender();
  await assert.rejects(handleInbound(db, { sender: 'jaclyn@example.com', subject: 's', 'body-plain': 'b' }, { send }), /unavailable/);
  assert.equal(sent.length, 1);
  assert.match(sent[0].html, /could not be filed/);
});
