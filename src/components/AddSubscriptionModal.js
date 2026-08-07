import React, { useState } from 'react';
import { SUBSCRIPTION_APPS } from '../data/subscriptionsData';

const CATEGORIES = [
  'Development Tools',
  'Infrastructure',
  'Design',
  'Marketing',
  'Legal',
  'Finance',
  'Other',
];

const BILLING_CYCLES = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Annual' },
  { value: 'one-time', label: 'One-time' },
];

function slugifyId(name) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') + `-${Date.now()}`
  );
}

function buildInitialForm(subscription) {
  if (!subscription) {
    return {
      name: '',
      category: 'Development Tools',
      amount: '',
      period: 'monthly',
      renewalDate: '',
      notes: '',
      apps: {},
    };
  }
  return {
    name: subscription.name || '',
    category: subscription.category || 'Other',
    amount: subscription.amount === 0 || subscription.amount ? String(subscription.amount) : '',
    period: subscription.period || 'monthly',
    renewalDate: subscription.renewalDate || '',
    notes: subscription.notes || '',
    apps: { ...(subscription.apps || {}) },
  };
}

export default function AddSubscriptionModal({
  subscription = null,
  apps = SUBSCRIPTION_APPS,
  onSave,
  onClose,
}) {
  const isEdit = !!subscription;
  const [form, setForm] = useState(() => buildInitialForm(subscription));
  const [saving, setSaving] = useState(false);

  const appOptions =
    apps && apps.length > 0
      ? [...apps].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      : SUBSCRIPTION_APPS;

  const categoryOptions = CATEGORIES.includes(form.category)
    ? CATEGORIES
    : [form.category, ...CATEGORIES].filter(Boolean);

  const toggleApp = (appId) => {
    setForm((prev) => ({
      ...prev,
      apps: { ...prev.apps, [appId]: !prev.apps[appId] },
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || form.amount === '') return;
    const amount = parseFloat(form.amount);
    if (Number.isNaN(amount)) return;

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        amount,
        period: form.period,
        category: form.category,
        apps: form.apps,
        renewalDate: form.renewalDate || '',
        notes: form.notes.trim(),
      };

      if (isEdit) {
        await onSave({ ...payload, id: subscription.id });
      } else {
        await onSave({
          ...payload,
          id: slugifyId(form.name.trim()),
          status: 'active',
        });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{isEdit ? 'Edit Subscription' : 'Add Subscription'}</div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">Service Name</label>
              <input
                className="form-input"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Sentry"
                required
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Category</label>
                <select
                  className="form-select"
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                >
                  {categoryOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Cost ($)</label>
                <input
                  className="form-input"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00"
                  required
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Billing Cycle</label>
                <select
                  className="form-select"
                  value={form.period}
                  onChange={(e) => setForm((f) => ({ ...f, period: e.target.value }))}
                >
                  {BILLING_CYCLES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Renewal Date</label>
                <input
                  className="form-input"
                  type="date"
                  value={form.renewalDate}
                  onChange={(e) => setForm((f) => ({ ...f, renewalDate: e.target.value }))}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea
                className="form-input"
                rows={3}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional notes…"
                style={{ resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Assigned Apps</label>
              <div className="subscription-apps-checkboxes">
                {appOptions.map((app) => (
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
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving || !form.name.trim() || form.amount === ''}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
