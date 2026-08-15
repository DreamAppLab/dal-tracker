import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';

const FORM_TYPE_LABELS = {
  'instant-quote': 'Website',
  instant: 'Website',
  'app-quote': 'Mobile App',
  app: 'Mobile App',
  'webapp-quote': 'Custom Business App',
  'pwa-quote': 'Business Web App',
};

const PROJECT_TYPES = [
  { value: 'pwa-quote', label: 'Business Web App' },
  { value: 'webapp-quote', label: 'Custom Business App' },
  { value: 'app-quote', label: 'Mobile App' },
  { value: 'instant-quote', label: 'Website' },
];

const PAYMENT_METHODS = ['Bank Transfer', 'Cash', 'Check', 'Credit Card', 'Other'];

const EMPTY_BUILD_FORM = {
  clientName: '',
  businessName: '',
  email: '',
  formType: 'pwa-quote',
  total: '',
  deposit: '',
  balance: '',
  managementChoice: 'dal-managed',
  monthlyFee: '',
  notes: '',
  paymentMethod: 'Bank Transfer',
};

function toDate(value) {
  if (value == null || value === '') return null;
  if (typeof value.toDate === 'function') {
    try {
      return value.toDate();
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDateTime(value) {
  const d = toDate(value);
  if (!d) return '—';
  return format(d, 'MMM d, yyyy h:mm a');
}

function money(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function isBuildComplete(build) {
  const status = String(build?.status || '');
  return status === 'complete' || !!build?.completedAt;
}

function firstName(name) {
  const n = String(name || '').trim();
  if (!n) return 'there';
  return n.split(/\s+/)[0];
}

function paymentIntentIds(build, quote) {
  return [...new Set(
    [
      build.stripeDepositPaymentIntentId,
      build.stripePaymentIntentId,
      quote && quote.stripeDepositPaymentIntentId,
      quote && quote.stripePaymentIntentId,
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  )];
}

function depositAmountFromRevenue(entries, build, quote) {
  const deposits = (entries || []).filter((entry) => String(entry.type || '').toLowerCase() === 'deposit');
  const piIds = new Set(paymentIntentIds(build, quote));

  const byIntent = deposits.find((entry) => (
    piIds.has(String(entry.stripePaymentIntentId || '')) ||
    piIds.has(String(entry.id || ''))
  ));
  if (byIntent) return Number(byIntent.amount) || 0;

  const quoteId = String(build.quoteId || (quote && quote.id) || '');
  const byQuote = quoteId
    ? deposits.find((entry) => String(entry.quoteId || '') === quoteId)
    : null;
  if (byQuote) return Number(byQuote.amount) || 0;

  const byBuild = deposits.find((entry) => (
    (build.id && entry.buildId === build.id) ||
    (quoteId && entry.buildId === 'quote-' + quoteId)
  ));
  if (byBuild) return Number(byBuild.amount) || 0;

  if (quote && quote.depositPaidAmount != null && quote.depositPaidAmount !== '') {
    return Number(quote.depositPaidAmount) || 0;
  }
  if (build.depositPaidAmount != null && build.depositPaidAmount !== '') {
    return Number(build.depositPaidAmount) || 0;
  }
  return null;
}

function remainingBalance(build, paidOverride) {
  const total = Number(build.total || 0);
  const depositPaid = paidOverride != null ? Number(paidOverride) : Number(build.depositPaidAmount || 0);
  return Math.max(0, Math.round((total - depositPaid) * 100) / 100);
}

async function sendBalancePaymentLink(build, amountOverride) {
  const amount = amountOverride != null ? Number(amountOverride) : remainingBalance(build);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('No remaining balance to collect.');
  }
  const email = String(build.email || build.clientEmail || '').trim();
  if (!email) {
    throw new Error('This build is missing the client email address.');
  }
  const res = await fetch('/api/quote-payment-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'balance',
      email,
      firstName: firstName(build.clientName),
      amount,
      businessName: build.businessName || build.clientName || 'Dream App Lab Project',
      quoteId: build.quoteId || '',
      buildId: build.id,
      sendEmail: true,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || data.detail || 'Failed to send balance link');
  }
  if (!data.emailed) {
    throw new Error('Payment link was created but the email was not sent.');
  }
  return { url: data.url, email: data.emailedTo || email };
}

function formTypeLabel(formType) {
  const key = String(formType || '').toLowerCase();
  return FORM_TYPE_LABELS[key] || formType || 'Website';
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

async function postRevenue({ amount, type, description, buildId }) {
  await setDoc(doc(db, 'revenue', 'dal-website'), { appId: 'dal-website' }, { merge: true });
  await addDoc(collection(db, 'revenue', 'dal-website', 'manualSales'), {
    appId: 'dal-website',
    amount,
    type,
    description,
    note: description,
    date: todayISO(),
    buildId: buildId || null,
    createdAt: new Date().toISOString(),
  });
}

function buildStatusMeta(status) {
  if (status === 'complete') {
    return { label: 'Completed', color: '#166534', bg: 'rgba(22,101,52,0.4)' };
  }
  return { label: 'In Progress', color: '#22C55E', bg: 'rgba(34,197,94,0.18)' };
}

async function deleteBuildRecord(build) {
  const biz = build.businessName || build.clientName || 'Project';
  if (build.depositPostedToRevenue) {
    await postRevenue({
      amount: -Number(build.deposit || 0),
      type: 'reversal',
      description: `Build deleted — deposit reversed: ${biz}`,
      buildId: build.id,
    });
  }
  if (build.balancePostedToRevenue) {
    await postRevenue({
      amount: -Number(build.balance || 0),
      type: 'reversal',
      description: `Build deleted — balance reversed: ${biz}`,
      buildId: build.id,
    });
  }
  await deleteDoc(doc(db, 'builds', build.id));
}

function InfoRow({ label, children }) {
  return (
    <div className="quotes-info-row">
      <div className="quotes-info-label">{label}</div>
      <div className="quotes-info-value">{children || '—'}</div>
    </div>
  );
}

function BuildBlackBox({ buildId }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({ label: '', value: '', notes: '' });
  const [adding, setAdding] = useState(false);
  const [revealed, setRevealed] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({ label: '', value: '', notes: '' });
  const [pendingDelete, setPendingDelete] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!buildId) return undefined;
    const q = query(collection(db, 'builds', buildId, 'blackbox'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        rows.sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));
        setEntries(rows);
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setError(err.message || 'Failed to load Black Box');
        setLoading(false);
      }
    );
    return () => unsub();
  }, [buildId]);

  const handleAdd = async () => {
    if (!draft.label.trim() || !draft.value.trim()) {
      setError('Label and value are required.');
      return;
    }
    setBusy('add');
    setError('');
    try {
      await addDoc(collection(db, 'builds', buildId, 'blackbox'), {
        label: draft.label.trim(),
        value: draft.value,
        notes: draft.notes.trim(),
        createdAt: new Date().toISOString(),
      });
      setDraft({ label: '', value: '', notes: '' });
      setAdding(false);
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
    } finally {
      setBusy('');
    }
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    if (!editDraft.label.trim() || !editDraft.value.trim()) {
      setError('Label and value are required.');
      return;
    }
    setBusy('edit');
    setError('');
    try {
      await updateDoc(doc(db, 'builds', buildId, 'blackbox', editingId), {
        label: editDraft.label.trim(),
        value: editDraft.value,
        notes: editDraft.notes.trim(),
        updatedAt: new Date().toISOString(),
      });
      setEditingId(null);
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
    } finally {
      setBusy('');
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setBusy('delete');
    setError('');
    try {
      await deleteDoc(doc(db, 'builds', buildId, 'blackbox', pendingDelete.id));
      setPendingDelete(null);
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="quotes-section build-blackbox">
      <div className="data-section-header" style={{ marginBottom: 14 }}>
        <h2 style={{ marginBottom: 0 }}>🔒 Black Box</h2>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            setAdding((v) => !v);
            setError('');
          }}
        >
          {adding ? 'Cancel' : '+ Add entry'}
        </button>
      </div>
      <p className="quotes-muted" style={{ marginBottom: 14 }}>
        Credentials, API keys, and account info for this client build. Values are masked by default.
      </p>

      {adding && (
        <div className="build-bb-form">
          <div className="form-group">
            <label className="form-label">Label</label>
            <input
              className="form-input"
              value={draft.label}
              onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
              placeholder='e.g. "Firebase API Key"'
            />
          </div>
          <div className="form-group">
            <label className="form-label">Value</label>
            <input
              className="form-input"
              type="password"
              autoComplete="off"
              value={draft.value}
              onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))}
              placeholder="Sensitive value"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Notes (optional)</label>
            <input
              className="form-input"
              value={draft.notes}
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              placeholder="Where this is used, who has access…"
            />
          </div>
          <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={handleAdd}>
            {busy === 'add' ? 'Saving…' : 'Save entry'}
          </button>
        </div>
      )}

      {error && <div className="quotes-error">{error}</div>}

      {loading ? (
        <p className="quotes-muted">Loading Black Box…</p>
      ) : entries.length === 0 ? (
        <p className="quotes-muted">No entries yet.</p>
      ) : (
        entries.map((entry) => {
          const shown = !!revealed[entry.id];
          const editing = editingId === entry.id;
          return (
            <div key={entry.id} className="build-bb-card">
              {editing ? (
                <>
                  <div className="form-group">
                    <label className="form-label">Label</label>
                    <input
                      className="form-input"
                      value={editDraft.label}
                      onChange={(e) => setEditDraft((d) => ({ ...d, label: e.target.value }))}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Value</label>
                    <input
                      className="form-input"
                      value={editDraft.value}
                      onChange={(e) => setEditDraft((d) => ({ ...d, value: e.target.value }))}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Notes</label>
                    <input
                      className="form-input"
                      value={editDraft.notes}
                      onChange={(e) => setEditDraft((d) => ({ ...d, notes: e.target.value }))}
                    />
                  </div>
                  <div className="quotes-action-row">
                    <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={handleSaveEdit}>
                      {busy === 'edit' ? 'Saving…' : 'Save'}
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="build-bb-card-top">
                    <div className="build-bb-label">{entry.label || 'Untitled'}</div>
                    <div className="item-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setRevealed((r) => ({ ...r, [entry.id]: !r[entry.id] }))}
                      >
                        {shown ? 'Hide' : 'Show'}
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => {
                          setEditingId(entry.id);
                          setEditDraft({
                            label: entry.label || '',
                            value: entry.value || '',
                            notes: entry.notes || '',
                          });
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="icon-btn danger"
                        onClick={() => setPendingDelete(entry)}
                      >
                        Del
                      </button>
                    </div>
                  </div>
                  <div className="build-bb-value">{shown ? entry.value || '—' : '••••••••'}</div>
                  {entry.notes ? <div className="quotes-muted" style={{ marginTop: 8 }}>{entry.notes}</div> : null}
                </>
              )}
            </div>
          );
        })
      )}

      {pendingDelete && (
        <div className="modal-overlay" onClick={() => !busy && setPendingDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Delete Black Box entry</div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPendingDelete(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ lineHeight: 1.5 }}>
                Delete <strong>{pendingDelete.label || 'this entry'}</strong>? This cannot be undone.
              </p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => setPendingDelete(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" disabled={!!busy} onClick={handleDelete}>
                {busy === 'delete' ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function AddBuildModal({ onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY_BUILD_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const setMoneyField = (key, value) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      const total = Number(key === 'total' ? value : next.total);
      const deposit = Number(key === 'deposit' ? value : next.deposit);
      if (Number.isFinite(total) && Number.isFinite(deposit)) {
        next.balance = String(Math.round((total - deposit) * 100) / 100);
      }
      return next;
    });
  };

  const handleSave = async () => {
    const clientName = form.clientName.trim();
    const businessName = form.businessName.trim();
    const email = form.email.trim();
    const total = Number(form.total);
    const deposit = Number(form.deposit);
    const balance = Number(form.balance);
    if (!clientName || !businessName || !email) {
      setError('Client name, business name, and email are required.');
      return;
    }
    if (!Number.isFinite(total) || total <= 0) {
      setError('Project total is required.');
      return;
    }
    if (!Number.isFinite(deposit) || deposit < 0) {
      setError('Deposit amount is required.');
      return;
    }
    if (!Number.isFinite(balance)) {
      setError('Balance amount is required.');
      return;
    }
    if (form.managementChoice === 'dal-managed' && form.monthlyFee !== '' && !Number.isFinite(Number(form.monthlyFee))) {
      setError('Monthly fee must be a number.');
      return;
    }

    setSaving(true);
    setError('');
    const now = new Date().toISOString();
    try {
      await addDoc(collection(db, 'builds'), {
        clientName,
        businessName,
        email,
        formType: form.formType,
        total,
        deposit,
        balance,
        managementChoice: form.managementChoice,
        monthlyFee:
          form.managementChoice === 'dal-managed' && form.monthlyFee !== ''
            ? Number(form.monthlyFee)
            : null,
        projectNotes: form.notes.trim(),
        paymentMethod: form.paymentMethod,
        source: 'manual',
        status: 'in_progress',
        depositPostedToRevenue: false,
        balancePostedToRevenue: false,
        createdAt: now,
        movedToBuildAt: now,
      });
      onSaved();
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Add Build</div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={saving}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Client name *</label>
            <input className="form-input" value={form.clientName} onChange={(e) => set('clientName', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Business name *</label>
            <input className="form-input" value={form.businessName} onChange={(e) => set('businessName', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Email *</label>
            <input className="form-input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Project type *</label>
            <select className="form-select" value={form.formType} onChange={(e) => set('formType', e.target.value)}>
              {PROJECT_TYPES.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Project total *</label>
              <input
                className="form-input"
                type="number"
                min="0"
                step="0.01"
                value={form.total}
                onChange={(e) => setMoneyField('total', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Deposit amount *</label>
              <input
                className="form-input"
                type="number"
                min="0"
                step="0.01"
                value={form.deposit}
                onChange={(e) => setMoneyField('deposit', e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Balance amount *</label>
            <input
              className="form-input"
              type="number"
              min="0"
              step="0.01"
              value={form.balance}
              onChange={(e) => set('balance', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Management choice *</label>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 6 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="managementChoice"
                  checked={form.managementChoice === 'dal-managed'}
                  onChange={() => set('managementChoice', 'dal-managed')}
                />
                DAL Managed
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="managementChoice"
                  checked={form.managementChoice === 'full-handover'}
                  onChange={() => set('managementChoice', 'full-handover')}
                />
                Full Handover
              </label>
            </div>
          </div>
          {form.managementChoice === 'dal-managed' && (
            <div className="form-group">
              <label className="form-label">Monthly fee</label>
              <input
                className="form-input"
                type="number"
                min="0"
                step="0.01"
                value={form.monthlyFee}
                onChange={(e) => set('monthlyFee', e.target.value)}
              />
            </div>
          )}
          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea
              className="form-input"
              style={{ minHeight: 90, resize: 'vertical' }}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Payment method *</label>
            <select className="form-select" value={form.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value)}>
              {PAYMENT_METHODS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          {error && <div className="quotes-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function BuildDetail({ build, onBack, onPatched, onMovedBack, onDeleted }) {
  const [notes, setNotes] = useState(build.projectNotes || '');
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmMoveBack, setConfirmMoveBack] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [depositPaid, setDepositPaid] = useState(null);

  const status = String(build.status || 'in_progress');
  const meta = buildStatusMeta(status);
  const complete = isBuildComplete(build);
  const remaining = depositPaid == null ? 0 : remainingBalance(build, depositPaid);

  useEffect(() => {
    let cancelled = false;
    async function loadActualDeposit() {
      let quote = null;
      if (build.quoteId) {
        const quoteRes = await fetch('/api/quotes?id=' + encodeURIComponent(build.quoteId));
        const quoteData = await quoteRes.json().catch(() => ({}));
        quote = quoteData.quote || null;
      }
      const revenueRes = await fetch('/api/revenue-entries?type=deposit');
      const revenueData = await revenueRes.json().catch(() => ({}));
      const amount = depositAmountFromRevenue(revenueData.entries || [], build, quote);
      if (cancelled || amount == null) return;
      setDepositPaid(amount);
      if (Number(build.depositPaidAmount) !== amount) {
        await updateDoc(doc(db, 'builds', build.id), { depositPaidAmount: amount }).catch((err) => {
          console.error('Failed to persist actual deposit paid', err);
        });
      }
    }
    loadActualDeposit().catch((err) => console.error('Failed to load actual deposit paid', err));
    return () => { cancelled = true; };
  }, [build.id, build.quoteId, build.stripeDepositPaymentIntentId]);

  const saveNotes = async () => {
    setSavingNotes(true);
    setError('');
    try {
      await updateDoc(doc(db, 'builds', build.id), { projectNotes: notes });
      if (onPatched) onPatched(build.id, { projectNotes: notes });
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2000);
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
    } finally {
      setSavingNotes(false);
    }
  };

  const handleMarkInBuild = async () => {
    if (build.depositPostedToRevenue) return;
    setBusy('in_build');
    setError('');
    try {
      const inBuildAt = new Date().toISOString();
      await postRevenue({
        amount: Number(build.deposit || 0),
        type: 'deposit',
        description: `Project deposit — ${build.businessName || build.clientName || 'Project'}`,
        buildId: build.id,
      });
      await updateDoc(doc(db, 'builds', build.id), {
        status: 'in_progress',
        inBuildAt,
        depositPostedToRevenue: true,
      });
      if (onPatched) {
        onPatched(build.id, { status: 'in_progress', inBuildAt, depositPostedToRevenue: true });
      }
      setNotice('Deposit posted to Revenue');
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
    } finally {
      setBusy('');
    }
  };

  const handleSendBalanceLink = async () => {
    setBusy('balance_link');
    setError('');
    try {
      const { url, email } = await sendBalancePaymentLink(build, remaining);
      await updateDoc(doc(db, 'builds', build.id), {
        stripeBalanceUrl: url,
        balanceLinkSentAt: new Date().toISOString(),
      });
      if (onPatched) onPatched(build.id, { stripeBalanceUrl: url });
      setNotice(`Balance link sent to ${email}`);
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
    } finally {
      setBusy('');
    }
  };

  const handleComplete = async () => {
    setBusy('complete');
    setError('');
    try {
      const completedAt = new Date().toISOString();
      const fields = { status: 'complete', completedAt };
      if (!build.balancePostedToRevenue) {
        await postRevenue({
          amount: Number(build.balance || 0),
          type: 'balance',
          description: `Project balance — ${build.businessName || build.clientName || 'Project'}`,
          buildId: build.id,
        });
        fields.balancePostedToRevenue = true;
      }
      await updateDoc(doc(db, 'builds', build.id), fields);
      if (onPatched) onPatched(build.id, fields);
      setNotice('Moved to Complete');
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
    } finally {
      setBusy('');
    }
  };

  const handleDeleteBuild = async () => {
    setBusy('delete');
    setError('');
    try {
      await deleteBuildRecord(build);
      if (onDeleted) onDeleted(build.id);
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
      setBusy('');
    }
  };

  const handleMoveBack = async () => {
    if (!build.quoteId) {
      setError('This build is missing a quote id.');
      return;
    }
    setBusy('move_back');
    setError('');
    try {
      const res = await fetch('/api/quotes?id=' + encodeURIComponent(build.quoteId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'accepted' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || data.detail || 'Failed to reset quote status');
      }
      const movedBackAt = new Date().toISOString();
      await updateDoc(doc(db, 'builds', build.id), {
        status: 'moved_back',
        movedBackAt,
      });
      setConfirmMoveBack(false);
      setNotice('Project moved back to Quotes.');
      if (onMovedBack) onMovedBack(build.id);
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="quotes-detail">
      <button
        type="button"
        className="btn btn-ghost quotes-back"
        onClick={(e) => {
          e.preventDefault();
          onBack();
        }}
      >
        ← Back to Build Board
      </button>

      <div className="quotes-detail-header">
        <div>
          <h1 className="page-title">{build.clientName || 'Untitled client'}</h1>
          <p className="page-subtitle">
            {build.businessName || '—'} · {formTypeLabel(build.formType)}
          </p>
        </div>
        <span className="status-badge" style={{ background: meta.bg, color: meta.color }}>
          <span className="status-dot" style={{ background: meta.color }} />
          {meta.label}
        </span>
      </div>

      {notice && <div className="quotes-success-notice">{notice}</div>}

      <section className="quotes-section">
        <h2>Client Info</h2>
        <div className="quotes-info-grid">
          <InfoRow label="Name">{build.clientName}</InfoRow>
          <InfoRow label="Email">{build.email || build.clientEmail}</InfoRow>
          <InfoRow label="Business">{build.businessName || '—'}</InfoRow>
          <InfoRow label="Form type">{formTypeLabel(build.formType)}</InfoRow>
        </div>
      </section>

      <section className="quotes-section">
        <h2>Pricing</h2>
        <div className="quotes-price-rows">
          <div className="quotes-price-row quotes-price-final">
            <span>Total</span>
            <span>{money(build.total)}</span>
          </div>
          <div className="quotes-price-row">
            <span>Deposit</span>
            <span>{depositPaid == null ? '—' : money(depositPaid)}</span>
          </div>
          <div className="quotes-price-row">
            <span>Balance remaining</span>
            <span>{depositPaid == null ? '—' : money(remaining)}</span>
          </div>
          <div className="quotes-price-row">
            <span>Management</span>
            <span>
              {[build.managementChoice, build.managedTier].filter(Boolean).join(' — ') || '—'}
              {build.monthlyFee != null && build.monthlyFee !== ''
                ? ` · ${money(build.monthlyFee)}/mo`
                : ''}
            </span>
          </div>
        </div>
      </section>

      <section className="quotes-section">
        <h2>Project Notes</h2>
        <textarea
          className="form-input"
          style={{ minHeight: 140, resize: 'vertical' }}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Internal notes for this build…"
        />
        <div className="quotes-action-row" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-primary btn-sm" disabled={savingNotes} onClick={saveNotes}>
            {savingNotes ? 'Saving…' : 'Save notes'}
          </button>
          {notesSaved && <span className="quotes-muted">✓ Saved</span>}
        </div>
      </section>

      <BuildBlackBox buildId={build.id} />

      <section className="quotes-section quotes-actions">
        <h2>Actions</h2>
        {complete ? (
          <div className="quotes-wait-notice">
            Project complete.{build.completedAt ? ` Completed ${formatDateTime(build.completedAt)}.` : ''}
          </div>
        ) : null}

        <div className="quotes-action-row" style={{ marginTop: complete ? 14 : 0 }}>
          {!complete && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!!busy || !!build.depositPostedToRevenue}
              onClick={handleMarkInBuild}
            >
              {build.depositPostedToRevenue
                ? 'Marked In Progress ✓'
                : busy === 'in_build'
                  ? 'Saving…'
                  : 'Mark In Progress'}
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!!busy || depositPaid == null || remaining <= 0}
            onClick={handleSendBalanceLink}
          >
            {busy === 'balance_link' ? 'Sending…' : 'Send Balance Link'}
          </button>
          {!complete && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!!busy}
              onClick={handleComplete}
            >
              {busy === 'complete' ? 'Saving…' : 'Mark Complete'}
            </button>
          )}
        </div>

        {confirmDelete && (
          <div className="quotes-confirm-box" style={{ marginTop: 14 }}>
            <p>Delete this build? This cannot be undone.</p>
            <div className="quotes-action-row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-danger"
                disabled={!!busy}
                onClick={handleDeleteBuild}
              >
                {busy === 'delete' ? 'Deleting…' : 'Confirm'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!!busy}
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {confirmMoveBack && (
          <div className="quotes-confirm-box" style={{ marginTop: 14 }}>
            <p>
              This will move this project back to the Quotes pipeline. Remember to issue any refund separately from your Stripe dashboard if payment was made. Continue?
            </p>
            <div className="quotes-action-row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!!busy}
                onClick={handleMoveBack}
              >
                {busy === 'move_back' ? 'Moving…' : 'Confirm'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!!busy}
                onClick={() => setConfirmMoveBack(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {status !== 'moved_back' && !confirmMoveBack && !confirmDelete && (
          <div className="quotes-action-row" style={{ marginTop: 14 }}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!!busy}
              onClick={() => {
                setError('');
                setConfirmMoveBack(true);
              }}
            >
              Move Back to Quotes
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={!!busy}
              onClick={() => {
                setError('');
                setConfirmDelete(true);
              }}
            >
              Delete Build
            </button>
          </div>
        )}
        {error && <div className="quotes-error">{error}</div>}
      </section>
    </div>
  );
}

export default function BuildBoardTab() {
  const [builds, setBuilds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [listNotice, setListNotice] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [linkBusyId, setLinkBusyId] = useState('');

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'builds'),
      (snap) => {
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((b) => b.status !== 'moved_back');
        rows.sort((a, b) => {
          const am = toDate(a.movedToBuildAt)?.getTime() || 0;
          const bm = toDate(b.movedToBuildAt)?.getTime() || 0;
          return bm - am;
        });
        setBuilds(rows);
        setLoading(false);
        setError('');
      },
      (err) => {
        console.error(err);
        setError(err.message || 'Failed to load builds');
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  const selected = selectedId ? builds.find((b) => b.id === selectedId) : null;
  const filteredBuilds = builds.filter((build) => {
    if (statusFilter === 'in_progress') return !isBuildComplete(build);
    if (statusFilter === 'completed') return isBuildComplete(build);
    return true;
  });

  const handleListDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setError('');
    try {
      await deleteBuildRecord(pendingDelete);
      setPendingDelete(null);
      setListNotice('Build deleted and revenue adjusted');
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
    } finally {
      setDeleting(false);
    }
  };

  const handleListBalanceLink = async (build) => {
    setLinkBusyId(build.id);
    setError('');
    try {
      const { url, email } = await sendBalancePaymentLink(build);
      await updateDoc(doc(db, 'builds', build.id), {
        stripeBalanceUrl: url,
        balanceLinkSentAt: new Date().toISOString(),
      });
      setListNotice(`Balance link sent to ${email}`);
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
    } finally {
      setLinkBusyId('');
    }
  };

  if (selected) {
    return (
      <div className="page quotes-page">
        <BuildDetail
          build={selected}
          onBack={() => setSelectedId(null)}
          onPatched={(id, fields) => {
            setBuilds((prev) => prev.map((b) => (b.id === id ? { ...b, ...fields } : b)));
          }}
          onMovedBack={(id) => {
            setBuilds((prev) => prev.filter((b) => b.id !== id));
            setSelectedId(null);
            setError('');
            setListNotice('Project moved back to Quotes.');
          }}
          onDeleted={(id) => {
            setBuilds((prev) => prev.filter((b) => b.id !== id));
            setSelectedId(null);
            setError('');
            setListNotice('Build deleted and revenue adjusted');
          }}
        />
      </div>
    );
  }

  return (
    <div className="page quotes-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Build Board</h1>
          <p className="page-subtitle">Active client builds and completed projects</p>
        </div>
        <div className="page-actions">
          <div className="form-group" style={{ marginBottom: 0, minWidth: 180 }}>
            <label className="form-label" htmlFor="build-status-filter">Status</label>
            <select
              id="build-status-filter"
              className="form-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setShowAdd(true)}>
            Add Build
          </button>
        </div>
      </div>

      {showAdd && (
        <AddBuildModal
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            setListNotice('Build added');
          }}
        />
      )}

      {error && <div className="quotes-error">{error}</div>}
      {listNotice && <div className="quotes-success-notice">{listNotice}</div>}

      {loading ? (
        <div className="empty-state">Loading builds…</div>
      ) : (
        <div className="quotes-table-wrap">
          <table className="stack-table quotes-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Business</th>
                <th>Type</th>
                <th>Total</th>
                <th>Status</th>
                <th>Started</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredBuilds.length === 0 ? (
                <tr>
                  <td colSpan={7} className="quotes-muted" style={{ textAlign: 'center', padding: 28 }}>
                    No builds yet. A project appears here as soon as a deposit is paid.
                  </td>
                </tr>
              ) : (
                filteredBuilds.map((build) => {
                  const meta = buildStatusMeta(build.status);
                  return (
                    <tr
                      key={build.id}
                      className="quotes-row"
                      onClick={() => setSelectedId(build.id)}
                    >
                      <td>{build.clientName || '—'}</td>
                      <td>{build.businessName || '—'}</td>
                      <td>{formTypeLabel(build.formType)}</td>
                      <td>{money(build.total)}</td>
                      <td>
                        <span className="status-badge" style={{ background: meta.bg, color: meta.color }}>
                          <span className="status-dot" style={{ background: meta.color }} />
                          {meta.label}
                        </span>
                      </td>
                      <td>{formatDateTime(build.movedToBuildAt)}</td>
                      <td>
                        <div className="item-actions" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={!!linkBusyId || remainingBalance(build) <= 0}
                            onClick={() => handleListBalanceLink(build)}
                          >
                            {linkBusyId === build.id ? 'Sending…' : 'Send Balance Link'}
                          </button>
                          <button
                            type="button"
                            className="icon-btn danger"
                            title="Delete build"
                            onClick={() => setPendingDelete(build)}
                          >
                            🗑
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {pendingDelete && (
        <div className="modal-overlay" onClick={() => !deleting && setPendingDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Delete build</div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={deleting}
                onClick={() => setPendingDelete(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p style={{ lineHeight: 1.5 }}>
                Delete the build for <strong>{pendingDelete.clientName || 'this client'}</strong>
                {pendingDelete.businessName ? ` (${pendingDelete.businessName})` : ''}? This cannot be undone.
              </p>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={deleting}
                onClick={() => setPendingDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={deleting}
                onClick={handleListDelete}
              >
                {deleting ? 'Deleting…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
