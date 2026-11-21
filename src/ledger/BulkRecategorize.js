// Setup → "Change category in bulk": move every transaction from one payee
// (optionally only from one category) to another category, across all
// accounts and years, as one audited change that can be undone.
import React, { useEffect, useState } from 'react';
import * as core from './core';
import { bulkRecategorize, COL, fetchCompanyAll, newId, saveDoc, undoBulkEdit, watchCompany } from './ledgerStore';
import { Empty, fmt, fmtDate } from './ui';

const MAX_CHANGES = 2000;

export default function BulkRecategorize({ ledger }) {
  const { companyId, categories, categoriesById, accountsById, rules } = ledger;
  const [q, setQ] = useState({ payee: '', from: '*', to: '' });
  const [addRule, setAddRule] = useState(true);
  const [preview, setPreview] = useState(null); // plan
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [history, setHistory] = useState([]);

  useEffect(() => {
    setQ({ payee: '', from: '*', to: '' }); setPreview(null); setMsg('');
    return watchCompany(COL.bulkEdits, companyId, (rows) => setHistory(rows.sort((a, b) => ((b.createdAt && b.createdAt.seconds) || 0) - ((a.createdAt && a.createdAt.seconds) || 0)).slice(0, 8)), () => setHistory([]));
  }, [companyId]);

  const catName = (id) => (id ? (categoriesById[id] || {}).name || 'Unknown category' : 'Uncategorized');
  const active = categories.filter((c) => !c.archived);
  const set = (patch) => { setQ({ ...q, ...patch }); setPreview(null); };

  const doPreview = async () => {
    setBusy(true); setMsg('');
    try {
      const txns = await fetchCompanyAll(companyId);
      const plan = core.planBulkRecategorize(txns, { companyId, payeeContains: q.payee, fromCategoryId: q.from, toCategoryId: q.to });
      if (plan.changes.length > MAX_CHANGES) throw new Error(`That matches ${plan.changes.length} lines; narrow it down (at most ${MAX_CHANGES} at a time).`);
      setPreview(plan);
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };

  const apply = async () => {
    if (!preview || !preview.changes.length) return;
    setBusy(true); setMsg('');
    try {
      const done = await bulkRecategorize(companyId, preview, { payeeContains: q.payee.trim(), fromCategoryId: q.from, toCategoryId: q.to }, accountsById, categoriesById);
      let ruleNote = '';
      const pattern = q.payee.trim().toUpperCase().replace(/\s+/g, ' ').slice(0, 100);
      if (addRule && pattern) {
        const existing = rules.find((r) => r.pattern === pattern);
        if (existing) await saveDoc(COL.vendorRules, existing.id, { companyId, pattern, categoryId: q.to });
        else await saveDoc(COL.vendorRules, newId(companyId, 'rule'), { companyId, pattern, categoryId: q.to, projectId: null, isDefault: false }, false);
        ruleNote = ` Vendor rule “${pattern}” → ${catName(q.to)} ${existing ? 'updated' : 'added'}.`;
      }
      setMsg(`Moved ${preview.changes.length} line(s) on ${done} transaction(s), ${fmt(Math.abs(preview.totalCents))} in total, to ${catName(q.to)}.${ruleNote} You can undo this below.`);
      setPreview(null);
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };

  const undo = async (edit) => {
    setBusy(true); setMsg('');
    try {
      const n = await undoBulkEdit(edit, accountsById, categoriesById);
      setMsg(`Undone: ${n} transaction(s) moved back. Rows edited by hand since then were left as they are. (The vendor rule, if one was added, stays; edit it under Vendor rules.)`);
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="bk-panel">
      <div className="bk-muted bk-small bk-mb">
        Moves every transaction whose payee contains the text, in all accounts and all years, to a new category. Split lines are moved one by one; transfers and intercompany lines are never touched. Reconciled rows are included because a category change doesn’t change any balance.
      </div>
      <div className="bk-inline-form">
        <input className="bk-input" placeholder="Payee contains… (e.g. Sharmin Shepu)" value={q.payee} onChange={(e) => set({ payee: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && doPreview()} aria-label="Payee contains" />
        <select className="bk-input" value={q.from} onChange={(e) => set({ from: e.target.value })} aria-label="Current category">
          <option value="*">From any category</option>
          <option value="">From Uncategorized</option>
          {active.map((c) => <option key={c.id} value={c.id}>From {c.name}</option>)}
        </select>
        <select className="bk-input" value={q.to} onChange={(e) => set({ to: e.target.value })} aria-label="New category">
          <option value="">To category…</option>
          {active.map((c) => <option key={c.id} value={c.id}>To {c.name}</option>)}
        </select>
        <button type="button" className="btn btn-secondary btn-sm" onClick={doPreview} disabled={busy || !q.payee.trim() || !q.to}>Preview</button>
      </div>
      <label className="bk-check bk-small"><input type="checkbox" checked={addRule} onChange={(e) => setAddRule(e.target.checked)} /> Also add a vendor rule so future entries and imports for this payee land in the new category</label>
      {msg && <div className="bk-notice">{msg}</div>}

      {preview && (
        <>
          <div className="bk-kicker bk-mt">
            {preview.changes.length ? `${preview.txnCount} transaction(s), ${preview.changes.length} line(s), ${fmt(Math.abs(preview.totalCents))} → ${catName(q.to)}` : 'Nothing to change.'}
            {preview.reconciled > 0 && ` · ${preview.reconciled} reconciled (balances unaffected)`}
          </div>
          {!!preview.changes.length && (
            <div className="bk-table-wrap bk-scroll-y">
              <table className="bk-table">
                <thead><tr><th>Date</th><th>Account</th><th>Payee</th><th>Now</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  {preview.changes.map((c) => (
                    <tr key={`${c.id}-${c.line == null ? 'm' : c.line}`} className="bk-row">
                      <td>{fmtDate(c.date)}</td>
                      <td>{(accountsById[c.accountId] || {}).name || c.accountId}</td>
                      <td className="bk-payee">{c.payee}{c.line != null && <span className="bk-pill">split line</span>}{c.status === 'reconciled' && <span className="bk-pill">reconciled</span>}</td>
                      <td>{catName(c.from)}</td>
                      <td className="num">{fmt(c.cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="bk-row-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPreview(null)} disabled={busy}>Cancel</button>
            {!!preview.changes.length && <button type="button" className="btn btn-primary btn-sm" onClick={apply} disabled={busy}>Move {preview.changes.length} line(s) to {catName(q.to)}</button>}
          </div>
        </>
      )}

      {!!history.length && (
        <>
          <div className="bk-kicker bk-mt">Recent bulk changes</div>
          <div className="bk-table-wrap">
            <table className="bk-table">
              <thead><tr><th>When</th><th>Payee contains</th><th>Change</th><th className="num">Lines</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="bk-row">
                    <td>{h.createdAt && h.createdAt.toDate ? h.createdAt.toDate().toLocaleString() : '—'}</td>
                    <td className="bk-mono">{h.payeeContains}</td>
                    <td>{h.fromCategoryId === '*' ? 'Any category' : catName(h.fromCategoryId)} → {catName(h.toCategoryId)}</td>
                    <td className="num">{(h.changes || []).length}</td>
                    <td className="bk-actions">
                      {h.status === 'undone' ? <span className="bk-muted bk-small">Undone</span> : <button type="button" className="btn btn-ghost btn-sm" onClick={() => undo(h)} disabled={busy}>Undo</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {!history.length && !preview && <Empty>No bulk changes yet.</Empty>}
    </div>
  );
}
