// src/components/EditModal.js
import React, { useState } from 'react';

const COMMON_PAGES = ['Dashboard', 'Homepage', 'Settings', 'Profile', 'Navigation', 'Onboarding', 'Login', 'Signup', 'Other'];

export default function EditModal({ edit, onSave, onClose }) {
  const [form, setForm] = useState(edit || {
    page: '', location: '', item: '', notes: '', priority: 'medium', completed: false
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{edit ? 'Edit Item' : 'Add Edit Needed'}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Page / Screen *</label>
              <input
                className="form-input"
                list="page-suggestions"
                value={form.page}
                onChange={e => set('page', e.target.value)}
                placeholder="e.g. Dashboard"
              />
              <datalist id="page-suggestions">
                {COMMON_PAGES.map(p => <option key={p} value={p} />)}
              </datalist>
            </div>
            <div className="form-group">
              <label className="form-label">Menu / Location *</label>
              <input className="form-input" value={form.location} onChange={e => set('location', e.target.value)} placeholder="e.g. Top Nav, Sidebar" />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Specific Item *</label>
            <input className="form-input" value={form.item} onChange={e => set('item', e.target.value)} placeholder="What specifically needs to change?" />
          </div>
          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-textarea" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Additional context, requirements, or details..." />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Priority</label>
              <select className="form-select" value={form.priority} onChange={e => set('priority', e.target.value)}>
                <option value="high">🔴 High</option>
                <option value="medium">🟡 Medium</option>
                <option value="low">🔵 Low</option>
              </select>
            </div>
            <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)', paddingBottom: 10 }}>
                <input type="checkbox" checked={form.completed} onChange={e => set('completed', e.target.checked)} />
                Already completed
              </label>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={() => { if (form.page.trim() && form.item.trim()) onSave(form); }}
            disabled={!form.page.trim() || !form.item.trim()}
          >
            {edit ? 'Save Changes' : 'Add Edit'}
          </button>
        </div>
      </div>
    </div>
  );
}
