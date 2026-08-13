import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
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

function formTypeLabel(formType) {
  const key = String(formType || '').toLowerCase();
  return FORM_TYPE_LABELS[key] || formType || 'Website';
}

function buildStatusMeta(status) {
  if (status === 'complete') {
    return { label: 'Complete', color: '#166534', bg: 'rgba(22,101,52,0.4)' };
  }
  return { label: 'In Build', color: '#22C55E', bg: 'rgba(34,197,94,0.18)' };
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

function BuildDetail({ build, onBack, onPatched }) {
  const [notes, setNotes] = useState(build.projectNotes || '');
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const status = String(build.status || 'in_build');
  const meta = buildStatusMeta(status);
  const complete = status === 'complete' || !!build.completedAt;

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

  const handleComplete = async () => {
    setBusy('complete');
    setError('');
    try {
      const completedAt = new Date().toISOString();
      await updateDoc(doc(db, 'builds', build.id), {
        status: 'complete',
        completedAt,
      });
      if (onPatched) onPatched(build.id, { status: 'complete', completedAt });
      setNotice('Moved to Complete');
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
            <span>{money(build.deposit)}</span>
          </div>
          <div className="quotes-price-row">
            <span>Balance</span>
            <span>{money(build.balance)}</span>
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
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={!!busy}
            onClick={handleComplete}
          >
            {busy === 'complete' ? 'Saving…' : 'Move to Complete'}
          </button>
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
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'builds'),
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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

  if (selected) {
    return (
      <div className="page quotes-page">
        <BuildDetail
          build={selected}
          onBack={() => setSelectedId(null)}
          onPatched={(id, fields) => {
            setBuilds((prev) => prev.map((b) => (b.id === id ? { ...b, ...fields } : b)));
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
      </div>

      {error && <div className="quotes-error">{error}</div>}

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
              </tr>
            </thead>
            <tbody>
              {builds.length === 0 ? (
                <tr>
                  <td colSpan={6} className="quotes-muted" style={{ textAlign: 'center', padding: 28 }}>
                    No builds yet. Move a quote to the Build Board from the quote Actions panel.
                  </td>
                </tr>
              ) : (
                builds.map((build) => {
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
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
