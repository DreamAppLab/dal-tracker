import React, { useState } from 'react';
import { SUBSCRIPTION_APPS } from '../data/subscriptionsData';

const CATEGORIES = [
  { value: 'hosting', label: 'Hosting' },
  { value: 'api', label: 'API' },
  { value: 'devops', label: 'DevOps' },
  { value: 'platform', label: 'Platform' },
  { value: 'domain', label: 'Domain' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'tools', label: 'Tools' },
  { value: 'other', label: 'Other' },
];

export default function AddSubscriptionModal({ onAdd, onClose }) {
  const [form, setForm] = useState({
    name: '',
    amount: '',
    category: 'tools',
    apps: {},
  });

  const toggleApp = (appId) => {
    setForm(prev => ({
      ...prev,
      apps: { ...prev.apps, [appId]: !prev.apps[appId] },
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    const id = form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + `-${Date.now()}`;
    onAdd({
      id,
      name: form.name.trim(),
      amount: parseFloat(form.amount) || 0,
      period: 'monthly',
      category: form.category,
      apps: form.apps,
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Add Subscription</div>
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
                placeholder="e.g. Sentry"
                required
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Monthly Price ($)</label>
                <input
                  className="form-input"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Category</label>
                <select
                  className="form-select"
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                >
                  {CATEGORIES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Applies to Apps</label>
              <div className="subscription-apps-checkboxes">
                {SUBSCRIPTION_APPS.map(app => (
                  <label key={app.id} className="subscriptions-checkbox-label">
                    <input
                      type="checkbox"
                      checked={!!form.apps[app.id]}
                      onChange={() => toggleApp(app.id)}
                    />
                    {app.name}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Add Subscription</button>
          </div>
        </form>
      </div>
    </div>
  );
}
