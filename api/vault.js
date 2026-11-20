// Company vault API (Dream App Lab LLC + Zerbiq).
//
//   POST /api/vault/ensure-companies   create the two company profiles if missing
//   POST /api/vault/company            update a company profile (+ EIN / document number)
//   POST /api/vault/bank-account       create / update a bank account
//   POST /api/vault/credit-card        create / update a credit card
//   POST /api/vault/delete             delete a bank account or card
//   POST /api/vault/reveal             decrypt one field (reveal or copy)
//
// Sensitive values are encrypted here (AES-256-GCM, VAULT_ENCRYPTION_KEY) and
// stored as ciphertext in the server-only vaultSecrets collection. The
// client-readable docs hold only masked values / last 4 digits.
// Every change and every reveal/copy is written to auditLog.
// Reveal/copy require a sign-in within the last 5 minutes; edits within 15.

const { FieldValue } = require('firebase-admin/firestore');
const { getMcDb } = require('./_lib/firebaseAdmin');
const { withSecurity, HttpError, parseJsonBody, validate, requireRecentAuth } = require('./_lib/security');
const { writeAudit } = require('./_lib/audit');
const { encryptField, decryptField, isConfigured } = require('./_lib/vaultCrypto');
const S = require('./_lib/vaultSchema');

const REVEAL_MAX_AGE = 5 * 60;
const EDIT_MAX_AGE = 15 * 60;

function requireVaultKey() {
  if (!isConfigured()) throw new HttpError(503, 'Vault encryption is not configured on this deployment');
}

// Encrypt the provided sensitive fields for one record; returns
// { ciphertexts, masked, last4s } ready to write.
function sealFields(path, kind, data) {
  const ciphertexts = {};
  const masked = {};
  for (const field of S.SENSITIVE[kind]) {
    if (data[field] === undefined) continue;
    ciphertexts[field] = encryptField(String(data[field]), path, field);
    masked[field] = S.maskFor(field, data[field]);
  }
  return { ciphertexts, masked };
}

function publicFieldsOf(data, kind) {
  const out = { ...data };
  for (const f of S.SENSITIVE[kind]) delete out[f];
  delete out.clear;
  delete out.id;
  return out;
}

async function ensureCompanies(req, res) {
  const db = getMcDb();
  const created = [];
  for (const id of S.COMPANY_IDS) {
    const ref = db.collection('companies').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set({
        companyId: id,
        stateOfFormation: '',
        formationDate: '',
        registeredAgent: '',
        notes: '',
        masked: { ein: null, documentNumber: null },
        ...S.COMPANY_DEFAULTS[id],
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      created.push(id);
      await writeAudit({ type: 'sensitive_create', actor: req.auth, target: `companies/${id}`, meta: { kind: 'company' } }, req);
    }
  }
  return res.status(200).json({ ok: true, created });
}

async function upsertCompany(req, res) {
  requireRecentAuth(req.auth, EDIT_MAX_AGE);
  const data = validate(S.CompanySchema, parseJsonBody(req, { maxBytes: 64 * 1024 }));
  const path = `companies/${data.companyId}`;
  const hasSecrets = S.SENSITIVE.company.some((f) => data[f] !== undefined) || (data.clear && data.clear.length);
  if (hasSecrets) requireVaultKey();

  const db = getMcDb();
  const ref = db.doc(path);
  const secretRef = db.collection('vaultSecrets').doc(S.secretDocId(path));
  const { ciphertexts, masked } = sealFields(path, 'company', data);

  const pub = publicFieldsOf(data, 'company');
  const update = { ...pub, updatedAt: FieldValue.serverTimestamp() };
  for (const [f, m] of Object.entries(masked)) update[`masked.${f}`] = m;
  for (const f of data.clear || []) update[`masked.${f}`] = null;

  const batch = db.batch();
  const snap = await ref.get();
  if (!snap.exists) batch.set(ref, { createdAt: FieldValue.serverTimestamp(), masked: { ein: null, documentNumber: null } });
  batch.set(ref, flattenForSet(update), { merge: true });
  if (Object.keys(ciphertexts).length || (data.clear && data.clear.length)) {
    const secretUpdate = { path, updatedAt: FieldValue.serverTimestamp() };
    for (const [f, c] of Object.entries(ciphertexts)) secretUpdate[`fields.${f}`] = c;
    for (const f of data.clear || []) secretUpdate[`fields.${f}`] = FieldValue.delete();
    batch.set(secretRef, flattenForSet(secretUpdate), { merge: true });
  }
  await batch.commit();

  await writeAudit(
    {
      type: 'sensitive_update',
      actor: req.auth,
      target: path,
      meta: { kind: 'company', sensitiveFieldsChanged: [...Object.keys(ciphertexts), ...(data.clear || [])] },
    },
    req
  );
  return res.status(200).json({ ok: true });
}

// Firestore merge-set does not interpret dotted keys; convert them to nested maps.
function flattenForSet(update) {
  const out = {};
  for (const [k, v] of Object.entries(update)) {
    if (!k.includes('.')) {
      out[k] = v;
      continue;
    }
    const [a, b] = k.split('.');
    out[a] = { ...(out[a] || {}), [b]: v };
  }
  return out;
}

async function upsertRecord(req, res, kind, schema) {
  requireRecentAuth(req.auth, EDIT_MAX_AGE);
  requireVaultKey();
  const data = validate(schema, parseJsonBody(req, { maxBytes: 32 * 1024 }));
  const db = getMcDb();
  const col = db.collection('companies').doc(data.companyId).collection(kind);
  const isCreate = !data.id;
  const ref = isCreate ? col.doc() : col.doc(data.id);
  const path = `companies/${data.companyId}/${kind}/${ref.id}`;

  if (isCreate) {
    const missing = S.SENSITIVE[kind].filter((f) => data[f] === undefined);
    if (missing.length) throw new HttpError(400, `Required: ${missing.join(', ')}`);
  } else {
    const existing = await ref.get();
    if (!existing.exists) throw new HttpError(404, 'Record not found');
  }

  if (kind === 'creditCards' && data.linkedBankAccountId) {
    const linked = await db.collection('companies').doc(data.companyId).collection('bankAccounts').doc(data.linkedBankAccountId).get();
    if (!linked.exists) throw new HttpError(400, 'Linked bank account not found for this company');
  }

  const { ciphertexts, masked } = sealFields(path, kind, data);
  const pub = publicFieldsOf(data, kind);
  if (kind === 'creditCards') pub.linkedBankAccountId = data.linkedBankAccountId || null;
  const doc = { ...pub, companyId: data.companyId, updatedAt: FieldValue.serverTimestamp() };
  if (Object.keys(masked).length) doc.masked = masked;
  if (kind === 'bankAccounts') {
    if (data.accountNumber !== undefined) doc.last4 = S.last4(data.accountNumber);
    if (data.routingNumber !== undefined) doc.routingLast4 = S.last4(data.routingNumber);
  }
  if (kind === 'creditCards' && data.cardNumber !== undefined) doc.last4 = S.last4(data.cardNumber);
  if (isCreate) doc.createdAt = FieldValue.serverTimestamp();

  const batch = db.batch();
  batch.set(ref, doc, { merge: true });
  if (Object.keys(ciphertexts).length) {
    batch.set(
      db.collection('vaultSecrets').doc(S.secretDocId(path)),
      { path, fields: ciphertexts, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  }
  await batch.commit();

  await writeAudit(
    {
      type: isCreate ? 'sensitive_create' : 'sensitive_update',
      actor: req.auth,
      target: path,
      meta: { kind, sensitiveFieldsChanged: Object.keys(ciphertexts) },
    },
    req
  );
  return res.status(200).json({ ok: true, id: ref.id });
}

async function deleteRecord(req, res) {
  requireRecentAuth(req.auth, EDIT_MAX_AGE);
  const { companyId, kind, id } = validate(S.DeleteSchema, parseJsonBody(req));
  const db = getMcDb();
  const ref = db.collection('companies').doc(companyId).collection(kind).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, 'Record not found');
  const path = `companies/${companyId}/${kind}/${id}`;

  const batch = db.batch();
  batch.delete(ref);
  batch.delete(db.collection('vaultSecrets').doc(S.secretDocId(path)));
  let unlinked = 0;
  if (kind === 'bankAccounts') {
    const cards = await db.collection('companies').doc(companyId).collection('creditCards').where('linkedBankAccountId', '==', id).get();
    cards.docs.forEach((c) => {
      batch.set(c.ref, { linkedBankAccountId: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      unlinked += 1;
    });
  }
  await batch.commit();
  await writeAudit({ type: 'sensitive_delete', actor: req.auth, target: path, meta: { kind, cardsUnlinked: unlinked } }, req);
  return res.status(200).json({ ok: true });
}

async function reveal(req, res) {
  requireRecentAuth(req.auth, REVEAL_MAX_AGE);
  requireVaultKey();
  const { path, field, action } = validate(S.RevealSchema, parseJsonBody(req));
  const db = getMcDb();
  const record = await db.doc(path).get();
  if (!record.exists) throw new HttpError(404, 'Record not found');
  const secret = await db.collection('vaultSecrets').doc(S.secretDocId(path)).get();
  const token = secret.exists && secret.data().fields ? secret.data().fields[field] : null;
  if (!token) throw new HttpError(404, 'No value saved for this field');
  let value;
  try {
    value = decryptField(token, path, field);
  } catch (e) {
    console.error('[vault] decrypt failed for', path, field);
    throw new HttpError(500, 'Could not decrypt this value');
  }
  // Audit BEFORE returning the plaintext: no audit entry, no reveal.
  await writeAudit({ type: action === 'copy' ? 'vault_copy' : 'vault_reveal', actor: req.auth, target: path, meta: { field } }, req);
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.status(200).json({ ok: true, value, hideAfterSeconds: 30 });
}

const ROUTES = {
  'ensure-companies': ensureCompanies,
  company: upsertCompany,
  'bank-account': (req, res) => upsertRecord(req, res, 'bankAccounts', S.BankAccountSchema),
  'credit-card': (req, res) => upsertRecord(req, res, 'creditCards', S.CreditCardSchema),
  delete: deleteRecord,
  reveal,
};

async function router(req, res) {
  const path = String(req.url || '').split('?')[0];
  const sub = path.split('/').filter(Boolean).pop() || '';
  const fn = Object.prototype.hasOwnProperty.call(ROUTES, sub) ? ROUTES[sub] : null;
  if (!fn) return res.status(404).json({ error: 'Not found' });
  return fn(req, res);
}

module.exports = withSecurity(
  { name: 'vault', methods: ['POST'], auth: 'admin', rateLimit: { limit: 60, windowMs: 60_000 } },
  router
);
module.exports.__test = { flattenForSet, sealFields };
