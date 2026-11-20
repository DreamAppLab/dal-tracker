// Small shared Books UI pieces.
import React from 'react';
import * as core from './core';

export const fmt = (c, o) => core.formatCents(c, o);

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fmtDate(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${m}/${d}/${y.slice(2)}`;
}

export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return `${new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} '${String(y).slice(2)}`;
}

/** Picker value <-> line fields. */
export function pickFromLine(line) {
  if (!line) return '';
  if (line.transferAccountId && line.transferAccountId.includes('_ic_')) return `ic:${line.icCategoryId || ''}`;
  if (line.transferAccountId) return `xfer:${line.transferAccountId}`;
  if (line.categoryId) return `cat:${line.categoryId}`;
  return '';
}

export function lineFromPick(value, companyId) {
  const v = String(value || '');
  if (v.startsWith('cat:')) return { categoryId: v.slice(4), transferAccountId: null, icCategoryId: null };
  if (v.startsWith('xfer:')) return { categoryId: null, transferAccountId: v.slice(5), icCategoryId: null };
  if (v.startsWith('ic:')) return { categoryId: null, transferAccountId: core.ids.intercompany(companyId), icCategoryId: v.slice(3) || null };
  return { categoryId: null, transferAccountId: null, icCategoryId: null };
}

export function pickFromTxn(t) {
  if (t.splits && t.splits.length) return 'split';
  return pickFromLine(t);
}

/** Human label for what a transaction / line is booked to. */
export function describeLine(line, ledger, txn) {
  const { accountsById, categoriesById, otherMeta } = ledger;
  if (line.transferAccountId) {
    const acct = accountsById[line.transferAccountId];
    if (acct && acct.kind === 'intercompany') {
      if (txn && txn.settlementId) return `Intercompany settlement · ${otherMeta.short}`;
      const cat = line.icCategoryId ? categoriesById[line.icCategoryId] : null;
      return `Paid for ${otherMeta.short}${cat ? ` · ${cat.name}` : ' · (category not set)'}`;
    }
    const prefix = txn && txn.role === 'leg' ? 'Transfer from' : 'Transfer to';
    return `${prefix} ${acct ? acct.name : 'account'}`;
  }
  if (line.categoryId) {
    const cat = categoriesById[line.categoryId];
    return cat ? cat.name : 'Unknown category';
  }
  return 'Uncategorized';
}

export function describeTxn(t, ledger) {
  if (t.role === 'mirror') {
    const cat = t.categoryId ? ledger.categoriesById[t.categoryId] : null;
    return `${cat ? cat.name : 'Uncategorized'} · paid by ${ledger.otherMeta.short}`;
  }
  if (t.splits && t.splits.length) return `Split · ${t.splits.length} lines`;
  return describeLine(t, ledger, t);
}

/**
 * Category <select> with groups: expense, income, equity, transfers (same
 * company), intercompany (paid for the other company → their category).
 */
export function CategorySelect({ ledger, value, onChange, accountId, allowSplit = true, className = 'bk-input', autoFocus, onKeyDown, id, disabled, inputRef }) {
  const { categories, accounts, otherCategories, otherMeta } = ledger;
  const active = categories.filter((c) => !c.archived || value === `cat:${c.id}`);
  const group = (kind) => active.filter((c) => c.kind === kind);
  const transferTargets = accounts.filter((a) => a.id !== accountId && a.kind !== 'intercompany');
  const icCats = otherCategories.filter((c) => !c.archived && c.kind !== 'equity');
  return (
    <select id={id} ref={inputRef} className={className} value={value} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus} onKeyDown={onKeyDown} disabled={disabled}>
      <option value="">Uncategorized</option>
      {allowSplit && <option value="split">Split…</option>}
      <optgroup label="Expense">{group('expense').map((c) => <option key={c.id} value={`cat:${c.id}`}>{c.name}</option>)}</optgroup>
      <optgroup label="Income">{group('income').map((c) => <option key={c.id} value={`cat:${c.id}`}>{c.name}</option>)}</optgroup>
      <optgroup label="Owner equity (not P&L)">{group('equity').map((c) => <option key={c.id} value={`cat:${c.id}`}>{c.name}</option>)}</optgroup>
      <optgroup label="Transfer (same company)">{transferTargets.map((a) => <option key={a.id} value={`xfer:${a.id}`}>Transfer · {a.name}</option>)}</optgroup>
      <optgroup label={`Paid for ${otherMeta.short} (intercompany)`}>
        <option value="ic:">{otherMeta.short} · category later</option>
        {icCats.map((c) => <option key={c.id} value={`ic:${c.id}`}>{otherMeta.short} · {c.name}</option>)}
      </optgroup>
    </select>
  );
}

export function CompanyBadge({ meta, size = 'sm' }) {
  return (
    <span className={`bk-company-badge bk-company-badge-${size}`} style={{ color: meta.color, background: meta.tint, borderColor: meta.color }}>
      {meta.short}
    </span>
  );
}

export function StatusFlag({ status, onToggle, title }) {
  const label = status === 'reconciled' ? 'R' : status === 'cleared' ? 'C' : '';
  return (
    <button
      type="button"
      className={`bk-flag bk-flag-${status}`}
      onClick={status === 'reconciled' ? undefined : onToggle}
      disabled={status === 'reconciled'}
      title={title || (status === 'reconciled' ? 'Reconciled (locked)' : status === 'cleared' ? 'Cleared — click to mark uncleared' : 'Uncleared — click to mark cleared')}
      aria-label={status}
    >
      {label}
    </button>
  );
}

export function Empty({ children }) {
  return <div className="bk-empty">{children}</div>;
}

export function downloadText(filename, text, type = 'text/csv') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
