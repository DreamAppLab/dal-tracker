// src/components/ExpenseModal.js
import React, { useState } from 'react';

const CATEGORIES = ['hosting', 'api', 'devops', 'platform', 'domain', 'marketing', 'tools', 'other'];

export default function ExpenseModal({ expense, onSave, onClose }) {
  const [form, setForm] = useState(expense || {
    name: '', amount: 0, period: 'monthly', category: 'api'
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{expense ? 'Edit Expense' : 'Add Expense'}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Name *</label>
            <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Mapbox API, EAS Build, AWS S3" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Amount ($)</label>
              <input className="form-input" type="number" step="0.01" value={form.amount} onChange={e => set('amount', parseFloat(e.target.value) || 0)} />
            </div>
            <div className="form-group">
              <label className="form-label">Billing Period</label>
              <select className="form-select" value={form.period} onChange={e => set('period', e.target.value)}>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
                <option value="one-time">One-time</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Category</label>
            <select className="form-select" value={form.category} onChange={e => set('category', e.target.value)}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {form.period === 'yearly' && (
            <div style={{ padding: '10px 12px', background: 'var(--amber-dim)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, fontSize: 12, color: 'var(--amber)' }}>
              Monthly equivalent: ${(form.amount / 12).toFixed(2)}/mo
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={() => { if (form.name.trim()) onSave(form); }}
            disabled={!form.name.trim()}
          >
            {expense ? 'Save Changes' : 'Add Expense'}
          </button>
        </div>
      </div>
    </div>
  );
}
