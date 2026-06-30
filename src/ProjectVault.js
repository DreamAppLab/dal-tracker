// src/ProjectVault.js
import React, { useState, useRef } from 'react';
import { storage } from './firebase';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';

const ENTRY_TYPES = [
  { value: 'api_key', label: '🔑 API Key' },
  { value: 'credential', label: '🔐 Credential' },
  { value: 'url', label: '🔗 URL' },
  { value: 'note', label: '📝 Note' },
  { value: 'id', label: '🪪 ID / Identifier' },
];

const ALLOWED_TYPES = {
  'application/pdf': { ext: 'pdf', icon: '📄', label: 'PDF' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: 'docx', icon: '📝', label: 'DOCX' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: 'xlsx', icon: '📊', label: 'XLSX' },
  'image/png': { ext: 'png', icon: '🖼️', label: 'PNG' },
  'image/jpeg': { ext: 'jpg', icon: '🖼️', label: 'JPG' },
};

const ACCEPT = '.pdf,.docx,.xlsx,.png,.jpg,.jpeg';

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileTypeInfo(mimeType, name) {
  if (ALLOWED_TYPES[mimeType]) return ALLOWED_TYPES[mimeType];
  const ext = name?.split('.').pop()?.toLowerCase();
  const byExt = Object.values(ALLOWED_TYPES).find(t => t.ext === ext);
  return byExt || { ext: 'file', icon: '📎', label: ext?.toUpperCase() || 'FILE' };
}

function EmptyVault() {
  return (
    <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>🔑</div>
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>No vault entries yet</div>
      <div style={{ fontSize: 12 }}>Store API keys, credentials, URLs, notes, and files for this project</div>
    </div>
  );
}

export default function ProjectVault({ project, onUpdate }) {
  const entries = project.vault || [];
  const files = project.vaultFiles || [];
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [revealed, setRevealed] = useState({});
  const [copied, setCopied] = useState({});
  const [form, setForm] = useState({ type: 'api_key', label: '', value: '', notes: '' });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const fileInputRef = useRef(null);

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

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (!ALLOWED_TYPES[file.type] && !file.name.match(/\.(pdf|docx|xlsx|png|jpe?g)$/i)) {
      setUploadError('Unsupported file type. Allowed: PDF, DOCX, XLSX, PNG, JPG');
      return;
    }

    setUploading(true);
    setUploadError(null);
    try {
      const fileId = `f${Date.now()}`;
      const storagePath = `vault/${project.id}/${fileId}_${file.name}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, file);
      const downloadUrl = await getDownloadURL(storageRef);
      const typeInfo = getFileTypeInfo(file.type, file.name);
      const newFile = {
        id: fileId,
        name: file.name,
        mimeType: file.type,
        fileType: typeInfo.label,
        size: file.size,
        storagePath,
        downloadUrl,
        uploadedAt: new Date().toISOString(),
        projectId: project.id,
      };
      onUpdate({ ...project, vaultFiles: [...files, newFile] });
    } catch (err) {
      setUploadError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const downloadFile = (file) => {
    const a = document.createElement('a');
    a.href = file.downloadUrl;
    a.download = file.name;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
  };

  const deleteFile = async (file) => {
    if (!window.confirm(`Delete "${file.name}"?`)) return;
    try {
      await deleteObject(ref(storage, file.storagePath));
    } catch {
      // file may already be gone from storage
    }
    onUpdate({ ...project, vaultFiles: files.filter(f => f.id !== file.id) });
  };

  const isSensitive = (type) => type === 'api_key' || type === 'credential';

  const grouped = ENTRY_TYPES.map(t => ({
    ...t,
    items: entries.filter(e => e.type === t.value)
  })).filter(g => g.items.length > 0);

  return (
    <div className="data-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
            Project Vault
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            API keys, credentials, URLs, notes, and files — {entries.length} {entries.length === 1 ? 'entry' : 'entries'}, {files.length} {files.length === 1 ? 'file' : 'files'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            style={{ display: 'none' }}
            onChange={handleFileUpload}
          />
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? 'Uploading...' : '📎 Upload File'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => { resetForm(); setShowForm(true); }}>
            + Add Entry
          </button>
        </div>
      </div>

      {uploadError && (
        <div className="calendar-error-banner" style={{ marginBottom: 12 }}>{uploadError}</div>
      )}

      {files.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 8 }}>
            📁 Files — {project.name}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {files.map(file => {
              const typeInfo = getFileTypeInfo(file.mimeType, file.name);
              return (
                <div key={file.id} className="vault-file-row">
                  <div className="vault-file-icon">{typeInfo.icon}</div>
                  <div className="vault-file-info">
                    <div className="vault-file-name">{file.name}</div>
                    <div className="vault-file-meta">
                      {typeInfo.label} · {formatFileSize(file.size)} · {new Date(file.uploadedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => downloadFile(file)}>
                      ⬇ Download
                    </button>
                    <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: 'var(--coral)' }} onClick={() => deleteFile(file)}>
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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

      {entries.length === 0 && files.length === 0 && !showForm ? (
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
