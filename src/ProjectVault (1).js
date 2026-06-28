// src/components/ProjectVault.js
import React, { useState } from 'react';

const ENTRY_TYPES = [
  { value: 'api_key', label: '🔑 API Key' },
  { value: 'credential', label: '🔐 Credential' },
  { value: 'url', label: '🔗 URL' },
  { value: 'note', label: '📝 Note' },
  { value: 'id', label: '🪪 ID / Identifier' },
];

function EmptyVault() {
  return (
    <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>🔑</div>
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>No vault entries yet</div>
      <div style={{ fontSize: 12 }}>Store API keys, credentials, URLs, and notes for this project</div>
    </div>
  );
}

export default function ProjectVault({ project, onUpdate }) {
  const entries = project.vault || [];
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [revealed, setRevealed] = useState({});
  const [copied, setCopied] = useState({});
  const [form, setForm] = useState({ type: 'api_key', label: '', value: '', notes: '' });

  const resetForm = () => {
    setForm({ type: 'api_key', label: '', value: '', notes: '' });
    setShowForm(false);
    setEditingId(null);
  };

  const saveEntry = () => {
    if (!form.label.trim() || !form.value.trim()) return;
    let updated;
    if (editingId) {
      updated = entries.map(e => e.id === editingId ? { ...e, ...form } : e);
    } else {
      updated = [...entries, { ...form, id: `v${Date.now()}`, createdAt: new Date().toISOString() }];
    }
    onUpdate({ ...project, vault: updated });
    resetForm();
  };

  const deleteEntry = (id) => {
    if (!window.confirm('Delete this vault entry?')) return;
    onUpdate({ ...project, vault: entries.filter(e => e.id !== id) });
  };

  const startEdit = (entry) => {
    setForm({ type: entry.type, label: entry.label, value: entry.value, notes: entry.notes || '' });
    setEditingId(entry.id);
    setShowForm(true);
  };

  const copyValue = (id, value) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(c => ({ ...c, [id]: true }));
      setTimeout(() => setCopied(c => ({ ...c, [id]: false })), 2000);
    });
  };

  const toggleReveal = (id) => {
    setRevealed(r => ({ ...r, [id]: !r[id] }));
  };

  const isSensitive = (type) => type === 'api_key' || type === 'credential';

  const grouped = ENTRY_TYPES.map(t => ({
    ...t,
    items: entries.filter(e => e.type === t.value)
  })).filter(g => g.items.length > 0);

  return (
    <div className="data-section">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
            Project Vault
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            API keys, credentials, URLs, and notes — {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          </div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => { resetForm(); setShowForm(true); }}>
          + Add Entry
        </button>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '1rem',
          marginBottom: 16
        }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', marginBottom: 12 }}>
            {editingId ? 'Edit Entry' : 'New Entry'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>TYPE</label>
              <select
                className="form-select"
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              >
                {ENTRY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>LABEL</label>
              <input
                className="form-input"
                placeholder="e.g. RevenueCat iOS API Key"
                value={form.label}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
              />
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>VALUE</label>
            <input
              className="form-input"
              placeholder={isSensitive(form.type) ? 'Paste key or credential...' : 'Enter value...'}
              value={form.value}
              onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>NOTES (optional)</label>
            <input
              className="form-input"
              placeholder="e.g. Test key, expires Jun 2027, used in app.json..."
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={saveEntry} disabled={!form.label.trim() || !form.value.trim()}>
              {editingId ? 'Save Changes' : 'Add Entry'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={resetForm}>Cancel</button>
          </div>
        </div>
      )}

      {/* Entries */}
      {entries.length === 0 && !showForm ? (
        <EmptyVault />
      ) : (
        grouped.map(group => (
          <div key={group.value} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 8 }}>
              {group.label}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {group.items.map(entry => (
                <div key={entry.id} style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: '0.875rem 1rem',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                        {entry.label}
                      </div>
                      <div style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 12,
                        color: isSensitive(entry.type) && !revealed[entry.id] ? 'var(--text-muted)' : 'var(--amber)',
                        background: 'var(--bg-elevated)',
                        padding: '4px 8px',
                        borderRadius: 6,
                        wordBreak: 'break-all',
                        marginBottom: entry.notes ? 6 : 0
                      }}>
                        {isSensitive(entry.type) && !revealed[entry.id]
                          ? '••••••••••••••••••••••••'
                          : entry.value}
                      </div>
                      {entry.notes && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{entry.notes}</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      {isSensitive(entry.type) && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => toggleReveal(entry.id)}
                          style={{ fontSize: 11, padding: '4px 8px' }}
                        >
                          {revealed[entry.id] ? '🙈 Hide' : '👁 Show'}
                        </button>
                      )}
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => copyValue(entry.id, entry.value)}
                        style={{ fontSize: 11, padding: '4px 8px', color: copied[entry.id] ? 'var(--green)' : undefined }}
                      >
                        {copied[entry.id] ? '✓ Copied' : '📋 Copy'}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => startEdit(entry)}
                        style={{ fontSize: 11, padding: '4px 8px' }}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => deleteEntry(entry.id)}
                        style={{ fontSize: 11, padding: '4px 8px', color: 'var(--coral)' }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
