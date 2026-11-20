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
const { writeAudit, writeAuditSafe } = require('./_lib/audit');
const { encryptField, decryptField, isConfigured } = require('./_lib/vaultCrypto');
const S = require('./_lib/vaultSchema');

const REVEAL_MAX_AGE = 5 * 60;
const EDIT_MAX_AGE = 15 * 60;
const HIDE_AFTER_SECONDS = 30;

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

function isAlreadyExists(e) {
  return e && (e.code === 6 || e.code === 'already-exists' || /ALREADY_EXISTS/.test(String(e.message)));
}

// Creates any missing company profile. create() fails if the doc exists, so two
// tabs racing here never overwrite each other or double-audit.
async function ensureCompanies(req, res) {
  const db = getMcDb();
  const created = [];
  for (const id of S.COMPANY_IDS) {
    const ref = db.collection('companies').doc(id);
    try {
      await ref.create({
        companyId: id,
        masked: { ein: null, documentNumber: null },
        ...S.newCompanyDoc(id),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (e) {
      if (isAlreadyExists(e)) continue;
      throw e;
    }
    created.push(id);
    await writeAuditSafe({ type: 'sensitive_create', actor: req.auth, target: `companies/${id}`, meta: { kind: 'company' } }, req);
  }
  return res.status(200).json({ ok: true, created });
}

// Secret-doc write: merge so fields not in this request keep their ciphertext.
function secretWrite(path, ciphertexts, clear = []) {
  const fields = { ...ciphertexts };
  for (const f of clear) fields[f] = FieldValue.delete();
  return { path, fields, updatedAt: FieldValue.serverTimestamp() };
}

async function upsertCompany(req, res) {
  requireRecentAuth(req.auth, EDIT_MAX_AGE);
  const data = validate(S.CompanySchema, parseJsonBody(req, { maxBytes: 64 * 1024 }));
  const clear = (data.clear || []).filter((f) => data[f] === undefined);
  const path = `companies/${data.companyId}`;
  const hasSecrets = S.SENSITIVE.company.some((f) => data[f] !== undefined) || clear.length > 0;
  if (hasSecrets) requireVaultKey();
  const { ciphertexts, masked } = sealFields(path, 'company', data);

  // Only fields the caller sent are written (partial update).
  const profile = {};
  for (const f of S.COMPANY_PROFILE_FIELDS) if (data[f] !== undefined) profile[f] = data[f];

  const db = getMcDb();
  const ref = db.doc(path);
  const secretRef = db.collection('vaultSecrets').doc(S.secretDocId(path));
  const changed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? snap.data() : {};
    // Only write (and audit) profile fields whose value actually changes.
    const diff = {};
    for (const [f, v] of Object.entries(profile)) if ((current[f] || '') !== v) diff[f] = v;
    const secretsChanged = Object.keys(ciphertexts).length > 0 || clear.length > 0;
    if (snap.exists && !Object.keys(diff).length && !secretsChanged) return { fields: [], secrets: [] };
    if (snap.exists) {
      const update = { ...diff, updatedAt: FieldValue.serverTimestamp() };
      for (const [f, m] of Object.entries(masked)) update[`masked.${f}`] = m;
      for (const f of clear) update[`masked.${f}`] = null;
      tx.update(ref, update);
    } else {
      tx.create(ref, {
        companyId: data.companyId,
        ...S.newCompanyDoc(data.companyId),
        ...profile,
        masked: { ein: null, documentNumber: null, ...masked },
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    if (secretsChanged) tx.set(secretRef, secretWrite(path, ciphertexts, clear), { merge: true });
    return { fields: Object.keys(snap.exists ? diff : profile), secrets: [...Object.keys(ciphertexts), ...clear] };
  });

  if (changed.fields.length || changed.secrets.length) {
    // Data is committed; a failed audit write is logged, not turned into a 500.
    await writeAuditSafe(
      {
        type: 'sensitive_update',
        actor: req.auth,
        target: path,
        meta: { kind: 'company', fieldsChanged: changed.fields, sensitiveFieldsChanged: changed.secrets },
      },
      req
    );
  }
  return res.status(200).json({ ok: true });
}

// One transaction per write: the record, its linked bank account and its
// secrets are read and written together, so a concurrent delete can't be undone
// by an in-flight edit, and a card can't link to an account being deleted.
async function upsertRecord(req, res, kind, schema) {
  requireRecentAuth(req.auth, EDIT_MAX_AGE);
  requireVaultKey();
  const data = validate(schema, parseJsonBody(req, { maxBytes: 32 * 1024 }));
  const db = getMcDb();
  const companyRef = db.collection('companies').doc(data.companyId);
  const col = companyRef.collection(kind);
  const isCreate = !data.id;
  const ref = isCreate ? col.doc() : col.doc(data.id);
  const path = `companies/${data.companyId}/${kind}/${ref.id}`;

  if (isCreate) {
    const missing = S.SENSITIVE[kind].filter((f) => data[f] === undefined);
    if (missing.length) throw new HttpError(400, `Required: ${missing.join(', ')}`);
  }

  const { ciphertexts, masked } = sealFields(path, kind, data);
  const doc = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === 'id' || S.SENSITIVE[kind].includes(k)) continue;
    doc[k] = v;
  }
  if (kind === 'creditCards') doc.linkedBankAccountId = data.linkedBankAccountId || null;
  if (kind === 'bankAccounts') {
    if (data.accountNumber !== undefined) doc.last4 = S.last4(data.accountNumber);
    if (data.routingNumber !== undefined) doc.routingLast4 = S.last4(data.routingNumber);
  }
  if (kind === 'creditCards' && data.cardNumber !== undefined) doc.last4 = S.last4(data.cardNumber);
  doc.updatedAt = FieldValue.serverTimestamp();

  await db.runTransaction(async (tx) => {
    const existing = isCreate ? null : await tx.get(ref);
    if (!isCreate && !existing.exists) throw new HttpError(404, 'Record not found');
    if (kind === 'creditCards' && doc.linkedBankAccountId) {
      const linked = await tx.get(companyRef.collection('bankAccounts').doc(doc.linkedBankAccountId));
      if (!linked.exists) throw new HttpError(400, 'Linked bank account not found for this company');
    }
    if (isCreate) {
      tx.create(ref, { ...doc, masked, createdAt: FieldValue.serverTimestamp() });
    } else {
      const update = { ...doc };
      // Dotted paths: masks for fields not sent this time are kept.
      for (const [f, m] of Object.entries(masked)) update[`masked.${f}`] = m;
      tx.update(ref, update);
    }
    if (Object.keys(ciphertexts).length) {
      tx.set(db.collection('vaultSecrets').doc(S.secretDocId(path)), secretWrite(path, ciphertexts), { merge: true });
    }
  });

  // Data is committed; a failed audit write is logged, not turned into a 500.
  await writeAuditSafe(
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
  const companyRef = db.collection('companies').doc(companyId);
  const ref = companyRef.collection(kind).doc(id);
  const path = `companies/${companyId}/${kind}/${id}`;

  const unlinked = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpError(404, 'Record not found');
    let cards = [];
    if (kind === 'bankAccounts') {
      const q = await tx.get(companyRef.collection('creditCards').where('linkedBankAccountId', '==', id));
      cards = q.docs;
    }
    tx.delete(ref);
    tx.delete(db.collection('vaultSecrets').doc(S.secretDocId(path)));
    cards.forEach((c) => tx.update(c.ref, { linkedBankAccountId: null, updatedAt: FieldValue.serverTimestamp() }));
    return cards.length;
  });
  await writeAuditSafe({ type: 'sensitive_delete', actor: req.auth, target: path, meta: { kind, cardsUnlinked: unlinked } }, req);
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
  return res.status(200).json({ ok: true, value, hideAfterSeconds: HIDE_AFTER_SECONDS });
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
module.exports.__test = { sealFields, secretWrite };
