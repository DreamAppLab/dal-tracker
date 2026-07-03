import React, { useState } from 'react';
import { db } from '../firebase';
import { doc, setDoc } from 'firebase/firestore';

const EMOJIS = ['📱', '🌐', '🚀', '💡', '🏠', '✈️', '📚', '🏥', '🐾', '🌿', '💊', '🧠', '❤️', '🧶', '🚐', '🎮', '📸', '🎵', '💰', '⚙️'];
const COLORS = ['#00D4B8', '#6366F1', '#F59E0B', '#FF5B5B', '#22C55E', '#58c6f4', '#EC4899', '#8B5CF6', '#06B6D4', '#F43F5E'];

export default function AddPipelineModal({ onClose, onAdded }) {
  const [form, setForm] = useState({ name: '', logo: '💡', color: '#00D4B8' });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const id = form.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + Date.now();
      const data = {
        id,
        name: form.name.trim(),
        logo: form.logo,
        color: form.color,
        status: 'ideation',
      };
      await setDoc(doc(db, 'pipeline', id), data, { merge: true });
      onAdded?.();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Add Pipeline Idea</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', gap: 20, marginBottom: 16, alignItems: 'flex-start' }}>
            <div>
              <label className="form-label">Logo</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: 180 }}>
                {EMOJIS.map(e => (
                  <button key={e} type="button" onClick={() => set('logo', e)}
                    style={{
                      width: 34, height: 34, borderRadius: 8, border: `2px solid ${form.logo === e ? 'var(--teal)' : 'var(--border)'}`,
                      background: form.logo === e ? 'var(--teal-dim)' : 'var(--bg-input)',
                      cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}
                  >{e}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="form-label">Color</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: 160 }}>
                {COLORS.map(c => (
                  <button key={c} type="button" onClick={() => set('color', c)}
                    style={{
                      width: 30, height: 30, borderRadius: 8, background: c,
                      border: `3px solid ${form.color === c ? 'white' : 'transparent'}`,
                      cursor: 'pointer'
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Idea Name *</label>
            <input
              className="form-input"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="e.g. Yarn & Fabric Stash Tracker"
            />
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={!form.name.trim() || saving}>
            {saving ? 'Saving...' : 'Add Idea'}
          </button>
        </div>
      </div>
    </div>
  );
}
