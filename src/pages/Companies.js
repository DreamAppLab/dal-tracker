// Companies — vault for Dream App Lab LLC and Zerbiq: company profile,
// bank accounts and credit cards.
//
// Security model:
//  - This page only ever reads masked values / last-4 from Firestore.
//  - Saving sends sensitive values to /api/vault, which encrypts them server-side.
//  - Reveal / Copy require a sign-in within the last 5 minutes, are written to
//    the audit log by the server, and revealed values auto-hide after 30 seconds.
//  - CVV, PIN and online-banking passwords are never collected.

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
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

// ── Clipboard: copied numbers are cleared after 30 seconds ─────────────────
// Browsers only allow writing the clipboard while this tab has focus. So the
// clear runs at 30 s if the tab is focused; otherwise it runs as soon as the
// tab is focused again, and a banner offers "Clear clipboard now" (a click is
// always allowed; Firefox/Safari allow clipboard writes only on a click, so
// there the banner is the way to clear). Closing the tab first leaves the value
// on the clipboard; the banner says so.
const clip = { value: null, gen: 0, doneGen: 0, timer: null, due: false, writing: 0, listeners: new Set() };
const emitClip = () => clip.listeners.forEach((fn) => fn());

async function clearClipboard(fromClick = false) {
  if (!clip.value || clip.writing > 0) return;
  const gen = clip.gen;
  try {
    if (!fromClick && navigator.permissions && navigator.clipboard.readText) {
      const perm = await navigator.permissions.query({ name: 'clipboard-read' }).catch(() => null);
      if (perm && perm.state === 'granted') {
        const current = await navigator.clipboard.readText();
        if (gen !== clip.gen || clip.writing > 0) return; // a newer copy started meanwhile
        if (current !== clip.value) {
          // Something else was copied since; leave it alone.
          clip.value = null;
          clip.due = false;
          emitClip();
          return;
        }
      }
    }
    if (gen !== clip.gen || clip.writing > 0) return;
    await navigator.clipboard.writeText('');
    if (gen !== clip.gen) return;
    clip.value = null;
    clip.due = false;
  } catch {
    if (gen !== clip.gen) return; // a stale clear failing must not flag a newer copy
    clip.due = true; // not focused or no user gesture: retry on focus / show banner
  }
  emitClip();
}

if (typeof window !== 'undefined') {
  const retry = () => {
    if (clip.due && document.visibilityState !== 'hidden') clearClipboard();
  };
  window.addEventListener('focus', retry);
  document.addEventListener('visibilitychange', retry);
}

function scheduleClear(seconds) {
  clearTimeout(clip.timer);
  clip.timer = setTimeout(() => {
    clip.timer = null;
    clip.due = true;
    clearClipboard();
  }, seconds * 1000);
}

// The generation is bumped and the old timer cancelled BEFORE the write, and
// clears are blocked while any write is in flight, so an older copy's clear can
// never land after (and wipe) a newer value. The newest write that actually
// succeeded is the one tracked for clearing; if a newer write fails, the value
// still on the clipboard gets a fresh clear timer.
export async function copySensitive(value, clearAfterSeconds) {
  const g = ++clip.gen;
  clearTimeout(clip.timer);
  clip.timer = null;
  clip.writing += 1;
  try {
    await navigator.clipboard.writeText(value);
  } catch (e) {
    clip.writing -= 1;
    if (clip.value && !clip.timer) scheduleClear(clearAfterSeconds);
    // Browsers report this in technical terms ("Write permission denied").
    throw Object.assign(new Error('This browser blocked copying, so nothing was copied. Use Reveal instead.'), { code: 'clipboard_blocked', cause: e });
  }
  clip.writing -= 1;
  if (g > clip.doneGen) {
    clip.doneGen = g;
    clip.value = value;
    clip.due = false;
  }
  if (clip.value && !clip.timer) scheduleClear(clearAfterSeconds);
  else if (g === clip.doneGen) scheduleClear(clearAfterSeconds);
  emitClip();
}

function useClipboardPending() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    clip.listeners.add(fn);
    return () => clip.listeners.delete(fn);
  }, []);
  return !!clip.value && clip.due;
}

function ClipboardNotice() {
  const pending = useClipboardPending();
  if (!pending) return null;
  return (
    <div className="vault-alert vault-clip-notice" role="alert">
      <span>A copied number is still on your clipboard. Clear it before closing this tab.</span>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => clearClipboard(true)}>Clear clipboard now</button>
    </div>
  );
}

// ── Masked sensitive value with Reveal / Copy ──────────────────────────────
// Render with key={`${path}|${field}`} so state never carries over to another record.
function SecretValue({ path, field, masked, label }) {
  const genRef = useRef(0); // bumped on hide/unmount: late responses are dropped
  const mountedRef = useRef(true);
  const { requireRecentAuth } = useRecentAuth();
  const [value, setValue] = useState(null);
  const [deadline, setDeadline] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(null); // 'reveal' | 'copy'
  const [note, setNote] = useState(null); // { text, ok }
  const hideTimer = useRef(null);
  const tickTimer = useRef(null);
  const noteTimer = useRef(null);

  const hide = useCallback(() => {
    genRef.current += 1;
    clearTimeout(hideTimer.current);
    clearInterval(tickTimer.current);
    hideTimer.current = null;
    tickTimer.current = null;
    setValue(null);
    setDeadline(0);
  }, []);

  const flash = useCallback((text, ok, ms = 4000) => {
    clearTimeout(noteTimer.current);
    setNote({ text, ok });
    noteTimer.current = setTimeout(() => setNote(null), ms);
  }, []);

  // Hide when the tab is hidden, and on unmount.
  useEffect(() => {
    const onVis = () => document.visibilityState === 'hidden' && hide();
    document.addEventListener('visibilitychange', onVis);
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      genRef.current += 1;
      document.removeEventListener('visibilitychange', onVis);
      clearTimeout(hideTimer.current);
      clearInterval(tickTimer.current);
      clearTimeout(noteTimer.current);
    };
  }, [hide]);

  // A saved value changed underneath a revealed one: hide the stale plaintext.
  useEffect(() => hide(), [path, field, masked, hide]);

  const fetchValue = async (action) => {
    await requireRecentAuth(REVEAL_MAX_AGE);
    const data = await apiJson('/api/vault/reveal', { method: 'POST', body: { path, field, action } });
    const secs = Number(data.hideAfterSeconds) > 0 ? Math.min(Number(data.hideAfterSeconds), HIDE_AFTER_SECONDS) : HIDE_AFTER_SECONDS;
    return { v: data.value, secs };
  };

  const onReveal = async () => {
    if (value) return hide();
    const gen = genRef.current;
    setBusy('reveal');
    setNote(null);
    try {
      const { v, secs } = await fetchValue('reveal');
      if (gen !== genRef.current) return; // hidden, tab switched or unmounted meanwhile
      const until = Date.now() + secs * 1000;
      setValue(v);
      setDeadline(until);
      setNow(Date.now());
      clearTimeout(hideTimer.current);
      clearInterval(tickTimer.current);
      hideTimer.current = setTimeout(hide, secs * 1000);
      tickTimer.current = setInterval(() => setNow(Date.now()), 250);
    } catch (e) {
      const t = errorText(e);
      if (t && gen === genRef.current) flash(t, false);
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  const onCopy = async () => {
    const gen = genRef.current;
    setBusy('copy');
    setNote(null);
    try {
      const { v, secs } = await fetchValue('copy');
      if (gen !== genRef.current) {
        // Hidden, record changed or unmounted: don't copy a possibly stale value.
        if (mountedRef.current) flash('Copy cancelled — try again', false);
        return;
      }
      await copySensitive(v, secs);
      if (gen === genRef.current) flash(`Copied · clipboard clears in ${secs}s`, true, 3500);
    } catch (e) {
      const t = errorText(e);
      if (t && gen === genRef.current) flash(t, false);
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  if (!masked) return <span className="vault-muted">Not saved</span>;
  const secondsLeft = value ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;

  return (
    <span className="vault-secret">
      <span className={`vault-secret-value ${value ? 'revealed' : ''}`} aria-live="polite">
        {value || masked}
      </span>
      <span className="vault-secret-actions">
        <button type="button" className="btn btn-secondary btn-sm vault-btn vault-btn-reveal" onClick={onReveal} disabled={!!busy} aria-label={`${value ? 'Hide' : 'Reveal'} ${label}`}>
          {busy === 'reveal' ? '…' : value ? `Hide · ${secondsLeft}s` : 'Reveal'}
        </button>
        <button type="button" className="btn btn-secondary btn-sm vault-btn" onClick={onCopy} disabled={!!busy} aria-label={`Copy ${label}`}>
          {busy === 'copy' ? '…' : 'Copy'}
        </button>
      </span>
      {note && <span className={`vault-note ${note.ok ? 'ok' : 'err'}`} role="status">{note.text}</span>}
    </span>
  );
}

// ── Modal shell ─────────────────────────────────────────────────────────────
// Escape closes unless locked (saving, or the "Confirm it's you" dialog is open).
// No backdrop-click close: a stray click must never throw away a typed form.
// Focus moves into the dialog, Tab is trapped, and focus returns on close.
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Modal({ title, onClose, children, footer, locked = false }) {
  const { isConfirming } = useRecentAuth();
  const isLocked = locked || isConfirming;
  const ref = useRef(null);
  const titleId = useId();
  const lockedRef = useRef(isLocked);
  lockedRef.current = isLocked;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const confirmingRef = useRef(isConfirming);
  confirmingRef.current = isConfirming;

  useEffect(() => {
    const opener = document.activeElement;
    const node = ref.current;
    const body = node && node.querySelector('.modal-body');
    const first = (body && body.querySelector(FOCUSABLE)) || (node && node.querySelector('.modal-footer button:not([disabled])')) || (node && node.querySelector(FOCUSABLE));
    if (first) first.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (!lockedRef.current) closeRef.current();
        return;
      }
      // While "Confirm it's you" is open, it owns the keyboard.
      if (e.key !== 'Tab' || !node || confirmingRef.current) return;
      const items = [...node.querySelectorAll(FOCUSABLE)];
      if (!items.length) return;
      const [a, z] = [items[0], items[items.length - 1]];
      // Focus left the dialog (not just a click on blank space inside it): pull it back.
      if (!node.contains(document.activeElement) && document.activeElement !== document.body) { e.preventDefault(); a.focus(); return; }
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (opener && typeof opener.focus === 'function' && document.contains(opener) && opener !== document.body) opener.focus();
      else {
        // The opener is gone (e.g. its row was deleted): land on the page heading.
        const heading = document.querySelector('.vault-page .page-title');
        if (heading) heading.focus();
      }
    };
  }, []);

  return (
    <div className="modal-overlay">
      <div className="modal vault-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="modal-header">
          <h2 className="modal-title" id={titleId}>{title}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={isLocked} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-footer">{footer}</div>
      </div>
    </div>
  );
}

// Label is tied to its input (htmlFor/id) for screen readers.
function Field({ label, children, hint, wide }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const child = React.Children.only(children);
  return (
    <div className={`form-group ${wide ? 'vault-wide' : ''}`}>
      <label className="form-label" htmlFor={id}>{label}</label>
      {React.cloneElement(child, { id, 'aria-describedby': hint ? hintId : undefined })}
      {hint && <div className="vault-hint" id={hintId}>{hint}</div>}
    </div>
  );
}

// Props for inputs that hold account / card / tax numbers: no spellcheck (Chrome's
// enhanced spellcheck sends field text to Google), no autofill / "save card".
const SENSITIVE_INPUT = {
  autoComplete: 'off',
  spellCheck: false,
  autoCorrect: 'off',
  autoCapitalize: 'off',
  'data-lpignore': 'true',
  'data-1p-ignore': 'true',
};

function savedHint(maskedValue) {
  return `Saved: ${maskedValue || 'yes'}. Leave blank to keep.`;
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
  const [initial] = useState(form); // values the form opened with
  const [clear, setClear] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await requireRecentAuth(EDIT_MAX_AGE);
      // Send only what changed, so an edit in another tab isn't overwritten.
      const body = { companyId: company.companyId };
      [...PROFILE_FIELDS.map(([k]) => k), 'notes'].forEach((k) => {
        if (form[k] !== initial[k]) body[k] = form[k];
      });
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
          {savedHint(masked)}{' '}
          <label className="vault-clear">
            <input type="checkbox" checked={clear.includes(key)} onChange={(e) => setClear((c) => (e.target.checked ? [...c, key] : c.filter((x) => x !== key)))} />
            Remove saved value
          </label>
        </>
      ) : 'Encrypted when saved.'}
    >
      <input className="form-input vault-mono" name={`vault-${key}`} value={form[key]} onChange={set(key)} placeholder={placeholder} {...SENSITIVE_INPUT} />
    </Field>
  );

  return (
    <Modal
      title={`Edit ${company.legalName || 'company'}`}
      onClose={onClose}
      locked={saving}
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
      locked={saving}
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
        <Field label="Routing number" hint={isEdit ? savedHint(account.masked && account.masked.routingNumber) : 'Encrypted when saved.'}>
          <input className="form-input vault-mono" name="vault-routing" inputMode="numeric" value={form.routingNumber} onChange={set('routingNumber')} {...SENSITIVE_INPUT} />
        </Field>
        <Field label="Account number" hint={isEdit ? savedHint(account.masked && account.masked.accountNumber) : 'Encrypted when saved.'}>
          <input className="form-input vault-mono" name="vault-account" inputMode="numeric" value={form.accountNumber} onChange={set('accountNumber')} {...SENSITIVE_INPUT} />
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
      locked={saving}
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
        <Field label="Expiry (MM/YY)"><input className="form-input vault-mono" name="vault-exp" inputMode="numeric" value={form.expiry} onChange={onExpiry} placeholder="08/29" {...SENSITIVE_INPUT} /></Field>
        <Field label="Card number" wide hint={isEdit ? savedHint(card.masked && card.masked.cardNumber) : 'Encrypted when saved. Last 4 shown everywhere else.'}>
          <input className="form-input vault-mono" name="vault-number" inputMode="numeric" value={form.cardNumber} onChange={set('cardNumber')} {...SENSITIVE_INPUT} />
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
      locked={busy}
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
  // Rows are tagged with the company they belong to, so another company's rows
  // are never shown (or acted on) while the new company's snapshot loads.
  const [bankState, setBankState] = useState({ companyId: null, rows: [] });
  const [cardState, setCardState] = useState({ companyId: null, rows: [] });
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
    const u1 = onSnapshot(collection(db, 'companies', companyId, 'bankAccounts'), (s) => setBankState({ companyId, rows: s.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byNick) }), (e) => setLoadError(e.message));
    const u2 = onSnapshot(collection(db, 'companies', companyId, 'creditCards'), (s) => setCardState({ companyId, rows: s.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byNick) }), (e) => setLoadError(e.message));
    return () => { u1(); u2(); };
  }, [companyId]);

  const company = companies[companyId];
  const listsReady = bankState.companyId === companyId && cardState.companyId === companyId;
  const banks = useMemo(() => (bankState.companyId === companyId ? bankState.rows : []), [bankState, companyId]);
  const cards = useMemo(() => (cardState.companyId === companyId ? cardState.rows : []), [cardState, companyId]);
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
          <h1 className="page-title" tabIndex={-1}>Companies</h1>
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
      <ClipboardNotice />

      {!company ? (
        <div className="empty-state">
          <div className="empty-state-text">
            {company === null && loadError ? 'This company record could not be created. Reload to try again.' : 'Loading company…'}
          </div>
        </div>
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
                <dd><SecretValue key={`companies/${companyId}|ein`} path={`companies/${companyId}`} field="ein" label="EIN" masked={company.masked && company.masked.ein} /></dd>
              </div>
              <div className="vault-row">
                <dt>LLC / document number</dt>
                <dd><SecretValue key={`companies/${companyId}|documentNumber`} path={`companies/${companyId}`} field="documentNumber" label="document number" masked={company.masked && company.masked.documentNumber} /></dd>
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
              <h2 className="section-title">Bank accounts {listsReady && <span className="vault-count">{banks.length}</span>}</h2>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setModal({ type: 'bank' })}>+ Add account</button>
            </div>
            {!listsReady ? (
              <p className="vault-empty">Loading…</p>
            ) : banks.length === 0 ? (
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
                          <td><SecretValue key={`${path}|routingNumber`} path={path} field="routingNumber" label={`routing number for ${a.nickname}`} masked={a.masked && a.masked.routingNumber} /></td>
                          <td><SecretValue key={`${path}|accountNumber`} path={path} field="accountNumber" label={`account number for ${a.nickname}`} masked={a.masked && a.masked.accountNumber} /></td>
                          <td className="vault-nowrap">{formatDate(a.openingDate)}</td>
                          <td className="vault-col-actions">
                            <button type="button" className="btn btn-ghost btn-sm" aria-label={`Edit ${a.nickname}`} onClick={() => setModal({ type: 'bank', record: a })}>Edit</button>
                            <button type="button" className="btn btn-ghost btn-sm vault-danger" aria-label={`Delete ${a.nickname}`} onClick={() => setModal({ type: 'delete-bank', record: a })}>Delete</button>
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
              <h2 className="section-title">Credit cards {listsReady && <span className="vault-count">{cards.length}</span>}</h2>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setModal({ type: 'card' })}>+ Add card</button>
            </div>
            {!listsReady ? (
              <p className="vault-empty">Loading…</p>
            ) : cards.length === 0 ? (
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
                          <td><SecretValue key={`companies/${companyId}/creditCards/${c.id}|cardNumber`} path={`companies/${companyId}/creditCards/${c.id}`} field="cardNumber" label={`card number for ${c.nickname}`} masked={c.masked && c.masked.cardNumber} /></td>
                          <td className="vault-mono vault-nowrap">{c.expiry}</td>
                          <td>{linked ? `${linked.nickname} (•••• ${linked.last4})` : '—'}</td>
                          <td className="vault-col-actions">
                            <button type="button" className="btn btn-ghost btn-sm" aria-label={`Edit ${c.nickname}`} onClick={() => setModal({ type: 'card', record: c })}>Edit</button>
                            <button type="button" className="btn btn-ghost btn-sm vault-danger" aria-label={`Delete ${c.nickname}`} onClick={() => setModal({ type: 'delete-card', record: c })}>Delete</button>
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
