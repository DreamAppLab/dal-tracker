// src/components/EditModal.js
import React, { useState } from 'react';

const COMMON_PAGES = ['Dashboard', 'Homepage', 'Settings', 'Profile', 'Navigation', 'Onboarding', 'Login', 'Signup', 'Adding RV', 'Maintenance Item', 'Vendor', 'Campgrounds', 'Travel Stats', 'Work Orders', 'Other'];

export default function EditModal({ edit, onSave, onClose }) {
  const [form, setForm] = useState(edit || {
    page: '', location: '', item: '', notes: '', priority: 'medium', 
    completed: false, sentToDev: false, amount: 0,
    createdAt: new Date().toISOString()
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{edit ? 'Edit Item' : 'Add Edit Needed'}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>???</button>
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
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Dev Cost ($) <span style={{color:'var(--text-muted)',fontWeight:400}}>(if applicable)</span></label>
              <input 
                className="form-input" 
                type="number" 
                step="0.01"
                value={form.amount || ''} 
                onChange={e => set('amount', parseFloat(e.target.value) || 0)} 
                placeholder="0.00"
              />
            </div>
          </div>
          {form.amount > 0 && (
            <div style={{ padding: '10px 12px', background: 'var(--amber-dim)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, fontSize: 12, color: 'var(--amber)', marginBottom: 12 }}>
              This edit will appear as a <strong>${form.amount.toFixed(2)} outstanding charge</strong> in Financials until marked completed.
            </div>
          )}
          <div style={{ display: 'flex', gap: 20, marginTop: 4 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={form.completed} onChange={e => set('completed', e.target.checked)} />
              Completed
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={form.sentToDev} onChange={e => set('sentToDev', e.target.checked)} />
              Sent to Developer
            </label>
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
