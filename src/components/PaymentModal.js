// src/components/PaymentModal.js
import React, { useState } from 'react';

const METHODS = ['Bank Transfer', 'Check', 'PayPal', 'Venmo', 'Zelle', 'Stripe', 'Credit Card', 'Cash', 'Other'];

export default function PaymentModal({ type, onSave, onClose }) {
  const [form, setForm] = useState({
    type,
    description: '',
    recipient: '',
    amount: '',
    date: new Date().toISOString().split('T')[0],
    method: '',
    notes: ''
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const isOut = type === 'out';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title" style={{ color: isOut ? 'var(--coral)' : 'var(--green)' }}>
            {isOut ? 'Log Payment Out' : 'Log Payment In'}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ padding: '10px 12px', background: isOut ? 'var(--coral-dim)' : 'rgba(34,197,94,0.1)', border: `1px solid ${isOut ? 'rgba(255,91,91,0.2)' : 'rgba(34,197,94,0.2)'}`, borderRadius: 8, fontSize: 12, color: isOut ? 'var(--coral)' : 'var(--green)', marginBottom: 16 }}>
            {isOut ? 'Recording a payment you made to a developer or vendor.' : 'Recording a payment received from a client or app revenue.'}
          </div>
          <div className="form-group">
            <label className="form-label">{isOut ? 'What was this payment for? *' : 'Payment description *'}</label>
            <input className="form-input" value={form.description} onChange={e => set('description', e.target.value)} placeholder={isOut ? 'e.g. RV Vault - Phase 2 build' : 'e.g. Client deposit - Website build'} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{isOut ? 'Paid To' : 'Received From'}</label>
              <input className="form-input" value={form.recipient} onChange={e => set('recipient', e.target.value)} placeholder={isOut ? 'Developer / vendor name' : 'Client name'} />
            </div>
            <div className="form-group">
              <label className="form-label">Amount ($) *</label>
              <input className="form-input" type="number" step="0.01" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Date *</label>
              <input className="form-input" type="date" value={form.date} onChange={e => set('date', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Payment Method</label>
              <select className="form-select" value={form.method} onChange={e => set('method', e.target.value)}>
                <option value="">Select...</option>
                {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-textarea" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Invoice number, milestone covered, etc." style={{ minHeight: 60 }} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            style={{ background: isOut ? 'var(--coral)' : 'var(--green)', borderColor: isOut ? 'var(--coral)' : 'var(--green)' }}
            onClick={() => { if (form.description.trim() && form.amount) onSave({ ...form, amount: parseFloat(form.amount) }); }}
            disabled={!form.description.trim() || !form.amount}
          >
            {isOut ? 'Log Payment Out' : 'Log Payment In'}
          </button>
        </div>
      </div>
    </div>
  );
}
