// Setup (DAL) → what the old Expenses records carried: app tags, notes and
// receipts, and which migrated rows still have neither a project nor notes.
import React, { useState } from 'react';
import { apiPost } from './ledgerStore';
import { csvCell, downloadText, Empty, fmt, fmtDate } from './ui';

export default function LegacyReport({ ledger }) {
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const catName = (id) => (id ? (ledger.categoriesById[id] || {}).name || 'Unknown' : 'Uncategorized');

  const call = async (mode) => {
    if (busy) return null;
    setBusy(true); setMsg('');
    try {
      const r = await apiPost('/api/ledger/migrate', { mode });
      return r.summary;
    } catch (e) {
      setMsg(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const check = async () => { const s = await call('legacy-report'); if (s) setReport(s.report); };
  const bringOver = async () => {
    const s = await call('legacy-notes');
    if (!s) return;
    setMsg(`Added ${s.notesAdded} missing note(s); created ${s.projects.created} project(s) and tagged ${s.projects.tagged} transaction(s) from app names. Notes can be undone.`);
    const r = await call('legacy-report'); if (r) setReport(r.report);
  };
  const undoNotes = async () => {
    const s = await call('legacy-notes-undo');
    if (!s) return;
    setMsg(`Removed ${s.notesRemoved} added note(s).`);
    const r = await call('legacy-report'); if (r) setReport(r.report);
  };
  const exportNeither = () => {
    // Charges positive, credits/refunds negative (as on the old Expenses tab).
    const rows = [['Date', 'Payee', 'Category', 'Amount (credits negative)', 'Receipt']].concat(report.books.neither.rows.map((r) => [r.date, r.payee, catName(r.categoryId), (-r.cents / 100).toFixed(2), r.receipt ? 'yes' : '']));
    downloadText('expenses-without-project-or-notes.csv', rows.map((r) => r.map(csvCell).join(',')).join('\n'), 'text/csv');
  };

  const b = report && report.books;
  const l = report && report.legacy;
  return (
    <div>
      <div className="bk-muted bk-small">Checks the old Expenses records for app tags, notes and receipts, compares them with the migrated rows, and lists the rows that still have neither a project nor notes. Read-only until you choose to bring something over.</div>
      <div className="bk-row-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={check} disabled={busy}>{report ? 'Check again' : 'Check old Expenses'}</button>
        {report && (report.notesToAdd > 0 || b.appTagNotLinked > 0) && <button type="button" className="btn btn-primary btn-sm" onClick={bringOver} disabled={busy}>Bring over {report.notesToAdd} note(s) and {b.appTagNotLinked} app tag(s)</button>}
        <button type="button" className="btn btn-ghost btn-sm" onClick={undoNotes} disabled={busy} title="Removes notes added by “Bring over”">Undo added notes</button>
      </div>
      {msg && <div className="bk-notice">{msg}</div>}
      {report && (
        <div className="bk-legacy-report">
          <div className="bk-kicker bk-mt">Migrated rows in Books ({b.migrated})</div>
          <ul className="bk-small">
            <li>{b.withProject} have a project / app</li>
            <li>{b.withNotes} have notes</li>
            <li>{b.withReceipt} have a receipt{report.receipts && report.receipts.withLink ? (report.receipts.fileFound == null ? ' (could not check the old receipt files)' : ` (old receipts: ${report.receipts.fileFound} of ${report.receipts.withLink} files found; they open with a fresh link)`) : ''}</li>
            <li><strong>{b.neither.count} have neither a project nor notes · {fmt(-b.neither.totalCents)} net spend</strong></li>
          </ul>
          <div className="bk-kicker bk-mt">Old Expenses records ({l.total})</div>
          <ul className="bk-small">
            <li>{l.withApp} tagged with an app (not “DAL General”)</li>
            <li>{l.withNotes} with notes / description; {l.droppedNotes} had notes that differ from the description</li>
            <li>{l.withReceipt} with a receipt</li>
          </ul>
          <details className="bk-small">
            <summary>App tags used ({l.apps.length})</summary>
            {l.apps.map((a) => <div key={a.name}>{a.name} · {a.count}{a.isProject ? '' : ' (overhead, not a project)'}</div>)}
          </details>
          <details className="bk-small">
            <summary>Fields found on the old records</summary>
            {l.fields.map((f) => <div key={f.name}><span className="bk-mono">{f.name}</span> · {f.count}</div>)}
          </details>
          {!!l.examples.length && (
            <details className="bk-small" open>
              <summary>Sharmin Shepu and Fiverr records ({l.examples.length}{l.examples.length >= 60 ? '+' : ''})</summary>
              <div className="bk-table-wrap bk-scroll-y">
                <table className="bk-table">
                  <thead><tr><th>Date</th><th>Vendor</th><th>Old category</th><th>App</th><th>Notes</th><th className="num">Amount</th></tr></thead>
                  <tbody>
                    {l.examples.map((e) => (
                      <tr key={e.id} className="bk-row">
                        <td>{e.date ? fmtDate(e.date) : '—'}</td><td>{e.vendor}</td><td>{e.category || '—'}</td><td>{e.app || '—'}</td>
                        <td className="bk-memo">{[e.notes, e.description !== e.notes ? e.description : ''].filter(Boolean).join(' · ') || '—'}{e.receipt ? ' 📎' : ''}</td>
                        <td className="num">{Number(e.amount || 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          <div className="bk-kicker bk-mt">Still need an invoice lookup ({b.neither.count})</div>
          {!b.neither.count ? <Empty>Every migrated row has a project or notes.</Empty> : (
            <>
              <div className="bk-row-actions"><button type="button" className="btn btn-secondary btn-sm" onClick={exportNeither}>Export list (CSV)</button>{b.neither.count > 300 && <span className="bk-muted bk-small">Showing the first 300 of {b.neither.count}; the CSV has all of them.</span>}</div>
              <div className="bk-table-wrap bk-scroll-y">
                <table className="bk-table">
                  <thead><tr><th>Date</th><th>Payee</th><th>Category</th><th className="num">Amount</th></tr></thead>
                  <tbody>
                    {b.neither.rows.slice(0, 300).map((r) => (
                      <tr key={r.id} className="bk-row"><td>{fmtDate(r.date)}</td><td className="bk-payee">{r.payee}{r.receipt ? ' 📎' : ''}</td><td>{catName(r.categoryId)}</td><td className="num">{fmt(r.cents)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
