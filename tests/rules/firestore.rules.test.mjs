// Firestore + Storage security rules tests — run against the Firebase emulator:
//   npm run test:rules
// (wraps: firebase emulators:exec --only firestore,storage "node --test tests/rules/")

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';

const PROJECT_ID = 'demo-dal-mission-control';
let env;

const ADMIN = { email: 'lab@dreamapplab.com', email_verified: true };

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') },
    storage: { rules: fs.readFileSync('storage.rules', 'utf8') },
  });
});

after(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('projects/logabode').set({ name: 'Logabode' });
    await db.doc('feedbackPins/p1').set({ project_id: 'coastal', note: 'hi', resolved: false });
    await db.doc('webProjects/coastal').set({ project_name: 'Coastal', preview_url: 'https://coastal.example' });
    await db.doc('auditLog/a1').set({ type: 'sign_in' });
    await db.doc('companies/dal').set({ legalName: 'Dream App Lab LLC' });
  });
});

const admin = () => env.authenticatedContext('eddie-uid', ADMIN).firestore();
const anon = () => env.unauthenticatedContext().firestore();

test('anonymous users can read or write nothing', async () => {
  const db = anon();
  for (const path of ['projects/logabode', 'feedbackPins/p1', 'webProjects/coastal', 'auditLog/a1', 'companies/dal', 'expenses/x']) {
    await assertFails(db.doc(path).get());
  }
  await assertFails(db.collection('feedbackPins').add({ project_id: 'coastal', note: 'spam' }));
  await assertFails(db.doc('projects/logabode').set({ name: 'hacked' }));
  await assertFails(db.collection('auditLog').add({ type: 'fake' }));
});

test('signed-in but non-allowlisted accounts are denied', async () => {
  const db = env.authenticatedContext('intruder', { email: 'intruder@example.com', email_verified: true }).firestore();
  await assertFails(db.doc('projects/logabode').get());
  await assertFails(db.doc('projects/logabode').set({ name: 'x' }));
});

test('allowlisted email WITHOUT verification is denied', async () => {
  const db = env.authenticatedContext('eddie-unverified', { email: 'lab@dreamapplab.com', email_verified: false }).firestore();
  await assertFails(db.doc('projects/logabode').get());
});

test('allowlist check is case-insensitive on email', async () => {
  const db = env.authenticatedContext('eddie-2', { email: 'Lab@DreamAppLab.com', email_verified: true }).firestore();
  await assertSucceeds(db.doc('projects/logabode').get());
});

test('the old personal account no longer has access', async () => {
  const db = env.authenticatedContext('aEbUJSYaP7aXnYtnSk3A5I4iLp72', { email: 'someone@gmail.com', email_verified: false }).firestore();
  await assertFails(db.doc('projects/logabode').get());
});

test('admin can read and write app data', async () => {
  const db = admin();
  await assertSucceeds(db.doc('projects/logabode').get());
  await assertSucceeds(db.doc('projects/logabode').set({ name: 'Logabode 2' }, { merge: true }));
  await assertSucceeds(db.doc('projects/logabode/checklists/security_ops').set({ a: 1 }));
  await assertSucceeds(db.doc('feedbackPins/p1').get());
  await assertSucceeds(db.doc('companies/dal').get());
});

test('auditLog: admin can read, nobody can write', async () => {
  const db = admin();
  await assertSucceeds(db.doc('auditLog/a1').get());
  await assertFails(db.collection('auditLog').add({ type: 'sign_in' }));
  await assertFails(db.doc('auditLog/a1').update({ type: 'tampered' }));
  await assertFails(db.doc('auditLog/a1').delete());
});

test('rateLimits are server-only', async () => {
  await assertFails(admin().doc('rateLimits/k').set({ count: 0 }));
  await assertFails(anon().doc('rateLimits/k').get());
});

// ── Storage ────────────────────────────────────────────────────────────────
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

test('storage: anonymous cannot read or upload', async () => {
  const s = env.unauthenticatedContext().storage();
  await assertFails(s.ref('appLogos/logabode/logo').put(png, { contentType: 'image/png' }));
  await assertFails(s.ref('vault/logabode/doc.pdf').getDownloadURL());
});

test('storage: admin can upload allowed types to known folders only', async () => {
  const s = env.authenticatedContext('eddie-uid', ADMIN).storage();
  await assertSucceeds(s.ref('appLogos/logabode/logo').put(png, { contentType: 'image/png' }));
  await assertSucceeds(s.ref('vault/logabode/contract.pdf').put(png, { contentType: 'application/pdf' }));
  await assertFails(s.ref('vault/logabode/run.html').put(png, { contentType: 'text/html' }));
  await assertFails(s.ref('random/folder/file.png').put(png, { contentType: 'image/png' }));
});

test('storage: non-allowlisted account denied', async () => {
  const s = env.authenticatedContext('intruder', { email: 'intruder@example.com', email_verified: true }).storage();
  await assertFails(s.ref('appLogos/logabode/logo').put(png, { contentType: 'image/png' }));
});

test('sanity: rules files are deny-by-default', () => {
  const fsRules = fs.readFileSync('firestore.rules', 'utf8');
  assert.doesNotMatch(fsRules, /allow\s+read,\s*write:\s*if\s+true/);
  assert.doesNotMatch(fsRules, /request\.auth\s*!=\s*null\s*;/);
});
