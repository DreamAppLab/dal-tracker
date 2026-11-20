// Quicken-style account register: running balance, inline edit, keyboard
// entry, splits, cleared flags, soft delete with undo, search/filters/sort,
// and a review queue for uncategorized rows. Loads a date window per account
// (default: this month + 2 before) so reads stay small.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as core from './core';
import { useLedger } from './LedgerContext';
import {
  fetchAccountRange, getTxn, newTxnId, openReceipt, purgeDeleted, saveTransaction, uploadReceipt, setDeleted, setStatus, watchAccountWindow, watchFlag,
} from './ledgerStore';
import SplitEditor from './SplitEditor';
import {
  CategorySelect, describeLine, describeTxn, Empty, fmt, fmtDate, lineFromPick, pickFromTxn, StatusFlag, todayISO,
} from './ui';

const LS_ACCOUNT = 'mc.books.account.';

function windowStartFor(months) {
  const t = todayISO();
  return `${core.addMonths(t.slice(0, 7), -(months - 1))}-01`;
}

function blankForm(date) {
  return { date: date || todayISO(), payee: '', pick: '', memo: '', out: '', in: '', splits: null };
}

function formFromTxn(t) {
  return {
    date: t.date,
    payee: t.payee || '',
    pick: pickFromTxn(t),
    memo: t.memo || '',
    out: t.amountCents < 0 ? core.centsToDecimalString(-t.amountCents) : '',
    in: t.amountCents > 0 ? core.centsToDecimalString(t.amountCents) : '',
    splits: t.splits && t.splits.length ? t.splits : null,
  };
}

function amountFromForm(f) {
  const out = core.parseMoneyToCents(f.out) || 0;
  const inn = core.parseMoneyToCents(f.in) || 0;
  return Math.abs(inn) - Math.abs(out);
}

function columnLabels(kind) {
  if (kind === 'credit_card') return ['Charge', 'Payment'];
  if (kind === 'intercompany') return ['Decrease', 'Increase'];
  return ['Payment', 'Deposit'];
}

export default function Register({ focusTxn, onFocusHandled }) {
  const ledger = useLedger();
  const { companyId, accounts, accountsById, categoriesById, monthly, balances, rules } = ledger;
  const [accountId, setAccountId] = useState(() => {
    try { return window.localStorage.getItem(LS_ACCOUNT + companyId) || ''; } catch (_) { return ''; }
  });
  const [mode, setMode] = useState('register'); // register | review | deleted
  const [months, setMonths] = useState(3);
  const [rows, setRows] = useState(null);
  const [extra, setExtra] = useState([]); // rows loaded by an explicit date filter before the window
  const [loadError, setLoadError] = useState('');
  const [filters, setFilters] = useState({ search: '', from: '', to: '', pick: '*', status: '', min: '', max: '' });
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' });
  const [newForm, setNewForm] = useState(blankForm());
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [selected, setSelected] = useState(null);
  const [split, setSplit] = useState(null); // { target: 'new'|'edit', totalCents, lines }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const [queue, setQueue] = useState(null);
  const [deletedRows, setDeletedRows] = useState(null);
  const newDateRef = useRef(null);
  const tableRef = useRef(null);
  const toastTimer = useRef(null);

  // Pick a valid account for this company.
  useEffect(() => {
    if (!accounts.length) return;
    if (!accountId || !accountsById[accountId] || accountsById[accountId].companyId !== companyId) {
      const fallback = (accounts.find((a) => a.kind === 'credit_card') || accounts[0]).id;
      let stored = '';
      try { stored = window.localStorage.getItem(LS_ACCOUNT + companyId) || ''; } catch (_) { /* ignore */ }
      setAccountId(stored && accountsById[stored] && accountsById[stored].companyId === companyId ? stored : fallback);
    }
  }, [accounts, accountsById, accountId, companyId]);

  useEffect(() => {
    if (!accountId) return;
    try { window.localStorage.setItem(LS_ACCOUNT + companyId, accountId); } catch (_) { /* ignore */ }
  }, [accountId, companyId]);

  const account = accountsById[accountId];
  const isIc = account && account.kind === 'intercompany';
  const windowStart = windowStartFor(months);

  useEffect(() => {
    if (!accountId || !account || account.companyId !== companyId) return undefined;
    setRows(null);
    setExtra([]);
    return watchAccountWindow(companyId, accountId, windowStart, setRows, (e) => setLoadError(e.message));
  }, [companyId, accountId, account, windowStart]);

  // A date filter earlier than the window loads just that range.
  useEffect(() => {
    if (!filters.from || filters.from >= windowStart || !accountId) { setExtra([]); return; }
    let cancelled = false;
    // From the 1st of that month so the running balance stays exact.
    fetchAccountRange(companyId, accountId, core.monthStart(filters.from), core.addDays(windowStart, -1))
      .then((r) => { if (!cancelled) setExtra(r); })
      .catch((e) => setLoadError(e.message));
    return () => { cancelled = true; };
  }, [filters.from, windowStart, companyId, accountId]);

  // Always live (small, indexed equality query) so the queue badge shows a count.
  useEffect(() => watchFlag(companyId, 'needsCategory', true, (r) => setQueue(r.filter((t) => !t.deleted)), (e) => setLoadError(e.message)), [companyId]);
  useEffect(() => {
    if (mode !== 'deleted') return undefined;
    return watchFlag(companyId, 'deleted', true, (r) => setDeletedRows(r.filter((t) => t.role === 'main').sort((a, b) => b.date.localeCompare(a.date))), (e) => setLoadError(e.message));
  }, [mode, companyId]);

  // Reset per-company UI state when switching books.
  useEffect(() => {
    setEditId(null); setEditForm(null); setSelected(null); setNewForm(blankForm()); setMode('register'); setQueue(null); setDeletedRows(null);
  }, [companyId]);

  // Jump to a transaction (from reports / intercompany drill-down).
  useEffect(() => {
    if (!focusTxn || !accountsById[focusTxn.accountId]) return;
    setMode('register');
    setAccountId(focusTxn.accountId);
    if (focusTxn.date < windowStart) {
      const [fy, fm] = focusTxn.date.split('-').map(Number);
      const [ty, tm] = todayISO().split('-').map(Number);
      setMonths((ty - fy) * 12 + (tm - fm) + 1);
    }
    setSelected(focusTxn.id);
    setFilters((f) => ({ ...f, search: '' }));
    if (onFocusHandled) onFocusHandled();
  }, [focusTxn]); // eslint-disable-line react-hooks/exhaustive-deps

  const showToast = useCallback((t) => {
    clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), t.undo ? 9000 : 4000);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // ── Derived rows with running balance ────────────────────────────────
  const live = useMemo(() => {
    const all = [...(extra || []), ...(rows || [])].filter((t) => !t.deleted);
    const seen = new Set();
    return all.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)))
      .sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
  }, [rows, extra]);

  const withBalance = useMemo(() => {
    if (!account) return [];
    const startMonth = (live[0] && live[0].date < windowStart ? live[0].date : windowStart).slice(0, 7);
    let bal = core.accountBalance(account, accountId, monthly, { beforeMonth: startMonth });
    return live.map((t) => {
      bal += t.amountCents;
      return { ...t, balance: bal };
    });
  }, [live, account, accountId, monthly, windowStart]);

  const filtersActive = !!(filters.search || filters.to || filters.pick !== '*' || filters.status || filters.min || filters.max || (filters.from && filters.from > windowStart));
  const visible = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    const min = core.parseMoneyToCents(filters.min);
    const max = core.parseMoneyToCents(filters.max);
    let out = withBalance.filter((t) => {
      if (filters.from && t.date < filters.from) return false;
      if (filters.to && t.date > filters.to) return false;
      if (filters.status && t.status !== filters.status) return false;
      if (min != null && Math.abs(t.amountCents) < Math.abs(min)) return false;
      if (max != null && Math.abs(t.amountCents) > Math.abs(max)) return false;
      if (filters.pick !== '*') {
        const lines = core.linesOf(t);
        const picks = t.role === 'mirror' ? [t.categoryId ? `cat:${t.categoryId}` : ''] : lines.map((l) => (l.transferAccountId ? (accountsById[l.transferAccountId] && accountsById[l.transferAccountId].kind === 'intercompany' ? 'ic' : `xfer:${l.transferAccountId}`) : l.categoryId ? `cat:${l.categoryId}` : ''));
        const want = filters.pick.startsWith('ic') ? 'ic' : filters.pick;
        if (!picks.includes(want)) return false;
      }
      if (q) {
        const hay = `${t.payee} ${t.memo} ${describeTxn(t, ledger)} ${core.centsToDecimalString(Math.abs(t.amountCents))}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const dir = sort.dir === 'asc' ? 1 : -1;
    const key = sort.key;
    out = [...out].sort((a, b) => {
      let c = 0;
      if (key === 'payee') c = a.payee.localeCompare(b.payee);
      else if (key === 'category') c = describeTxn(a, ledger).localeCompare(describeTxn(b, ledger));
      else if (key === 'amount') c = a.amountCents - b.amountCents;
      else if (key === 'status') c = a.status.localeCompare(b.status);
      if (!c) c = a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id));
      return c * dir;
    });
    return out;
  }, [withBalance, filters, sort, accountsById, ledger]);

  const showBalance = sort.key === 'date' && !filtersActive && mode === 'register';
  const payees = useMemo(() => [...new Set(live.map((t) => t.payee).filter(Boolean))].slice(-300), [live]);

  // ── Save helpers ─────────────────────────────────────────────────────
  const buildDraft = (f, base) => {
    const amountCents = amountFromForm(f);
    if (!amountCents) throw new Error('Enter a payment or a deposit amount.');
    if (!core.DATE_RE.test(f.date)) throw new Error('Enter a valid date.');
    let lineFields;
    let splits = [];
    if (f.pick === 'split') {
      if (!f.splits || !f.splits.length) throw new Error('Open the split editor to assign the lines.');
      const sum = f.splits.reduce((s, l) => s + l.amountCents, 0);
      if (sum !== amountCents) throw new Error('The amount changed — reopen Split to rebalance the lines.');
      splits = f.splits;
      lineFields = { categoryId: null, transferAccountId: null, icCategoryId: null };
    } else {
      lineFields = lineFromPick(f.pick, companyId);
    }
    return {
      ...(base || {}),
      companyId,
      accountId,
      date: f.date,
      payee: f.payee.trim(),
      memo: f.memo.trim(),
      amountCents,
      ...lineFields,
      splits,
      role: 'main',
    };
  };

  const applyRule = (f) => {
    if (f.pick || !f.payee) return f;
    const catId = core.applyVendorRules(f.payee, rules);
    return catId ? { ...f, pick: `cat:${catId}` } : f;
  };

  const saveNew = async () => {
    setError('');
    try {
      const f = applyRule(newForm);
      const draft = buildDraft(f, { status: 'uncleared', source: 'manual' });
      setBusy(true);
      await saveTransaction({ id: newTxnId(companyId), draft, before: null, accounts: accountsById, categories: categoriesById });
      setNewForm(blankForm(f.date));
      showToast({ text: `Saved ${f.payee || 'transaction'} · ${fmt(draft.amountCents)}` });
      setTimeout(() => newDateRef.current && newDateRef.current.focus(), 0);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (t) => {
    setError('');
    setEditId(t.id);
    setEditForm(formFromTxn(t));
    setSelected(t.id);
  };
  const cancelEdit = () => { setEditId(null); setEditForm(null); setError(''); };

  const saveEdit = async (t) => {
    setError('');
    try {
      setBusy(true);
      const f = applyRule(editForm);
      if (t.settlementId) {
        // Reimbursements live in both companies' books: money changes go
        // through the Intercompany screen (delete + record again).
        if (t.role !== 'main' || amountFromForm(f) !== t.amountCents || f.date !== t.date || f.pick !== pickFromTxn(t)) {
          throw new Error('This is an intercompany reimbursement. To change its amount or date, delete it on the Intercompany screen and record it again. Payee and memo can be edited here.');
        }
      }
      if (t.role === 'leg') {
        const parent = await getTxn(t.parentId);
        if (!parent) throw new Error('The other side of this transfer is missing.');
        if (parent.splits && parent.splits.length) throw new Error(`This is one line of a split in ${accountsById[parent.accountId] ? accountsById[parent.accountId].name : 'another account'}. Edit it there.`);
        const amountCents = amountFromForm(f);
        await saveTransaction({ id: parent.id, draft: { ...parent, date: f.date, payee: f.payee.trim(), memo: f.memo.trim(), amountCents: -amountCents }, before: parent, accounts: accountsById, categories: categoriesById });
      } else if (t.role === 'mirror') {
        const parent = await getTxn(t.parentId);
        if (!parent) throw new Error('The original transaction is missing.');
        const catId = f.pick.startsWith('cat:') ? f.pick.slice(4) : null;
        if (f.pick && !catId) throw new Error(`Pick a ${ledger.meta.short} category — amounts are edited in the paying company's books.`);
        const draft = { ...parent };
        if (parent.splits && parent.splits.length) {
          draft.splits = parent.splits.map((l, i) => (i === t.parentLine ? { ...l, icCategoryId: catId } : l));
        } else {
          draft.icCategoryId = catId;
        }
        await saveTransaction({ id: parent.id, draft, before: parent, accounts: accountsById, categories: categoriesById });
      } else {
        const draft = buildDraft(f, t);
        delete draft.id;
        delete draft.balance;
        await saveTransaction({ id: t.id, draft, before: t, accounts: accountsById, categories: categoriesById });
      }
      cancelEdit();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (t) => {
    if (t.role !== 'main') {
      setError(t.role === 'leg' ? 'This is the other side of a transfer — delete it from the original transaction.' : `This was paid by ${ledger.otherMeta.short}. Delete it in their books.`);
      return;
    }
    if (t.status === 'reconciled') { setError('Reconciled transactions are locked. Undo the reconciliation first.'); return; }
    try {
      setBusy(true);
      const { balance, ...txn } = t;
      await setDeleted({ txn, deleted: true, accounts: accountsById, categories: categoriesById });
      if (editId === t.id) cancelEdit();
      showToast({ text: `Deleted ${t.payee || 'transaction'} · ${fmt(t.amountCents)}${t.settlementId ? ` (both ${ledger.meta.short} and ${ledger.otherMeta.short} halves)` : ''}`, undo: txn });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const restore = async (txn) => {
    try {
      setBusy(true);
      const fresh = await getTxn(txn.id);
      await setDeleted({ txn: fresh || txn, deleted: false, accounts: accountsById, categories: categoriesById });
      showToast({ text: `Restored ${txn.payee || 'transaction'}` });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const purge = async (txn) => {
    try {
      setBusy(true);
      const fresh = await getTxn(txn.id);
      if (fresh && fresh.deleted) await purgeDeleted({ txn: fresh, accounts: accountsById, categories: categoriesById });
      showToast({ text: `Permanently deleted ${txn.payee || 'transaction'}` });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleCleared = async (t) => {
    if (t.status === 'reconciled') return;
    try {
      await setStatus(t, t.status === 'cleared' ? 'uncleared' : 'cleared');
    } catch (e) {
      setError(e.message);
    }
  };

  const openSplit = (target) => {
    const f = target === 'new' ? newForm : editForm;
    const total = amountFromForm(f);
    const current = target === 'edit' ? withBalance.find((t) => t.id === editId) : null;
    const lines = f.splits || (current && f.pick !== 'split' ? [{ ...lineFromPick(current ? pickFromTxn(current) : '', companyId), amountCents: total }] : null);
    setSplit({ target, totalCents: total || 0, lines, payee: f.payee });
  };

  const onSplitSaved = (lines, totalCents) => {
    const apply = (f) => ({
      ...f,
      pick: 'split',
      splits: lines,
      out: totalCents < 0 ? core.centsToDecimalString(-totalCents) : '',
      in: totalCents > 0 ? core.centsToDecimalString(totalCents) : '',
    });
    if (split.target === 'new') setNewForm(apply);
    else setEditForm(apply);
    setSplit(null);
  };

  // ── Keyboard ─────────────────────────────────────────────────────────
  const onTableKey = (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'select', 'textarea'].includes(tag)) return;
    const idx = visible.findIndex((t) => t.id === selected);
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); newDateRef.current && newDateRef.current.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); const n = visible[Math.min(visible.length - 1, idx + 1)]; if (n) setSelected(n.id); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); const n = visible[Math.max(0, idx - 1)]; if (n) setSelected(n.id); }
    else if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); startEdit(visible[idx]); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && idx >= 0) { e.preventDefault(); remove(visible[idx]); }
    else if ((e.key === 'c' || e.key === 'C') && idx >= 0) { e.preventDefault(); toggleCleared(visible[idx]); }
  };
  const fieldKeys = (onSave, onCancel) => (e) => {
    if (e.key === 'Enter' && e.target.tagName !== 'SELECT') { e.preventDefault(); onSave(); }
    if (e.key === 'Enter' && e.target.tagName === 'SELECT' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSave(); }
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
  };

  useEffect(() => {
    if (!selected || !tableRef.current) return;
    const el = tableRef.current.querySelector(`[data-row="${selected}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (!ledger.ready) return <Empty>Loading books…</Empty>;
  if (!accounts.length) return <Empty>No accounts yet for {ledger.meta.legalName}. Open <strong>Setup</strong> to create the default accounts.</Empty>;
  if (!account) return <Empty>Loading…</Empty>;

  const [outLabel, inLabel] = columnLabels(account.kind);
  const sortBy = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
  const sortMark = (key) => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
  const cardOwed = account.kind === 'credit_card';
  const balanceText = (c) => (cardOwed ? fmt(-c) : fmt(c));

  const renderInputs = (f, setF, onSave, onCancel, opts = {}) => {
    const keys = fieldKeys(onSave, onCancel);
    const lockMoney = opts.lockMoney;
    const set = (p) => setF((prev) => ({ ...prev, ...p }));
    return (
      <>
        <td><input ref={opts.dateRef} className="bk-input bk-date" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} onKeyDown={keys} disabled={lockMoney} aria-label="Date" /></td>
        <td>
          <input className="bk-input" list="bk-payees" value={f.payee} placeholder="Payee" onChange={(e) => set({ payee: e.target.value })}
            onBlur={() => setF((prev) => applyRule(prev))} onKeyDown={keys} disabled={opts.lockPayee} aria-label="Payee" />
        </td>
        <td>
          {opts.mirror ? (
            <select className="bk-input" value={f.pick} onChange={(e) => set({ pick: e.target.value })} onKeyDown={keys} aria-label="Category">
              <option value="">Uncategorized</option>
              {ledger.categories.filter((c) => !c.archived && c.kind !== 'equity').map((c) => <option key={c.id} value={`cat:${c.id}`}>{c.name}</option>)}
            </select>
          ) : opts.leg ? (
            <span className="bk-muted bk-cell-note">{opts.legLabel}</span>
          ) : (
            <div className="bk-cat-cell">
              <CategorySelect ledger={ledger} accountId={accountId} value={f.pick} onKeyDown={keys}
                onChange={(v) => { if (v === 'split') { set({ pick: 'split' }); setTimeout(() => openSplit(opts.target), 0); } else set({ pick: v, splits: null }); }} />
              {f.pick === 'split' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openSplit(opts.target)}>Edit split</button>}
            </div>
          )}
        </td>
        <td><input className="bk-input" value={f.memo} placeholder="Memo" onChange={(e) => set({ memo: e.target.value })} onKeyDown={keys} disabled={opts.lockPayee} aria-label="Memo" /></td>
        <td className="num"><input className="bk-input bk-amt" value={f.out} inputMode="decimal" placeholder="0.00" onChange={(e) => set({ out: e.target.value, in: e.target.value ? '' : f.in })} onKeyDown={keys} disabled={lockMoney} aria-label={outLabel} /></td>
        <td className="num"><input className="bk-input bk-amt" value={f.in} inputMode="decimal" placeholder="0.00" onChange={(e) => set({ in: e.target.value, out: e.target.value ? '' : f.out })} onKeyDown={keys} disabled={lockMoney} aria-label={inLabel} /></td>
      </>
    );
  };

  const queueRows = mode === 'review' ? (queue || []) : mode === 'deleted' ? (deletedRows || []) : null;

  return (
    <div className="bk-register" onKeyDown={onTableKey} tabIndex={-1}>
      <div className="bk-accounts" role="tablist" aria-label="Accounts">
        {accounts.map((a) => {
          const bal = balances[a.id] || 0;
          const owed = a.kind === 'credit_card';
          return (
            <button key={a.id} type="button" role="tab" aria-selected={a.id === accountId && mode === 'register'}
              className={`bk-account ${a.id === accountId && mode === 'register' ? 'active' : ''}`}
              onClick={() => { setMode('register'); setAccountId(a.id); cancelEdit(); }}>
              <span className="bk-account-name">{a.name}{a.last4 ? ` ··${a.last4}` : ''}</span>
              <span className="bk-account-kind">{a.kind === 'credit_card' ? 'Credit card · owed' : a.kind === 'intercompany' ? (bal >= 0 ? `Due from ${ledger.otherMeta.short}` : `Due to ${ledger.otherMeta.short}`) : 'Checking'}</span>
              <span className={`bk-account-bal ${!owed && bal < 0 ? 'bk-neg' : ''}`}>{fmt(owed ? -bal : a.kind === 'intercompany' ? Math.abs(bal) : bal)}</span>
            </button>
          );
        })}
        <button type="button" className={`bk-account bk-account-queue ${mode === 'review' ? 'active' : ''}`} onClick={() => { setMode('review'); cancelEdit(); }}>
          <span className="bk-account-name">Review queue</span>
          <span className="bk-account-kind">Uncategorized</span>
          <span className="bk-account-bal">{queue ? queue.length : '•'}</span>
        </button>
        <button type="button" className={`bk-account bk-account-queue ${mode === 'deleted' ? 'active' : ''}`} onClick={() => { setMode('deleted'); cancelEdit(); }}>
          <span className="bk-account-name">Recently deleted</span>
          <span className="bk-account-kind">Restore</span>
          <span className="bk-account-bal">{deletedRows ? deletedRows.length : '•'}</span>
        </button>
      </div>

      {loadError && <div className="bk-error">Could not load: {loadError}</div>}
      {error && <div className="bk-error" role="alert">{error} <button type="button" className="bk-link" onClick={() => setError('')}>Dismiss</button></div>}

      {mode === 'register' && (
        <>
          <div className="bk-toolbar">
            <input className="bk-input bk-search" placeholder="Search payee, memo, category, amount" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} aria-label="Search" />
            <label className="bk-field-inline"><span>From</span><input type="date" className="bk-input bk-date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
            <label className="bk-field-inline"><span>To</span><input type="date" className="bk-input bk-date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label>
            <select className="bk-input bk-filter-cat" value={filters.pick} onChange={(e) => setFilters({ ...filters, pick: e.target.value })} aria-label="Category filter">
              <option value="*">All categories</option>
              <option value="">Uncategorized</option>
              {ledger.categories.map((c) => <option key={c.id} value={`cat:${c.id}`}>{c.name}</option>)}
              {accounts.filter((a) => a.id !== accountId && a.kind !== 'intercompany').map((a) => <option key={a.id} value={`xfer:${a.id}`}>Transfer · {a.name}</option>)}
              <option value="ic">Intercompany</option>
            </select>
            <select className="bk-input bk-filter-status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} aria-label="Status filter">
              <option value="">Any status</option>
              <option value="uncleared">Uncleared</option>
              <option value="cleared">Cleared</option>
              <option value="reconciled">Reconciled</option>
            </select>
            <input className="bk-input bk-amt-filter" placeholder="Min $" value={filters.min} onChange={(e) => setFilters({ ...filters, min: e.target.value })} inputMode="decimal" aria-label="Minimum amount" />
            <input className="bk-input bk-amt-filter" placeholder="Max $" value={filters.max} onChange={(e) => setFilters({ ...filters, max: e.target.value })} inputMode="decimal" aria-label="Maximum amount" />
            {filtersActive && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilters({ search: '', from: '', to: '', pick: '*', status: '', min: '', max: '' })}>Clear</button>}
          </div>

          <div className="bk-table-wrap" ref={tableRef}>
            <table className="bk-table bk-reg-table">
              <colgroup>
                <col className="c-date" /><col className="c-payee" /><col className="c-cat" /><col className="c-memo" />
                <col className="c-amt" /><col className="c-amt" /><col className="c-flag" /><col className="c-bal" /><col className="c-act" />
              </colgroup>
              <thead>
                <tr>
                  <th><button type="button" className="bk-th" onClick={() => sortBy('date')}>Date{sortMark('date')}</button></th>
                  <th><button type="button" className="bk-th" onClick={() => sortBy('payee')}>Payee{sortMark('payee')}</button></th>
                  <th><button type="button" className="bk-th" onClick={() => sortBy('category')}>Category{sortMark('category')}</button></th>
                  <th>Memo</th>
                  <th className="num"><button type="button" className="bk-th" onClick={() => sortBy('amount')}>{outLabel}{sortMark('amount')}</button></th>
                  <th className="num">{inLabel}</th>
                  <th className="center"><button type="button" className="bk-th" onClick={() => sortBy('status')} title="Cleared status">C{sortMark('status')}</button></th>
                  <th className="num">{cardOwed ? 'Owed' : 'Balance'}</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {!isIc && (
                  <tr className="bk-new-row">
                    {renderInputs(newForm, setNewForm, saveNew, () => setNewForm(blankForm(newForm.date)), { dateRef: newDateRef, target: 'new' })}
                    <td />
                    <td className="bk-muted bk-hint">Enter ↵</td>
                    <td><button type="button" className="btn btn-primary btn-sm" onClick={saveNew} disabled={busy}>Add</button></td>
                  </tr>
                )}
                {rows === null && <tr><td colSpan={9}><Empty>Loading transactions…</Empty></td></tr>}
                {rows !== null && !visible.length && <tr><td colSpan={9}><Empty>{filtersActive ? 'No transactions match these filters.' : 'No transactions in this period yet.'}</Empty></td></tr>}
                {visible.map((t) => {
                  if (t.id === editId && editForm) {
                    const legParent = t.role === 'leg';
                    return (
                      <tr key={t.id} data-row={t.id} className="bk-edit-row">
                        {renderInputs(editForm, setEditForm, () => saveEdit(t), cancelEdit, {
                          target: 'edit',
                          lockMoney: t.status === 'reconciled' || t.role === 'mirror',
                          lockPayee: t.role === 'mirror',
                          mirror: t.role === 'mirror',
                          leg: legParent,
                          legLabel: describeTxn(t, ledger),
                        })}
                        <td className="center"><StatusFlag status={t.status} onToggle={() => toggleCleared(t)} /></td>
                        <td className="num bk-muted">{showBalance ? balanceText(t.balance) : ''}</td>
                        <td className="bk-actions">
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => saveEdit(t)} disabled={busy}>Save</button>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={cancelEdit} aria-label="Cancel edit" title="Cancel (Esc)">✕</button>
                          {t.role === 'main' && (
                            <label className="btn btn-ghost btn-sm bk-attach" title="Attach a receipt (PDF or image, 3 MB max)">
                              📎
                              <input type="file" accept="application/pdf,image/*" hidden onChange={async (e) => {
                                const file = e.target.files && e.target.files[0];
                                e.target.value = '';
                                if (!file) return;
                                try { setBusy(true); await uploadReceipt(t, file); showToast({ text: `Receipt attached to ${t.payee || 'transaction'}` }); } catch (err) { setError(err.message); } finally { setBusy(false); }
                              }} />
                            </label>
                          )}
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={t.id} data-row={t.id}
                      className={`bk-row ${selected === t.id ? 'bk-selected' : ''} ${t.needsCategory ? 'bk-row-uncat' : ''} ${t.status === 'reconciled' ? 'bk-row-rec' : ''}`}
                      onClick={() => setSelected(t.id)} onDoubleClick={() => !isIc && startEdit(t)}>
                      <td className="bk-nowrap">{fmtDate(t.date)}</td>
                      <td className="bk-payee" title={t.payee}>{t.payee || <span className="bk-muted">—</span>}{(t.attachmentPath || t.attachmentUrl) && <button type="button" className="bk-clip" title="Open receipt" aria-label="Open receipt" onClick={(e) => { e.stopPropagation(); openReceipt(t).catch((err) => setError(err.message)); }}>📎</button>}</td>
                      <td className={`bk-cat ${t.needsCategory ? 'bk-uncat' : ''}`} title={describeTxn(t, ledger)}>
                        {describeTxn(t, ledger)}
                        {t.splits && t.splits.length > 0 && (
                          <div className="bk-split-lines">{t.splits.map((l, i) => <div key={i}>{describeLine(l, ledger, t)} <span className="num">{fmt(Math.abs(l.amountCents))}</span></div>)}</div>
                        )}
                      </td>
                      <td className="bk-memo" title={t.memo}>{t.memo}</td>
                      <td className="num">{t.amountCents < 0 ? fmt(-t.amountCents) : ''}</td>
                      <td className="num bk-pos">{t.amountCents > 0 ? fmt(t.amountCents) : ''}</td>
                      <td className="center"><StatusFlag status={t.status} onToggle={() => toggleCleared(t)} /></td>
                      <td className={`num ${!cardOwed && t.balance < 0 ? 'bk-neg' : ''}`}>{showBalance ? balanceText(t.balance) : ''}</td>
                      <td className="bk-actions">
                        {!isIc && <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); startEdit(t); }} aria-label="Edit">Edit</button>}
                        {t.role === 'main' && !isIc && t.status !== 'reconciled' && <button type="button" className="btn btn-ghost btn-sm bk-del" onClick={(e) => { e.stopPropagation(); remove(t); }} aria-label="Delete">✕</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="bk-reg-foot">
            <span className="bk-muted">
              Showing {fmtDate(filters.from && filters.from < windowStart ? filters.from : windowStart)} → today · {visible.length} rows
              {!showBalance && ' · running balance shows when sorted by date with no filters'}
            </span>
            <span className="bk-reg-foot-actions">
              <span className="bk-muted bk-keys">Keys: N new · ↑↓ select · Enter edit · C cleared · Del delete</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMonths((m) => m + 3)}>Load 3 earlier months</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMonths(240)}>All history</button>
            </span>
          </div>
        </>
      )}

      {queueRows && (
        <div className="bk-table-wrap">
          <table className="bk-table">
            <thead>
              <tr><th>Date</th><th>Account</th><th>Payee</th><th>Category</th><th className="num">Amount</th><th aria-label="Actions" /></tr>
            </thead>
            <tbody>
              {(mode === 'review' ? queue : deletedRows) === null && <tr><td colSpan={6}><Empty>Loading…</Empty></td></tr>}
              {queueRows.length === 0 && (mode === 'review' ? queue : deletedRows) !== null && (
                <tr><td colSpan={6}><Empty>{mode === 'review' ? 'Nothing to review. Every transaction has a category.' : 'Nothing deleted recently.'}</Empty></td></tr>
              )}
              {queueRows.map((t) => (
                <QueueRow key={t.id} t={t} ledger={ledger} mode={mode} busy={busy}
                  onCategorize={async (pick) => {
                    try {
                      setBusy(true);
                      if (t.role === 'mirror') {
                        const parent = await getTxn(t.parentId);
                        const catId = pick.startsWith('cat:') ? pick.slice(4) : null;
                        const draft = { ...parent };
                        if (parent.splits && parent.splits.length) draft.splits = parent.splits.map((l, i) => (i === t.parentLine ? { ...l, icCategoryId: catId } : l));
                        else draft.icCategoryId = catId;
                        await saveTransaction({ id: parent.id, draft, before: parent, accounts: accountsById, categories: categoriesById });
                      } else {
                        const { id, ...rest } = t;
                        await saveTransaction({ id, draft: { ...rest, ...lineFromPick(pick, companyId) }, before: rest, accounts: accountsById, categories: categoriesById });
                      }
                    } catch (e) { setError(e.message); } finally { setBusy(false); }
                  }}
                  onRestore={() => restore(t)}
                  onPurge={() => purge(t)}
                  onOpen={() => { setMode('register'); setAccountId(t.accountId); setSelected(t.id); }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <datalist id="bk-payees">{payees.map((p) => <option key={p} value={p} />)}</datalist>

      {split && (
        <SplitEditor ledger={ledger} accountId={accountId} totalCents={split.totalCents} lines={split.lines} payee={split.payee}
          onSave={onSplitSaved} onClose={() => setSplit(null)} />
      )}
      {toast && (
        <div className="bk-toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && <button type="button" className="bk-link" onClick={() => { const u = toast.undo; setToast(null); restore(u); }}>Undo</button>}
        </div>
      )}
    </div>
  );
}

function QueueRow({ t, ledger, mode, busy, onCategorize, onRestore, onPurge, onOpen }) {
  const acct = ledger.accountsById[t.accountId];
  const [pick, setPick] = useState('');
  const [confirmPurge, setConfirmPurge] = useState(false);
  return (
    <tr className="bk-row">
      <td className="bk-nowrap">{fmtDate(t.date)}</td>
      <td>{acct ? acct.name : t.accountId}</td>
      <td className="bk-payee" title={t.payee}>{t.payee}</td>
      <td>
        {mode === 'review' ? (
          <div className="bk-cat-cell">
            {t.role === 'mirror' ? (
              <select className="bk-input" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Category">
                <option value="">Pick a category…</option>
                {ledger.categories.filter((c) => !c.archived && c.kind !== 'equity').map((c) => <option key={c.id} value={`cat:${c.id}`}>{c.name}</option>)}
              </select>
            ) : (
              <CategorySelect ledger={ledger} accountId={t.accountId} value={pick} allowSplit={false} onChange={setPick} />
            )}
            <button type="button" className="btn btn-primary btn-sm" disabled={!pick || busy} onClick={() => onCategorize(pick)}>Save</button>
          </div>
        ) : describeTxn(t, ledger)}
      </td>
      <td className={`num ${t.amountCents > 0 ? 'bk-pos' : ''}`}>{fmt(t.amountCents)}</td>
      <td className="bk-actions">
        {mode === 'deleted'
          ? (
            <>
              <button type="button" className="btn btn-secondary btn-sm" onClick={onRestore} disabled={busy}>Restore</button>
              {confirmPurge
                ? <button type="button" className="btn btn-danger btn-sm" onClick={onPurge} disabled={busy}>Confirm: delete forever</button>
                : <button type="button" className="btn btn-ghost btn-sm bk-del" onClick={() => setConfirmPurge(true)} disabled={busy}>Delete forever</button>}
            </>
          )
          : <button type="button" className="btn btn-ghost btn-sm" onClick={onOpen}>Open</button>}
      </td>
    </tr>
  );
}
