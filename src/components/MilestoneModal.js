// src/components/MilestoneModal.js
import React, { useState } from 'react';

export default function MilestoneModal({ milestone, onSave, onClose }) {
  const [form, setForm] = useState(milestone || {
    title: '', description: '', amount: 0, dueDate: '', completed: false
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{milestone ? 'Edit Milestone' : 'Add Milestone'}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Title *</label>
            <input className="form-input" value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. App Store Launch" />
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea className="form-textarea" value={form.description} onChange={e => set('description', e.target.value)} placeholder="What does this milestone involve?" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Budget / Value ($)</label>
              <input className="form-input" type="number" value={form.amount} onChange={e => set('amount', parseFloat(e.target.value) || 0)} placeholder="0" />
            </div>
            <div className="form-group">
              <label className="form-label">Due Date</label>
              <input className="form-input" type="date" value={form.dueDate} onChange={e => set('dueDate', e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={form.completed} onChange={e => set('completed', e.target.checked)} />
              Mark as completed
            </label>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={() => { if (form.title.trim()) onSave(form); }}
            disabled={!form.title.trim()}
          >
            {milestone ? 'Save Changes' : 'Add Milestone'}
          </button>
        </div>
      </div>
    </div>
  );
}
