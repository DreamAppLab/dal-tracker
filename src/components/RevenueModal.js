// src/components/RevenueModal.js
import React, { useMemo, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { format, subDays, startOfDay, endOfDay, parseISO, isWithinInterval, isValid } from 'date-fns';
import { db } from '../firebase';

const PACKAGE_OPTIONS = ['All', 'Standard', 'Pro', 'Upgrade', 'Subscription', 'One-Time'];

const MODEL_TO_PACKAGE = {
  freemium: 'Subscription',
  subscription: 'Subscription',
  paid: 'One-Time',
  'one-time': 'One-Time',
  'lead-gen': 'One-Time',
};

function getPackage(project) {
  return project.revenue?.package || MODEL_TO_PACKAGE[project.revenue?.model] || 'Subscription';
}

function getPlatform(project) {
  const p = (project.platform || '').toLowerCase();
  if (p === 'mobile') return 'iOS / Android';
  if (p === 'ios') return 'iOS';
  if (p === 'android') return 'Android';
  if (p === 'web') return 'Web';
  return project.platform || '—';
}

function getRowDate(project) {
  const raw = project.revenue?.date || project.launchDate;
  if (!raw) return null;
  const parsed = parseISO(raw);
  return isValid(parsed) ? parsed : null;
}

function formatPlatformDate(date) {
  if (!date) return '—';
  return format(date, 'MMM d, yyyy');
}

function getDateRange(preset, customFrom, customTo) {
  const today = endOfDay(new Date());
  switch (preset) {
    case 'today':
      return { start: startOfDay(new Date()), end: today };
    case '7d':
      return { start: startOfDay(subDays(new Date(), 7)), end: today };
    case '30d':
      return { start: startOfDay(subDays(new Date(), 30)), end: today };
    case '90d':
      return { start: startOfDay(subDays(new Date(), 90)), end: today };
    case 'custom': {
      const start = customFrom ? startOfDay(parseISO(customFrom)) : null;
      const end = customTo ? endOfDay(parseISO(customTo)) : today;
      return { start: isValid(start) ? start : null, end: isValid(end) ? end : today };
    }
    case 'all':
    default:
      return { start: null, end: null };
  }
}

export default function RevenueModal({ projects, onClose, onUpdateProject }) {
  const [datePreset, setDatePreset] = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [packages, setPackages] = useState(() => new Set(['All']));
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ monthly: 0, total: 0 });
  const [saving, setSaving] = useState(false);

  const togglePackage = (pkg) => {
    setPackages((prev) => {
      const next = new Set(prev);
      if (pkg === 'All') return new Set(['All']);
      next.delete('All');
      if (next.has(pkg)) next.delete(pkg);
      else next.add(pkg);
      if (next.size === 0) return new Set(['All']);
      return next;
    });
  };

  const filteredRows = useMemo(() => {
    const range = getDateRange(datePreset, customFrom, customTo);

    return projects
      .map((project) => ({
        project,
        package: getPackage(project),
        monthly: project.revenue?.monthly || 0,
        total: project.revenue?.total || 0,
        date: getRowDate(project),
        platform: getPlatform(project),
      }))
      .filter((row) => {
        if (!packages.has('All') && !packages.has(row.package)) return false;
        if (range.start && range.end && row.date) {
          return isWithinInterval(row.date, { start: range.start, end: range.end });
        }
        if (range.start && range.end && !row.date && datePreset !== 'all') return false;
        return true;
      });
  }, [projects, datePreset, customFrom, customTo, packages]);

  const totals = useMemo(
    () => filteredRows.reduce(
      (acc, row) => ({ monthly: acc.monthly + row.monthly, total: acc.total + row.total }),
      { monthly: 0, total: 0 }
    ),
    [filteredRows]
  );

  const startEdit = (row) => {
    setEditingId(row.project.id);
    setEditForm({ monthly: row.monthly, total: row.total });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ monthly: 0, total: 0 });
  };

  const saveEdit = async (project) => {
    setSaving(true);
    try {
      const monthly = parseFloat(editForm.monthly) || 0;
      const total = parseFloat(editForm.total) || 0;
      const revenue = { ...(project.revenue || {}), monthly, total };
      await updateDoc(doc(db, 'projects', project.id), { revenue });
      onUpdateProject({ ...project, revenue });
      cancelEdit();
    } catch (err) {
      console.error('Failed to save revenue:', err);
      alert('Failed to save revenue. Check the console for details.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 960 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Total Revenue — All Apps</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          <div
            style={{
              padding: '10px 14px',
              marginBottom: 16,
              borderRadius: 8,
              background: 'var(--amber-dim, rgba(245, 158, 11, 0.1))',
              border: '1px solid rgba(245, 158, 11, 0.25)',
              fontSize: 13,
              color: 'var(--amber)',
            }}
          >
            Revenue data is manually entered. RevenueCat integration coming soon.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 8 }}>
            <div>
              <div className="form-label">Date Range</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                {[
                  { id: 'today', label: 'Today' },
                  { id: '7d', label: 'Last 7 Days' },
                  { id: '30d', label: 'Last 30 Days' },
                  { id: '90d', label: 'Last 90 Days' },
                  { id: 'all', label: 'All Time' },
                  { id: 'custom', label: 'Custom' },
                ].map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    className={`btn btn-sm ${datePreset === id ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setDatePreset(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {datePreset === 'custom' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                  <input
                    className="form-input"
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                  />
                  <span>to</span>
                  <input
                    className="form-input"
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                  />
                </div>
              )}
            </div>

            <div>
              <div className="form-label">Package</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
                {PACKAGE_OPTIONS.map((pkg) => (
                  <label key={pkg} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={packages.has(pkg)}
                      onChange={() => togglePackage(pkg)}
                    />
                    {pkg}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="subscriptions-table-wrap" style={{ marginTop: 16 }}>
            <table className="stack-table subscriptions-table" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>App Name</th>
                  <th>Package</th>
                  <th>Amount</th>
                  <th>Date</th>
                  <th>Platform</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 24 }}>
                      No revenue entries match the current filters.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const isEditing = editingId === row.project.id;
                    return (
                      <tr key={row.project.id}>
                        <td style={{ textAlign: 'left' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: 8,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: `${row.project.color}18`,
                                border: `1px solid ${row.project.color}30`,
                                fontSize: 16,
                              }}
                            >
                              {row.project.logo}
                            </span>
                            <div>
                              <div className="subscriptions-name">{row.project.name}</div>
                              {isEditing ? (
                                <div style={{ display: 'flex', gap: 10, marginTop: 6, fontSize: 11 }}>
                                  <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    MRR
                                    <input
                                      className="form-input"
                                      type="number"
                                      value={editForm.monthly}
                                      onChange={(e) => setEditForm((f) => ({ ...f, monthly: e.target.value }))}
                                      style={{ width: 90 }}
                                    />
                                  </label>
                                  <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    Total
                                    <input
                                      className="form-input"
                                      type="number"
                                      value={editForm.total}
                                      onChange={(e) => setEditForm((f) => ({ ...f, total: e.target.value }))}
                                      style={{ width: 90 }}
                                    />
                                  </label>
                                </div>
                              ) : (
                                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                                  MRR ${row.monthly.toLocaleString()} · Total ${row.total.toLocaleString()}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td>{row.package}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--amber)', fontWeight: 700 }}>
                          ${row.total.toLocaleString()}
                        </td>
                        <td>{formatPlatformDate(row.date)}</td>
                        <td>{row.platform}</td>
                        <td>
                          {isEditing ? (
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                disabled={saving}
                                onClick={() => saveEdit(row.project)}
                              >
                                Save
                              </button>
                              <button type="button" className="btn btn-ghost btn-sm" onClick={cancelEdit}>
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => startEdit(row)}>
                              Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {filteredRows.length > 0 && (
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--border-active)' }}>
                    <td style={{ textAlign: 'left', fontWeight: 700 }}>Totals</td>
                    <td />
                    <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--amber)' }}>
                      ${totals.total.toLocaleString()}
                    </td>
                    <td colSpan={2} style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      MRR: ${totals.monthly.toLocaleString()}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
