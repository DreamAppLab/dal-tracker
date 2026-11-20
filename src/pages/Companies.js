// Companies — vault for Dream App Lab LLC and Zerbiq: company profile,
// bank accounts and credit cards.
//
// Security model:
//  - This page only ever reads masked values / last-4 from Firestore.
//  - Saving sends sensitive values to /api/vault, which encrypts them server-side.
//  - Reveal / Copy require a sign-in within the last 5 minutes, are written to
//    the audit log by the server, and revealed values auto-hide after 30 seconds.
//  - CVV, PIN and online-banking passwords are never collected.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { apiJson } from '../lib/apiClient';
import { useRecentAuth } from '../contexts/ReauthContext';

const COMPANIES = [
  { id: 'dal', label: 'Dream App Lab LLC' },
  { id: 'zerbiq', label: 'Zerbiq' },
];
const REVEAL_MAX_AGE = 5 * 60;
const EDIT_MAX_AGE = 15 * 60;
const HIDE_AFTER_SECONDS = 30;
const ACCOUNT_TYPES = ['Checking', 'Savings', 'Money Market', 'Other'];

const PROFILE_FIELDS = [
  ['legalName', 'Legal name'],
  ['dba', 'DBA'],
  ['entityType', 'Entity type'],
  ['stateOfFormation', 'State of formation'],
  ['formationDate', 'Formation date'],
  ['registeredAgent', 'Registered agent'],
  ['businessAddress', 'Business address'],
  ['phone', 'Phone'],
  ['website', 'Website'],
];

function formatDate(v) {
  if (!v) return '—';
  const d = new Date(`${v}T12:00:00`);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function errorText(e) {
  if (e && e.code === 'reauth-cancelled') return null;
  return (e && e.message) || 'Something went wrong';
}

// ── Masked sensitive value with Reveal / Copy ──────────────────────────────
function SecretValue({ path, field, masked, label }) {
  const { requireRecentAuth } = useRecentAuth();
  const [value, setValue] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState(null); // 'reveal' | 'copy'
  const [note, setNote] = useState('');
  const timerRef = useRef(null);

  const hide = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setValue(null);
    setSecondsLeft(0);
  }, []);

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') hide();
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [hide]);

  const fetchValue = async (action) => {
    await requireRecentAuth(REVEAL_MAX_AGE);
    const data = await apiJson('/api/vault/reveal', { method: 'POST', body: { path, field, action } });
    return data.value;
  };

  const onReveal = async () => {
    if (value) return hide();
    setBusy('reveal');
    setNote('');
    try {
      const v = await fetchValue('reveal');
      setValue(v);
      setSecondsLeft(HIDE_AFTER_SECONDS);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setSecondsLeft((s) => {
          if (s <= 1) {
            hide();
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    } catch (e) {
      const t = errorText(e);
      if (t) setNote(t);
    } finally {
      setBusy(null);
    }
  };

  const onCopy = async () => {
    setBusy('copy');
    setNote('');
    try {
      const v = await fetchValue('copy');
      await navigator.clipboard.writeText(v);
      setNote('Copied');
      setTimeout(() => setNote(''), 2500);
    } catch (e) {
      const t = errorText(e);
      if (t) setNote(t);
    } finally {
      setBusy(null);
    }
  };

  if (!masked) return <span className="vault-muted">Not saved</span>;

  return (
    <span className="vault-secret">
      <span className={`vault-secret-value ${value ? 'revealed' : ''}`} aria-live="polite">
        {value || masked}
      </span>
      <span className="vault-secret-actions">
        <button type="button" className="btn btn-secondary btn-sm vault-btn" onClick={onReveal} disabled={!!busy} aria-label={`${value ? 'Hide' : 'Reveal'} ${label}`}>
          {busy === 'reveal' ? '…' : value ? `Hide (${secondsLeft}s)` : 'Reveal'}
        </button>
        <button type="button" className="btn btn-secondary btn-sm vault-btn" onClick={onCopy} disabled={!!busy} aria-label={`Copy ${label}`}>
          {busy === 'copy' ? '…' : 'Copy'}
        </button>
      </span>
      {note && <span className={`vault-note ${note === 'Copied' ? 'ok' : 'err'}`}>{note}</span>}
    </span>
  );
}

// ── Modal shell ─────────────────────────────────────────────────────────────
function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal vault-modal">
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-footer">{footer}</div>
      </div>
    </div>
  );
}

function Field({ label, children, hint, wide }) {
  return (
    <div className={`form-group ${wide ? 'vault-wide' : ''}`}>
      <label className="form-label">{label}</label>
      {children}
      {hint && <div className="vault-hint">{hint}</div>}
    </div>
  );
}

// ── Edit company profile ─────────────────────────────────────────────────────
function CompanyForm({ company, onClose }) {
  const { requireRecentAuth } = useRecentAuth();
  const [form, setForm] = useState(() => {
    const f = {};
    PROFILE_FIELDS.forEach(([k]) => { f[k] = company[k] || ''; });
    f.notes = company.notes || '';
    f.ein = '';
    f.documentNumber = '';
    return f;
  });
  const [clear, setClear] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await requireRecentAuth(EDIT_MAX_AGE);
      const body = { companyId: company.companyId };
      PROFILE_FIELDS.forEach(([k]) => { body[k] = form[k]; });
      body.notes = form.notes;
      if (form.ein.trim()) body.ein = form.ein;
      if (form.documentNumber.trim()) body.documentNumber = form.documentNumber;
      const toClear = clear.filter((f) => !form[f].trim());
      if (toClear.length) body.clear = toClear;
      await apiJson('/api/vault/company', { method: 'POST', body });
      setForm((p) => ({ ...p, ein: '', documentNumber: '' }));
      onClose();
    } catch (e) {
      const t = errorText(e);
      if (t) setError(t);
    } finally {
      setSaving(false);
    }
  };

  const secretInput = (key, label, masked, placeholder) => (
    <Field
      label={label}
      hint={masked ? (
        <>
          Saved: {masked}. Leave blank to keep.{' '}
          <label className="vault-clear">
            <input type="checkbox" checked={clear.includes(key)} onChange={(e) => setClear((c) => (e.target.checked ? [...c, key] : c.filter((x) => x !== key)))} />
            Remove saved value
          </label>
        </>
      ) : 'Encrypted when saved.'}
    >
      <input className="form-input vault-mono" value={form[key]} onChange={set(key)} placeholder={placeholder} autoComplete="off" spellCheck="false" />
    </Field>
  );

  return (
    <Modal
      title={`Edit ${company.legalName || 'company'}`}
      onClose={onClose}
      footer={(
        <>
          {error && <span className="vault-form-error">{error}</span>}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !form.legalName.trim()}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      )}
    >
      <div className="form-grid">
        {PROFILE_FIELDS.map(([k, label]) => (
          <Field key={k} label={label} wide={k === 'businessAddress' || k === 'registeredAgent'}>
            <input className="form-input" type={k === 'formationDate' ? 'date' : 'text'} value={form[k]} onChange={set(k)} />
          </Field>
        ))}
        {secretInput('ein', 'EIN', company.masked && company.masked.ein, '12-3456789')}
        {secretInput('documentNumber', 'LLC / document number', company.masked && company.masked.documentNumber, 'L23000123456')}
        <Field label="Notes" wide>
          <textarea className="form-textarea" value={form.notes} onChange={set('notes')} />
        </Field>
      </div>
    </Modal>
  );
}

// ── Add / edit bank account ──────────────────────────────────────────────────
function BankForm({ companyId, account, onClose }) {
  const { requireRecentAuth } = useRecentAuth();
  const isEdit = !!account;
  const [form, setForm] = useState({
    bankName: account ? account.bankName || '' : '',
    nickname: account ? account.nickname || '' : '',
    accountType: account ? account.accountType || 'Checking' : 'Checking',
    openingDate: account ? account.openingDate || '' : '',
    routingNumber: '',
    accountNumber: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await requireRecentAuth(EDIT_MAX_AGE);
      const body = { companyId, bankName: form.bankName, nickname: form.nickname, accountType: form.accountType, openingDate: form.openingDate };
      if (isEdit) body.id = account.id;
      if (form.routingNumber.trim()) body.routingNumber = form.routingNumber;
      if (form.accountNumber.trim()) body.accountNumber = form.accountNumber;
      await apiJson('/api/vault/bank-account', { method: 'POST', body });
      setForm((p) => ({ ...p, routingNumber: '', accountNumber: '' }));
      onClose();
    } catch (e) {
      const t = errorText(e);
      if (t) setError(t);
    } finally {
      setSaving(false);
    }
  };

  const ready = form.bankName.trim() && form.nickname.trim() && (isEdit || (form.routingNumber.trim() && form.accountNumber.trim()));

  return (
    <Modal
      title={isEdit ? `Edit ${account.nickname}` : 'Add bank account'}
      onClose={onClose}
      footer={(
        <>
          {error && <span className="vault-form-error">{error}</span>}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !ready}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      )}
    >
      <div className="form-grid">
        <Field label="Bank name"><input className="form-input" value={form.bankName} onChange={set('bankName')} /></Field>
        <Field label="Nickname"><input className="form-input" value={form.nickname} onChange={set('nickname')} placeholder="Operating checking" /></Field>
        <Field label="Account type">
          <select className="form-select" value={form.accountType} onChange={set('accountType')}>
            {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Opening date"><input className="form-input" type="date" value={form.openingDate} onChange={set('openingDate')} /></Field>
        <Field label="Routing number" hint={isEdit ? `Saved: ${account.masked && account.masked.routingNumber}. Leave blank to keep.` : 'Encrypted when saved.'}>
          <input className="form-input vault-mono" inputMode="numeric" autoComplete="off" value={form.routingNumber} onChange={set('routingNumber')} />
        </Field>
        <Field label="Account number" hint={isEdit ? `Saved: ${account.masked && account.masked.accountNumber}. Leave blank to keep.` : 'Encrypted when saved.'}>
          <input className="form-input vault-mono" inputMode="numeric" autoComplete="off" value={form.accountNumber} onChange={set('accountNumber')} />
        </Field>
      </div>
      <p className="vault-hint">Online-banking usernames and passwords are never stored here.</p>
    </Modal>
  );
}

// ── Add / edit credit card ───────────────────────────────────────────────────
function CardForm({ companyId, card, bankAccounts, onClose }) {
  const { requireRecentAuth } = useRecentAuth();
  const isEdit = !!card;
  const [form, setForm] = useState({
    issuer: card ? card.issuer || '' : '',
    nickname: card ? card.nickname || '' : '',
    cardholder: card ? card.cardholder || '' : '',
    expiry: card ? card.expiry || '' : '',
    linkedBankAccountId: card ? card.linkedBankAccountId || '' : '',
    cardNumber: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const onExpiry = (e) => {
    let v = e.target.value.replace(/[^\d]/g, '').slice(0, 4);
    if (v.length > 2) v = `${v.slice(0, 2)}/${v.slice(2)}`;
    setForm((p) => ({ ...p, expiry: v }));
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await requireRecentAuth(EDIT_MAX_AGE);
      const body = {
        companyId,
        issuer: form.issuer,
        nickname: form.nickname,
        cardholder: form.cardholder,
        expiry: form.expiry,
        linkedBankAccountId: form.linkedBankAccountId || null,
      };
      if (isEdit) body.id = card.id;
      if (form.cardNumber.trim()) body.cardNumber = form.cardNumber;
      await apiJson('/api/vault/credit-card', { method: 'POST', body });
      setForm((p) => ({ ...p, cardNumber: '' }));
      onClose();
    } catch (e) {
      const t = errorText(e);
      if (t) setError(t);
    } finally {
      setSaving(false);
    }
  };

  const ready = form.issuer.trim() && form.nickname.trim() && form.cardholder.trim() && /^\d{2}\/\d{2}$/.test(form.expiry) && (isEdit || form.cardNumber.trim());

  return (
    <Modal
      title={isEdit ? `Edit ${card.nickname}` : 'Add credit card'}
      onClose={onClose}
      footer={(
        <>
          {error && <span className="vault-form-error">{error}</span>}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !ready}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      )}
    >
      <div className="form-grid">
        <Field label="Issuer"><input className="form-input" value={form.issuer} onChange={set('issuer')} placeholder="Capital One" /></Field>
        <Field label="Nickname"><input className="form-input" value={form.nickname} onChange={set('nickname')} placeholder="Spark Cash" /></Field>
        <Field label="Cardholder"><input className="form-input" value={form.cardholder} onChange={set('cardholder')} /></Field>
        <Field label="Expiry (MM/YY)"><input className="form-input vault-mono" inputMode="numeric" value={form.expiry} onChange={onExpiry} placeholder="08/29" /></Field>
        <Field label="Card number" wide hint={isEdit ? `Saved: ${card.masked && card.masked.cardNumber}. Leave blank to keep.` : 'Encrypted when saved. Last 4 shown everywhere else.'}>
          <input className="form-input vault-mono" inputMode="numeric" autoComplete="off" value={form.cardNumber} onChange={set('cardNumber')} />
        </Field>
        <Field label="Linked bank account" wide>
          <select className="form-select" value={form.linkedBankAccountId} onChange={set('linkedBankAccountId')}>
            <option value="">— None —</option>
            {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.nickname} (•••• {a.last4})</option>)}
          </select>
        </Field>
      </div>
      <p className="vault-hint">CVV and PIN are never stored.</p>
    </Modal>
  );
}

function ConfirmDelete({ label, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal
      title="Delete record"
      onClose={onCancel}
      footer={(
        <>
          {error && <span className="vault-form-error">{error}</span>}
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await onConfirm();
              } catch (e) {
                const t = errorText(e);
                if (t) setError(t);
                setBusy(false);
              }
            }}
          >
            {busy ? 'Deleting…' : 'Delete permanently'}
          </button>
        </>
      )}
    >
      <p className="vault-text">Delete <strong>{label}</strong> and its encrypted numbers? This can’t be undone and is recorded in the audit log.</p>
    </Modal>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function Companies() {
  const { requireRecentAuth } = useRecentAuth();
  const [companyId, setCompanyId] = useState('dal');
  const [companies, setCompanies] = useState({});
  const [banks, setBanks] = useState([]);
  const [cards, setCards] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [modal, setModal] = useState(null); // {type, record?}

  useEffect(() => {
    apiJson('/api/vault/ensure-companies', { method: 'POST' }).catch((e) => setLoadError(errorText(e) || ''));
    const unsubs = COMPANIES.map((c) =>
      onSnapshot(
        doc(db, 'companies', c.id),
        (snap) => setCompanies((prev) => ({ ...prev, [c.id]: snap.exists() ? { companyId: c.id, ...snap.data() } : null })),
        (e) => setLoadError(e.message)
      )
    );
    return () => unsubs.forEach((u) => u());
  }, []);

  useEffect(() => {
    const byNick = (a, b) => String(a.nickname || '').localeCompare(String(b.nickname || ''), undefined, { sensitivity: 'base' });
    const u1 = onSnapshot(collection(db, 'companies', companyId, 'bankAccounts'), (s) => setBanks(s.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byNick)), (e) => setLoadError(e.message));
    const u2 = onSnapshot(collection(db, 'companies', companyId, 'creditCards'), (s) => setCards(s.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byNick)), (e) => setLoadError(e.message));
    return () => { u1(); u2(); };
  }, [companyId]);

  const company = companies[companyId];
  const bankById = useMemo(() => Object.fromEntries(banks.map((b) => [b.id, b])), [banks]);
  const close = useCallback(() => setModal(null), []);

  const doDelete = async (kind, record) => {
    await requireRecentAuth(EDIT_MAX_AGE);
    await apiJson('/api/vault/delete', { method: 'POST', body: { companyId, kind, id: record.id } });
    setModal(null);
  };

  return (
    <div className="page vault-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Companies</h1>
          <p className="page-subtitle">Company records, bank accounts and cards. Numbers are encrypted; every reveal and copy is logged.</p>
        </div>
      </div>

      <div className="vault-switcher" role="tablist" aria-label="Company">
        {COMPANIES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={companyId === c.id}
            className={`vault-switch ${companyId === c.id ? 'active' : ''}`}
            onClick={() => setCompanyId(c.id)}
          >
            {(companies[c.id] && companies[c.id].legalName) || c.label}
          </button>
        ))}
      </div>

      {loadError && <div className="vault-alert">{loadError}</div>}

      {!company ? (
        <div className="empty-state"><div className="empty-state-text">Loading company…</div></div>
      ) : (
        <>
          <section className="vault-card">
            <div className="vault-card-header">
              <h2 className="section-title">Company profile</h2>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setModal({ type: 'company' })}>Edit</button>
            </div>
            <dl className="vault-grid">
              {PROFILE_FIELDS.map(([k, label]) => (
                <div className="vault-row" key={k}>
                  <dt>{label}</dt>
                  <dd>{k === 'formationDate' ? formatDate(company[k]) : company[k] || '—'}</dd>
                </div>
              ))}
              <div className="vault-row">
                <dt>EIN</dt>
                <dd><SecretValue path={`companies/${companyId}`} field="ein" label="EIN" masked={company.masked && company.masked.ein} /></dd>
              </div>
              <div className="vault-row">
                <dt>LLC / document number</dt>
                <dd><SecretValue path={`companies/${companyId}`} field="documentNumber" label="document number" masked={company.masked && company.masked.documentNumber} /></dd>
              </div>
              {company.notes && (
                <div className="vault-row vault-row-wide">
                  <dt>Notes</dt>
                  <dd className="vault-notes">{company.notes}</dd>
                </div>
              )}
            </dl>
          </section>

          <section className="vault-card">
            <div className="vault-card-header">
              <h2 className="section-title">Bank accounts <span className="vault-count">{banks.length}</span></h2>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setModal({ type: 'bank' })}>+ Add account</button>
            </div>
            {banks.length === 0 ? (
              <p className="vault-empty">No bank accounts yet.</p>
            ) : (
              <div className="vault-table-wrap">
                <table className="vault-table">
                  <thead>
                    <tr>
                      <th>Nickname</th><th>Bank</th><th>Type</th><th>Routing</th><th>Account</th><th>Opened</th><th className="vault-col-actions" aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {banks.map((a) => {
                      const path = `companies/${companyId}/bankAccounts/${a.id}`;
                      return (
                        <tr key={a.id}>
                          <td className="vault-strong">{a.nickname}</td>
                          <td>{a.bankName}</td>
                          <td>{a.accountType}</td>
                          <td><SecretValue path={path} field="routingNumber" label="routing number" masked={a.masked && a.masked.routingNumber} /></td>
                          <td><SecretValue path={path} field="accountNumber" label="account number" masked={a.masked && a.masked.accountNumber} /></td>
                          <td className="vault-nowrap">{formatDate(a.openingDate)}</td>
                          <td className="vault-col-actions">
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModal({ type: 'bank', record: a })}>Edit</button>
                            <button type="button" className="btn btn-ghost btn-sm vault-danger" onClick={() => setModal({ type: 'delete-bank', record: a })}>Delete</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="vault-card">
            <div className="vault-card-header">
              <h2 className="section-title">Credit cards <span className="vault-count">{cards.length}</span></h2>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setModal({ type: 'card' })}>+ Add card</button>
            </div>
            {cards.length === 0 ? (
              <p className="vault-empty">No credit cards yet.</p>
            ) : (
              <div className="vault-table-wrap">
                <table className="vault-table">
                  <thead>
                    <tr>
                      <th>Nickname</th><th>Issuer</th><th>Cardholder</th><th>Card number</th><th>Expiry</th><th>Linked account</th><th className="vault-col-actions" aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {cards.map((c) => {
                      const linked = c.linkedBankAccountId ? bankById[c.linkedBankAccountId] : null;
                      return (
                        <tr key={c.id}>
                          <td className="vault-strong">{c.nickname}</td>
                          <td>{c.issuer}</td>
                          <td>{c.cardholder}</td>
                          <td><SecretValue path={`companies/${companyId}/creditCards/${c.id}`} field="cardNumber" label="card number" masked={c.masked && c.masked.cardNumber} /></td>
                          <td className="vault-mono vault-nowrap">{c.expiry}</td>
                          <td>{linked ? `${linked.nickname} (•••• ${linked.last4})` : '—'}</td>
                          <td className="vault-col-actions">
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModal({ type: 'card', record: c })}>Edit</button>
                            <button type="button" className="btn btn-ghost btn-sm vault-danger" onClick={() => setModal({ type: 'delete-card', record: c })}>Delete</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {modal && modal.type === 'company' && company && <CompanyForm company={company} onClose={close} />}
      {modal && modal.type === 'bank' && <BankForm companyId={companyId} account={modal.record} onClose={close} />}
      {modal && modal.type === 'card' && <CardForm companyId={companyId} card={modal.record} bankAccounts={banks} onClose={close} />}
      {modal && modal.type === 'delete-bank' && (
        <ConfirmDelete label={modal.record.nickname} onCancel={close} onConfirm={() => doDelete('bankAccounts', modal.record)} />
      )}
      {modal && modal.type === 'delete-card' && (
        <ConfirmDelete label={modal.record.nickname} onCancel={close} onConfirm={() => doDelete('creditCards', modal.record)} />
      )}
    </div>
  );
}
