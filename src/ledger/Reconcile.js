// Reconcile an account against a statement: tick cleared rows until the
// difference is zero, then lock them as reconciled. Undo is a separate,
// audit-logged server action, and only for the most recent statement.
import React, { useEffect, useMemo, useState } from 'react';
import * as core from './core';
import { useLedger } from './LedgerContext';
import { apiPost, fetchUnreconciled, finishReconciliation, setStatus } from './ledgerStore';
import { describeTxn, Empty, fmt, fmtDate, todayISO } from './ui';

export default function Reconcile() {
  const ledger = useLedger();
  const { companyId, accounts, accountsById, reconciliations } = ledger;
  const bankish = accounts.filter((a) => a.kind === 'checking' || a.kind === 'credit_card');
  const [accountId, setAccountId] = useState('');
  const [statementDate, setStatementDate] = useState(todayISO());
  const [ending, setEnding] = useState('');
  const [rows, setRows] = useState(null);
  const [ticked, setTicked] = useState(new Set());
  const [showLater, setShowLater] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [confirmUndo, setConfirmUndo] = useState(null);

  useEffect(() => {
    if (!bankish.length) return;
    if (!accountId || !accountsById[accountId] || accountsById[accountId].companyId !== companyId) setAccountId(bankish[0].id);
  }, [bankish, accountId, accountsById, companyId]);

  const account = accountsById[accountId];
  const isCard = account && account.kind === 'credit_card';

  useEffect(() => {
    if (!account || account.companyId !== companyId) return undefined;
    let cancelled = false;
    setRows(null);
    fetchUnreconciled(companyId, accountId)
      .then((r) => {
        if (cancelled) return;
        const live = r.filter((t) => !t.deleted).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
        setRows(live);
        setTicked(new Set(live.filter((t) => t.status === 'cleared').map((t) => t.id)));
      })
      .catch((e) => setError(e.message));
    return () => { cancelled = true; };
  }, [companyId, accountId, account, reload]);

  const start = account ? core.startingBalance(account, reconciliations, accountId) : 0;
  const last = core.lastReconciliation(reconciliations, accountId);
  const typed = core.parseMoneyToCents(ending);
  // Card statements show what you owe; internally a card balance owed is negative.
  const endingCents = typed == null ? null : isCard ? -typed : typed;
  const laterCount = (rows || []).filter((t) => t.date > statementDate).length;
  const inScope = useMemo(() => (rows || []).filter((t) => showLater || t.date <= statementDate), [rows, showLater, statementDate]);
  const summary = useMemo(() => {
    if (endingCents == null) return null;
    const scopeIds = new Set(inScope.map((t) => t.id));
    return core.reconcileSummary({ startCents: start, statementEndingCents: endingCents, txns: rows || [], clearedIds: new Set([...ticked].filter((id) => scopeIds.has(id))) });
  }, [endingCents, start, rows, ticked, inScope]);

  const toggle = async (t) => {
    const next = new Set(ticked);
    const on = !next.has(t.id);
    if (on) next.add(t.id); else next.delete(t.id);
    setTicked(next);
    try {
      await setStatus(t, on ? 'cleared' : 'uncleared');
    } catch (e) {
      setError(e.message);
    }
  };

  const setAll = async (on) => {
    const next = new Set(ticked);
    const changed = inScope.filter((t) => (on ? !next.has(t.id) : next.has(t.id)));
    changed.forEach((t) => (on ? next.add(t.id) : next.delete(t.id)));
    setTicked(next);
    try {
      await Promise.all(changed.map((t) => setStatus(t, on ? 'cleared' : 'uncleared')));
    } catch (e) {
      setError(e.message);
    }
  };

  const finish = async () => {
    if (!summary || !summary.canFinish) return;
    setBusy(true);
    setError('');
    try {
      const ids = inScope.filter((t) => ticked.has(t.id)).map((t) => t.id);
      await finishReconciliation({ companyId, account, statementDate, startingBalanceCents: start, endingBalanceCents: endingCents, txnIds: ids });
      setNotice(`Reconciled ${ids.length} transactions through ${fmtDate(statementDate)}. They are now locked.`);
      setEnding('');
      setReload((n) => n + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const undo = async (rec) => {
    setBusy(true);
    setError('');
    try {
      const r = await apiPost('/api/ledger/unreconcile', { companyId, reconciliationId: rec.id });
      setNotice(`Reconciliation through ${fmtDate(rec.statementDate)} undone (${r.rows} rows unlocked). This was recorded in the audit log.`);
      setConfirmUndo(null);
      setReload((n) => n + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!ledger.ready) return <Empty>Loading…</Empty>;
  if (!bankish.length) return <Empty>No accounts yet. Open Setup first.</Empty>;

  const history = reconciliations.filter((r) => r.accountId === accountId).sort((a, b) => b.statementDate.localeCompare(a.statementDate) || String(b.finishedAt || '').localeCompare(String(a.finishedAt || '')));
  const show = (c) => (isCard ? fmt(-c) : fmt(c));

  return (
    <div className="bk-reconcile">
      <div className="bk-panel bk-rec-setup">
        <label className="bk-field">
          <span>Account</span>
          <select className="bk-input" value={accountId} onChange={(e) => { setAccountId(e.target.value); setNotice(''); }}>
            {bankish.map((a) => <option key={a.id} value={a.id}>{a.name}{a.last4 ? ` ··${a.last4}` : ''}</option>)}
          </select>
        </label>
        <label className="bk-field">
          <span>Statement ending date</span>
          <input className="bk-input bk-date" type="date" value={statementDate} onChange={(e) => setStatementDate(e.target.value)} />
        </label>
        <label className="bk-field">
          <span>{isCard ? 'Statement balance (owed)' : 'Statement ending balance'}</span>
          <input className="bk-input bk-amt" value={ending} onChange={(e) => setEnding(e.target.value)} inputMode="decimal" placeholder="0.00" />
        </label>
        <div className="bk-field">
          <span>{isCard ? 'Starting balance owed' : 'Starting balance'}</span>
          <div className="bk-static">{show(start)} <span className="bk-muted">{last ? `from ${fmtDate(last.statementDate)} statement` : 'opening balance'}</span></div>
        </div>
      </div>

      {error && <div className="bk-error" role="alert">{error}</div>}
      {notice && <div className="bk-notice">{notice}</div>}

      <div className="bk-rec-grid">
        <div className="bk-table-wrap">
          <div className="bk-rec-tools">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAll(true)}>Mark all cleared</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAll(false)}>Unmark all</button>
            <label className="bk-check"><input type="checkbox" checked={showLater} onChange={(e) => setShowLater(e.target.checked)} /> Show transactions after the statement date</label>
          </div>
          <table className="bk-table bk-rec-table">
            <thead>
              <tr><th className="center">✓</th><th>Date</th><th>Payee</th><th>Category</th><th className="num">{isCard ? 'Charge' : 'Payment'}</th><th className="num">{isCard ? 'Payment' : 'Deposit'}</th></tr>
            </thead>
            <tbody>
              {rows === null && <tr><td colSpan={6}><Empty>Loading…</Empty></td></tr>}
              {rows !== null && !inScope.length && <tr><td colSpan={6}><Empty>No unreconciled transactions{showLater ? '' : ' on or before this date'}.</Empty></td></tr>}
              {rows !== null && !showLater && laterCount > 0 && (
                <tr><td colSpan={6} className="bk-muted bk-small bk-later-note">
                  {laterCount} transaction{laterCount === 1 ? '' : 's'} dated after {fmtDate(statementDate)} {laterCount === 1 ? 'is' : 'are'} hidden (they belong on a later statement).{' '}
                  <button type="button" className="bk-link" onClick={() => setShowLater(true)}>Show</button>
                </td></tr>
              )}
              {inScope.map((t) => (
                <tr key={t.id} className={`bk-row ${ticked.has(t.id) ? 'bk-ticked' : ''}`} onClick={() => toggle(t)}>
                  <td className="center"><input type="checkbox" checked={ticked.has(t.id)} onChange={() => toggle(t)} onClick={(e) => e.stopPropagation()} aria-label={`Cleared ${t.payee}`} /></td>
                  <td className="bk-nowrap">{fmtDate(t.date)}</td>
                  <td className="bk-payee">{t.payee}</td>
                  <td className="bk-cat">{describeTxn(t, ledger)}</td>
                  <td className="num">{t.amountCents < 0 ? fmt(-t.amountCents) : ''}</td>
                  <td className="num bk-pos">{t.amountCents > 0 ? fmt(t.amountCents) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="bk-panel bk-rec-summary" aria-live="polite">
          <div className="bk-sum-row"><span>{isCard ? 'Starting owed' : 'Starting balance'}</span><span className="num">{show(start)}</span></div>
          <div className="bk-sum-row"><span>Cleared {isCard ? 'charges' : 'payments'} ({summary ? summary.paymentCount : 0})</span><span className="num">{summary ? fmt(-summary.payments) : '—'}</span></div>
          <div className="bk-sum-row"><span>Cleared {isCard ? 'payments/credits' : 'deposits'} ({summary ? summary.depositCount : 0})</span><span className="num">{summary ? fmt(summary.deposits) : '—'}</span></div>
          <div className="bk-sum-row bk-sum-strong"><span>Cleared balance</span><span className="num">{summary ? show(summary.clearedBalance) : '—'}</span></div>
          <div className="bk-sum-row"><span>Statement balance</span><span className="num">{endingCents == null ? '—' : show(endingCents)}</span></div>
          <div className={`bk-sum-diff ${summary && summary.canFinish ? 'bk-ok' : 'bk-bad'}`}>
            <span>Difference</span>
            <span className="num">{summary ? fmt(isCard ? -summary.difference : summary.difference) : '—'}</span>
          </div>
          {!summary && <div className="bk-muted bk-small bk-sum-hint">Enter the statement ending balance to see the difference.</div>}
          <button type="button" className="btn btn-primary bk-wide" disabled={!summary || !summary.canFinish || busy} onClick={finish}>
            {summary && summary.canFinish ? 'Finish reconciliation' : 'Finish (difference must be $0.00)'}
          </button>
        </aside>
      </div>

      <h3 className="bk-h3">Reconciliation history · {account ? account.name : ''}</h3>
      <div className="bk-table-wrap">
        <table className="bk-table">
          <thead><tr><th>Statement date</th><th className="num">Starting</th><th className="num">Ending</th><th className="num">Rows</th><th>Status</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {!history.length && <tr><td colSpan={6}><Empty>No reconciliations yet for this account.</Empty></td></tr>}
            {history.map((r) => (
              <tr key={r.id} className="bk-row">
                <td>{fmtDate(r.statementDate)}</td>
                <td className="num">{show(r.startingBalanceCents)}</td>
                <td className="num">{show(r.endingBalanceCents)}</td>
                <td className="num">{r.txnCount || 0}</td>
                <td>{r.status === 'complete' ? <span className="bk-pill bk-pill-ok">Reconciled</span> : <span className="bk-pill">Undone{r.undoneBy ? ` by ${r.undoneBy}` : ''}</span>}</td>
                <td className="bk-actions">
                  {last && r.id === last.id && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmUndo(r)} disabled={busy}>Undo reconcile</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirmUndo && (
        <div className="modal-overlay" onClick={() => setConfirmUndo(null)}>
          <div className="modal bk-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><div className="modal-title">Undo reconciliation?</div></div>
            <div className="modal-body">
              <p>This unlocks the {confirmUndo.txnCount || 0} transactions reconciled on the {fmtDate(confirmUndo.statementDate)} statement for {account && account.name}. They go back to "cleared" so they can be edited.</p>
              <p className="bk-muted">The undo is recorded in the audit log with your account and the time.</p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmUndo(null)}>Cancel</button>
              <button type="button" className="btn btn-danger" onClick={() => undo(confirmUndo)} disabled={busy}>Undo reconcile</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
