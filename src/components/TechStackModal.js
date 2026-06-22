// src/components/TechStackModal.js
import React, { useState } from 'react';

const COMMON_LAYERS = ['Framework', 'Language', 'Database', 'Auth', 'Hosting', 'API', 'Storage', 'Build', 'Analytics', 'Payments', 'Email', 'Maps', 'Distribution', 'CDN', 'Cache', 'Queue', 'Other'];

export default function TechStackModal({ onSave, onClose }) {
  const [form, setForm] = useState({ layer: '', tech: '' });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Add Tech Stack Layer</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Layer *</label>
            <input
              className="form-input"
              list="layer-suggestions"
              value={form.layer}
              onChange={e => setForm(f => ({ ...f, layer: e.target.value }))}
              placeholder="e.g. Framework, Database, Hosting"
            />
            <datalist id="layer-suggestions">
              {COMMON_LAYERS.map(l => <option key={l} value={l} />)}
            </datalist>
          </div>
          <div className="form-group">
            <label className="form-label">Technology *</label>
            <input
              className="form-input"
              value={form.tech}
              onChange={e => setForm(f => ({ ...f, tech: e.target.value }))}
              placeholder="e.g. React Native / Expo SDK 54"
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={() => { if (form.layer.trim() && form.tech.trim()) onSave(form); }}
            disabled={!form.layer.trim() || !form.tech.trim()}
          >
            Add Layer
          </button>
        </div>
      </div>
    </div>
  );
}
