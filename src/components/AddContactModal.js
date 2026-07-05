import React, { useState } from 'react';

const E164_REGEX = /^\+[1-9]\d{1,14}$/;

export default function AddContactModal({ onAdd, onClose }) {
  const [form, setForm] = useState({ name: '', phone: '' });
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const name = form.name.trim();
    const phone = form.phone.trim();

    if (!name) return;

    if (!E164_REGEX.test(phone)) {
      setError('Phone must be in E.164 format (e.g. +19045551234)');
      return;
    }

    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + `-${Date.now()}`;
    onAdd({ id, name, phone, textedApps: {} });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Add Contact</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">Name</label>
              <input
                className="form-input"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Jane Smith"
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Phone (E.164)</label>
              <input
                className="form-input"
                value={form.phone}
                onChange={e => {
                  setForm(f => ({ ...f, phone: e.target.value }));
                  setError('');
                }}
                placeholder="+19045551234"
                required
              />
              {error && <div className="form-error" style={{ color: 'var(--red)', fontSize: 12, marginTop: 4 }}>{error}</div>}
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Add Contact</button>
          </div>
        </form>
      </div>
    </div>
  );
}
