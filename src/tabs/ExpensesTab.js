import React, { useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import ImportStatementModal from '../components/ImportStatementModal';
import {
  CATEGORY_BADGE,
  EXPENSE_APPS,
  EXPENSE_CATEGORIES,
  SORT_OPTIONS,
  SOURCE_META,
  TAX_YEARS,
  formatMoney,
  isValidReceiptFile,
  taxYearFromDate,
  todayISO,
  fileToBase64,
} from '../data/expensesData';

const CURRENT_YEAR = new Date().getFullYear();

function emptyFilters() {
  return {
    taxYear: String(TAX_YEARS.includes(CURRENT_YEAR) ? CURRENT_YEAR : 2026),
    from: '',
    to: '',
    category: '',
    appId: '',
    search: '',
    sort: 'date-desc',
  };
}

function emptyForm() {
  return {
    vendor: '',
    amount: '',
    date: todayISO(),
    category: EXPENSE_CATEGORIES[0],
    appId: EXPENSE_APPS[0],
    description: '',
  };
}

function formatExpenseDate(value) {
  if (!value) return '—';
  try {
    return format(parseISO(String(value).slice(0, 10)), 'MMM d, yyyy');
  } catch (_) {
    return String(value);
  }
}

function csvEscape(value) {
  const s = String(value == null ? '' : value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function filterSlug(filters) {
  const parts = [`TaxYear${filters.taxYear}`];
  if (filters.appId) parts.push(filters.appId.replace(/\s+/g, ''));
  if (filters.category) parts.push(filters.category.replace(/[^a-zA-Z0-9]+/g, ''));
  if (filters.from || filters.to) parts.push(`${filters.from || 'start'}-to-${filters.to || 'end'}`);
  if (filters.search) parts.push('Search');
  return parts.join('_');
}

async function apiJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.detail || 'Request failed');
  return data;
}

function ExpenseFormModal({ expense, onClose, onSaved }) {
  const [form, setForm] = useState(() => {
    if (!expense) return emptyForm();
    return {
      vendor: expense.vendor || '',
      amount: expense.amount == null ? '' : String(expense.amount),
      date: expense.date || todayISO(),
      category: expense.category || EXPENSE_CATEGORIES[0],
      appId: expense.appId || EXPENSE_APPS[0],
      description: expense.description || '',
    };
  });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const isEdit = Boolean(expense && expense.id);

  const handleFile = (next) => {
    if (!next) {
      setFile(null);
      return;
    }
    if (!isValidReceiptFile(next)) {
      setError('Receipt must be a PDF, JPG, or PNG.');
      return;
    }
    if (next.size > 4 * 1024 * 1024) {
      setError('Receipt must be 4MB or smaller.');
      return;
    }
    setError('');
    setFile(next);
  };

  const handleSave = async () => {
    const vendor = form.vendor.trim();
    const amount = Number(form.amount);
    if (!vendor) {
      setError('Vendor is required.');
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      setError('Amount is required.');
      return;
    }
    if (!form.date) {
      setError('Date is required.');
      return;
    }
    if (!form.category || !form.appId) {
      setError('Category and App are required.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const payload = {
        vendor,
        amount,
        date: form.date,
        category: form.category,
        appId: form.appId,
        description: form.description.trim(),
        taxYear: taxYearFromDate(form.date),
      };

      if (file) {
        payload.attachmentBase64 = await fileToBase64(file);
        payload.attachmentName = file.name;
        payload.attachmentType = file.type || 'application/octet-stream';
      }

      if (isEdit) {
        payload.needsReview = false;
        await apiJson(`/api/expenses?id=${encodeURIComponent(expense.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        payload.source = 'manual';
        payload.parsedByAI = false;
        payload.needsReview = false;
        await apiJson('/api/expenses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      onSaved();
    } catch (err) {
      setError(err.message || 'Could not save expense.');
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{isEdit ? 'Edit Expense' : 'Add Expense'}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={saving}>✕</button>
        </div>
        <div className="modal-body">
          {expense && expense.needsReview && (
            <div className="expenses-review-banner">
              This expense was parsed from email and needs review. Confirm the fields and save.
            </div>
          )}
          <div className="form-group">
            <label className="form-label">Vendor *</label>
            <input
              className="form-input"
              value={form.vendor}
              onChange={(e) => set('vendor', e.target.value)}
              placeholder="e.g. Firebase, Apple Developer, Starbucks"
            />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Amount *</label>
              <input
                className="form-input"
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => set('amount', e.target.value)}
                placeholder="25.00"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Date *</label>
              <input
                className="form-input"
                type="date"
                value={form.date}
                onChange={(e) => set('date', e.target.value)}
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Category *</label>
              <select className="form-select" value={form.category} onChange={(e) => set('category', e.target.value)}>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">App *</label>
              <select className="form-select" value={form.appId} onChange={(e) => set('appId', e.target.value)}>
                {EXPENSE_APPS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea
              className="form-textarea"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Optional note"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Receipt (PDF, JPG, PNG)</label>
            <input
              className="form-input"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              onChange={(e) => handleFile(e.target.files && e.target.files[0])}
            />
            {file && <div className="expenses-file-name">{file.name}</div>}
            {!file && expense && expense.attachmentUrl && (
              <a className="expenses-receipt-link" href={expense.attachmentUrl} target="_blank" rel="noreferrer">
                Current receipt
              </a>
            )}
          </div>
          {error && <div className="ft-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ExpensesTab() {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(emptyFilters);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editing, setEditing] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'expenses'),
      (snapshot) => {
        setExpenses(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, []);

  const yearBounds = useMemo(() => {
    const y = filters.taxYear;
    return { min: `${y}-01-01`, max: `${y}-12-31` };
  }, [filters.taxYear]);

  const setFilter = (key, value) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'taxYear') {
        if (next.from && !next.from.startsWith(value)) next.from = '';
        if (next.to && !next.to.startsWith(value)) next.to = '';
      }
      return next;
    });
  };

  const filtered = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    const rows = expenses.filter((row) => {
      if (filters.taxYear && String(row.taxYear || taxYearFromDate(row.date)) !== String(filters.taxYear)) {
        return false;
      }
      if (filters.category && row.category !== filters.category) return false;
      if (filters.appId && row.appId !== filters.appId) return false;
      if (filters.from && String(row.date || '') < filters.from) return false;
      if (filters.to && String(row.date || '') > filters.to) return false;
      if (search) {
        const vendor = String(row.vendor || '').toLowerCase();
        const description = String(row.description || '').toLowerCase();
        if (!vendor.includes(search) && !description.includes(search)) return false;
      }
      return true;
    });

    rows.sort((a, b) => {
      if (filters.sort === 'date-asc') return String(a.date || '').localeCompare(String(b.date || ''));
      if (filters.sort === 'amount-desc') return Number(b.amount || 0) - Number(a.amount || 0);
      if (filters.sort === 'amount-asc') return Number(a.amount || 0) - Number(b.amount || 0);
      if (filters.sort === 'vendor-asc') return String(a.vendor || '').localeCompare(String(b.vendor || ''));
      return String(b.date || '').localeCompare(String(a.date || ''));
    });

    return rows;
  }, [expenses, filters]);

  const total = filtered.reduce((sum, row) => sum + Number(row.amount || 0), 0);

  const exportCsv = () => {
    const header = ['Date', 'Vendor', 'Category', 'App', 'Amount', 'Description', 'Source', 'Tax Year'];
    const lines = [header.join(',')];
    filtered.forEach((row) => {
      lines.push([
        csvEscape(row.date || ''),
        csvEscape(row.vendor || ''),
        csvEscape(row.category || ''),
        csvEscape(row.appId || ''),
        csvEscape(Number(row.amount || 0).toFixed(2)),
        csvEscape(row.description || ''),
        csvEscape(row.source || ''),
        csvEscape(row.taxYear || ''),
      ].join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `DAL_Expenses_${filterSlug(filters)}_${todayISO()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await apiJson(`/api/expenses?id=${encodeURIComponent(pendingDelete.id)}`, { method: 'DELETE' });
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(err.message || 'Could not delete expense.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="page expenses-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Expenses</h1>
          <p className="page-subtitle">
            Track receipts for tax time. Forward to expenses@inbound.dreamapplab.com or add them here.
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={exportCsv} disabled={!filtered.length}>
            Export
          </button>
          <button className="btn btn-secondary" onClick={() => setShowImport(true)}>
            Import Statement
          </button>
          <button className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>
            + Add Expense
          </button>
        </div>
      </div>

      <div className="expenses-filters">
        <div className="form-group">
          <label className="form-label">Tax Year</label>
          <select className="form-select" value={filters.taxYear} onChange={(e) => setFilter('taxYear', e.target.value)}>
            {TAX_YEARS.map((y) => (
              <option key={y} value={String(y)}>{y}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">From</label>
          <input
            className="form-input"
            type="date"
            min={yearBounds.min}
            max={yearBounds.max}
            value={filters.from}
            onChange={(e) => setFilter('from', e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label">To</label>
          <input
            className="form-input"
            type="date"
            min={yearBounds.min}
            max={yearBounds.max}
            value={filters.to}
            onChange={(e) => setFilter('to', e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Category</label>
          <select className="form-select" value={filters.category} onChange={(e) => setFilter('category', e.target.value)}>
            <option value="">All</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">App</label>
          <select className="form-select" value={filters.appId} onChange={(e) => setFilter('appId', e.target.value)}>
            <option value="">All</option>
            {EXPENSE_APPS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <div className="form-group expenses-search">
          <label className="form-label">Search</label>
          <input
            className="form-input"
            value={filters.search}
            onChange={(e) => setFilter('search', e.target.value)}
            placeholder="Vendor or description"
          />
        </div>
        <div className="form-group">
          <label className="form-label">Sort by</label>
          <select className="form-select" value={filters.sort} onChange={(e) => setFilter('sort', e.target.value)}>
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="form-group expenses-clear">
          <button className="btn btn-secondary" onClick={() => setFilters(emptyFilters())}>
            Clear filters
          </button>
        </div>
      </div>

      <div className="expenses-summary">
        <div>
          Total expenses for current filter: <strong>{formatMoney(total)}</strong>
        </div>
        <div>
          Number of expenses: <strong>{filtered.length}</strong> {filtered.length === 1 ? 'item' : 'items'}
        </div>
        {filters.appId && (
          <div>Showing {filtered.length} expenses for {filters.appId}</div>
        )}
        {filters.taxYear && (
          <div>Tax Year {filters.taxYear} — Total: {formatMoney(total)}</div>
        )}
      </div>

      <div className="quotes-table-wrap expenses-table-wrap">
        {loading ? (
          <div className="empty-state">Loading expenses…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🧾</div>
            <div className="empty-state-text">No expenses match these filters.</div>
          </div>
        ) : (
          <table className="quotes-table expenses-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Vendor</th>
                <th>Category</th>
                <th>App</th>
                <th className="expenses-amount-col">Amount</th>
                <th>Source</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const badge = CATEGORY_BADGE[row.category] || CATEGORY_BADGE.Other;
                const source = SOURCE_META[row.source] || SOURCE_META.manual;
                return (
                  <tr key={row.id} className={row.needsReview ? 'expenses-row-review' : ''}>
                    <td>{formatExpenseDate(row.date)}</td>
                    <td>
                      <div className="expenses-vendor">{row.vendor || '—'}</div>
                      {row.needsReview && <span className="expenses-review-badge">Needs review</span>}
                    </td>
                    <td>
                      <span className="expenses-cat-badge" style={{ color: badge.color, background: badge.bg }}>
                        {row.category || '—'}
                      </span>
                    </td>
                    <td>{row.appId || '—'}</td>
                    <td className="expenses-amount-col">{formatMoney(row.amount)}</td>
                    <td>
                      <span className="expenses-source" title={source.label}>
                        {source.icon}
                        {row.attachmentUrl && (
                          <a href={row.attachmentUrl} target="_blank" rel="noreferrer" title="Open receipt">📎</a>
                        )}
                      </span>
                    </td>
                    <td>
                      <div className="item-actions">
                        <button
                          className="icon-btn"
                          title="Edit"
                          onClick={() => { setEditing(row); setShowForm(true); }}
                        >
                          ✎
                        </button>
                        <button
                          className="icon-btn danger"
                          title="Delete"
                          onClick={() => { setDeleteError(''); setPendingDelete(row); }}
                        >
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showForm && (
        <ExpenseFormModal
          expense={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); }}
        />
      )}

      {showImport && (
        <ImportStatementModal
          onClose={() => setShowImport(false)}
          onManualEntry={() => {
            setShowImport(false);
            setEditing(null);
            setShowForm(true);
          }}
        />
      )}

      {pendingDelete && (
        <div className="modal-overlay" onClick={() => !deleting && setPendingDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Delete expense</div>
              <button className="btn btn-ghost btn-sm" onClick={() => setPendingDelete(null)} disabled={deleting}>✕</button>
            </div>
            <div className="modal-body">
              <p>
                Delete this expense from {pendingDelete.vendor} for {formatMoney(pendingDelete.amount)}? This cannot be undone.
              </p>
              {deleteError && <div className="ft-error" style={{ marginTop: 12 }}>{deleteError}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setPendingDelete(null)} disabled={deleting}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={confirmDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
