// Financial statements views (balance sheet, trial balance, general ledger,
// fixed assets, owner contributions & distributions) and their CSV rows.
import React from 'react';
import * as core from './core';
import { Empty, fmt, fmtDate, monthLabel } from './ui';

const money = (c) => core.centsToDecimalString(c || 0);

function Balanced({ ok, text }) {
  return <div className={`bk-balanced ${ok ? 'bk-ok' : 'bk-bad'}`}>{ok ? `✓ ${text}` : `⚠ Out of balance — run Setup → Rebuild totals. (${text})`}</div>;
}

export function BalanceSheetView({ bs, asOf }) {
  if (!bs) return <Empty>Loading…</Empty>;
  const section = (title, rows, total, totalLabel) => (
    <>
      <tr className="bk-sec"><td colSpan={2}>{title}</td></tr>
      {rows.map((r) => (
        <React.Fragment key={r.accountId || r.key}>
          <tr className="bk-row">
            <td className="bk-indent">{r.name}{r.warn && <span className="bk-pill bk-pill-warn"> review</span>}</td>
            <td className={`num ${r.cents < 0 ? 'bk-neg' : ''}`}>{fmt(r.cents)}</td>
          </tr>
          {r.kind === 'fixed_asset' && r.costCents != null && (
            <tr className="bk-row"><td className="bk-indent2 bk-muted bk-small">Cost {fmt(r.costCents)} − accumulated depreciation {fmt(r.accumulatedCents)}</td><td /></tr>
          )}
        </React.Fragment>
      ))}
      {!rows.length && <tr><td className="bk-indent bk-muted" colSpan={2}>None</td></tr>}
      <tr className="bk-subtotal"><td>{totalLabel}</td><td className="num">{fmt(total)}</td></tr>
    </>
  );
  return (
    <>
      <div className="bk-table-wrap">
        <table className="bk-table bk-pnl bk-statement">
          <thead><tr><th>Balance sheet as of {fmtDate(asOf)}</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {section('Assets', bs.assets, bs.totals.assets, 'Total assets')}
            {section('Liabilities', bs.liabilities, bs.totals.liabilities, 'Total liabilities')}
            {section('Equity', bs.equity, bs.totals.equity, 'Total equity')}
            <tr className="bk-total"><td>Total liabilities & equity</td><td className="num">{fmt(bs.totals.liabilitiesAndEquity)}</td></tr>
          </tbody>
        </table>
      </div>
      <Balanced ok={bs.balanced} text={`Assets ${fmt(bs.totals.assets)} = liabilities + equity ${fmt(bs.totals.liabilitiesAndEquity)}`} />
      <div className="bk-muted bk-small">Cash basis. Fixed assets at book value. Credit cards and amounts due to the other company are liabilities; amounts due from it are assets.</div>
    </>
  );
}

export function TrialBalanceView({ tb, asOf }) {
  if (!tb) return <Empty>Loading…</Empty>;
  return (
    <>
      <div className="bk-table-wrap">
        <table className="bk-table bk-statement">
          <thead><tr><th>Account / category (as of {fmtDate(asOf)})</th><th>Type</th><th className="num bk-dc">Debit</th><th className="num bk-dc">Credit</th></tr></thead>
          <tbody>
            {tb.rows.map((r, i) => (
              <tr key={`${r.group}-${r.name}-${i}`} className="bk-row">
                <td>{r.name}</td>
                <td className="bk-muted">{r.group}</td>
                <td className="num">{r.debit ? fmt(r.debit) : ''}</td>
                <td className="num">{r.credit ? fmt(r.credit) : ''}</td>
              </tr>
            ))}
            <tr className="bk-total"><td colSpan={2}>Totals</td><td className="num">{fmt(tb.totals.debit)}</td><td className="num">{fmt(tb.totals.credit)}</td></tr>
          </tbody>
        </table>
      </div>
      <Balanced ok={tb.balanced} text={`Debits ${fmt(tb.totals.debit)} = credits ${fmt(tb.totals.credit)}`} />
      <div className="bk-muted bk-small">Income and expense are for this fiscal year (Jan 1 to the as-of date); earlier years are in retained earnings.</div>
    </>
  );
}

export function GeneralLedgerView({ gl, accountsById, onOpenTxn }) {
  if (!gl) return <Empty>Loading…</Empty>;
  const block = (s, isAccount) => (
    <div key={s.id} className="bk-table-wrap bk-gl-section">
      <table className="bk-table bk-statement">
        <thead>
          <tr><th colSpan={isAccount ? 3 : 4}>{s.name}</th><th className="num">Amount</th><th className="num">Balance</th></tr>
        </thead>
        <tbody>
          <tr className="bk-gl-head"><td colSpan={isAccount ? 3 : 4}>Opening balance</td><td /><td className="num">{fmt(s.opening)}</td></tr>
          {s.lines.map((l, i) => (
            <React.Fragment key={`${l.txnId}-${i}`}>
            {l.yearStart && <tr className="bk-gl-head"><td colSpan={isAccount ? 5 : 6}>Fiscal year {l.date.slice(0, 4)}: income and expense restart at zero (prior year closed to retained earnings)</td></tr>}
            <tr className={`bk-row ${l.txnId ? 'bk-click' : 'bk-gl-head'}`} onClick={() => l.txnId && onOpenTxn && onOpenTxn({ id: l.txnId, accountId: l.accountId || s.id, date: l.date })}>
              <td className="bk-nowrap">{fmtDate(l.date)}</td>
              <td className="bk-payee">{l.payee}</td>
              <td className="bk-memo">{l.memo}</td>
              {!isAccount && <td className="bk-muted">{(accountsById[l.accountId] || {}).name || ''}</td>}
              <td className={`num ${l.cents > 0 ? 'bk-pos' : ''}`}>{fmt(l.cents)}</td>
              <td className="num">{fmt(l.balance)}</td>
            </tr>
            </React.Fragment>
          ))}
          <tr className="bk-subtotal"><td colSpan={isAccount ? 3 : 4}>Closing balance · {s.lines.length} entr{s.lines.length === 1 ? 'y' : 'ies'}</td><td /><td className="num">{fmt(s.closing)}</td></tr>
        </tbody>
      </table>
    </div>
  );
  return (
    <>
      <div className="bk-chart-title">Accounts</div>
      {!gl.accounts.length && <Empty>No account activity in this period.</Empty>}
      {gl.accounts.map((s) => block(s, true))}
      <div className="bk-chart-title bk-mt">Categories</div>
      {!gl.categories.length && <Empty>No category activity in this period.</Empty>}
      {gl.categories.map((s) => block(s, false))}
      <div className="bk-muted bk-small">Amounts are signed from each account's side (card charges negative). Category openings are year-to-date for income and expense, all-time for owner equity.</div>
    </>
  );
}

export function FixedAssetsView({ summaries, asOf, postThrough, onPost, busy, toPostCount }) {
  if (!summaries) return <Empty>Loading…</Empty>;
  if (!summaries.length) return <Empty>No fixed assets yet. Add them in Setup → Fixed assets.</Empty>;
  const t = summaries.reduce((acc, s) => ({ cost: acc.cost + s.costCents, acc: acc.acc + s.accumulatedCents, book: acc.book + s.bookValueCents }), { cost: 0, acc: 0, book: 0 });
  return (
    <>
      <div className="bk-row-actions bk-mb">
        <span className="bk-muted bk-small">{toPostCount ? `${toPostCount} monthly depreciation entr${toPostCount === 1 ? 'y is' : 'ies are'} due for months ended by ${fmtDate(postThrough)}.` : `Depreciation is up to date for months ended by ${fmtDate(postThrough)}.`}</span>
        <button type="button" className="btn btn-primary btn-sm" onClick={onPost} disabled={busy || !toPostCount}>Post depreciation</button>
      </div>
      <div className="bk-table-wrap">
        <table className="bk-table bk-statement">
          <thead><tr><th>Asset</th><th>In service</th><th className="num">Life</th><th className="num">Cost</th><th className="num">Salvage</th><th className="num">Accumulated</th><th className="num">Book value</th><th>Fully depreciated</th></tr></thead>
          <tbody>
            {summaries.map((s) => (
              <tr key={s.accountId} className="bk-row">
                <td>{s.name}</td>
                <td>{fmtDate(s.inServiceDate)}</td>
                <td className="num">{s.lifeMonths % 12 === 0 ? `${s.lifeMonths / 12} yr` : `${s.lifeMonths} mo`}</td>
                <td className="num">{fmt(s.costCents)}</td>
                <td className="num">{fmt(s.salvageCents)}</td>
                <td className="num">{fmt(s.accumulatedCents)}</td>
                <td className="num">{fmt(s.bookValueCents)}</td>
                <td>
                  {s.disposedDate ? `Disposed ${fmtDate(s.disposedDate)}` : s.endMonth ? monthLabel(s.endMonth) : '—'}
                  {s.pastLifeRemainingCents > 0 && <div className="bk-bad bk-small">{fmt(s.pastLifeRemainingCents)} added after its life ended — extend the life in Setup or write it off</div>}
                </td>
              </tr>
            ))}
            <tr className="bk-total"><td colSpan={3}>Totals as of {fmtDate(asOf)}</td><td className="num">{fmt(t.cost)}</td><td /><td className="num">{fmt(t.acc)}</td><td className="num">{fmt(t.book)}</td><td /></tr>
          </tbody>
        </table>
      </div>
      <div className="bk-muted bk-small">Straight-line, full month from the in-service month. Each month posts a Depreciation expense in the asset's register; posting is safe to repeat.</div>
    </>
  );
}

export function OwnerEquityView({ report, onOpenTxn }) {
  if (!report) return <Empty>Loading…</Empty>;
  return (
    <>
      <div className="bk-kpis">
        <div className="bk-kpi"><span>Contributions</span><strong>{fmt(report.totals.contributions)}</strong></div>
        <div className="bk-kpi"><span>Distributions (draws)</span><strong>{fmt(report.totals.distributions)}</strong></div>
        <div className="bk-kpi"><span>Net owner investment</span><strong className={report.totals.net < 0 ? 'bk-neg' : ''}>{fmt(report.totals.net)}</strong><em className="bk-muted">all-time {fmt(report.closingNetCents)}</em></div>
      </div>
      <div className="bk-table-wrap">
        <table className="bk-table bk-statement">
          <thead><tr><th>Month</th><th className="num">Contributions</th><th className="num">Distributions</th><th className="num">Net</th></tr></thead>
          <tbody>
            <tr className="bk-gl-head"><td>Before this period</td><td /><td /><td className="num">{fmt(report.openingNetCents)}</td></tr>
            {report.months.map((m) => (
              <tr key={m.month} className="bk-row">
                <td>{monthLabel(m.month)}</td>
                <td className="num">{m.contributions ? fmt(m.contributions) : ''}</td>
                <td className="num">{m.distributions ? fmt(m.distributions) : ''}</td>
                <td className={`num ${m.net < 0 ? 'bk-neg' : ''}`}>{m.net ? fmt(m.net) : ''}</td>
              </tr>
            ))}
            <tr className="bk-total"><td>Period total</td><td className="num">{fmt(report.totals.contributions)}</td><td className="num">{fmt(report.totals.distributions)}</td><td className="num">{fmt(report.totals.net)}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="bk-chart-title bk-mt">Transactions</div>
      <div className="bk-table-wrap">
        <table className="bk-table">
          <thead><tr><th>Date</th><th>Payee</th><th>Category</th><th>Notes</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {!report.lines.length && <tr><td colSpan={5}><Empty>No owner contributions or draws in this period.</Empty></td></tr>}
            {report.lines.map((l) => (
              <tr key={`${l.txnId}-${l.categoryId}-${l.cents}`} className="bk-row bk-click" onClick={() => onOpenTxn && onOpenTxn({ id: l.txnId, accountId: l.accountId, date: l.date })}>
                <td>{fmtDate(l.date)}</td><td className="bk-payee">{l.payee}</td><td>{l.category}</td><td className="bk-memo">{l.memo}</td>
                <td className={`num ${l.cents > 0 ? 'bk-pos' : 'bk-neg'}`}>{fmt(l.cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bk-muted bk-small">Uses the owner equity categories (Owner contribution, Owner draw) plus spending from “Paid personally” (the owners paid it, so it counts as their contribution). None of these affect profit and loss.</div>
    </>
  );
}

export function ProjectReportView({ report, onPick }) {
  if (!report) return <Empty>Loading…</Empty>;
  if (!report.rows.length) return <Empty>No income or expense in this period.</Empty>;
  return (
    <>
      <div className="bk-table-wrap">
        <table className="bk-table bk-statement">
          <thead><tr><th>Project / app</th><th className="num">Income</th><th className="num">Expenses</th><th className="num">Net</th><th className="num">Entries</th></tr></thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.projectId} className="bk-row bk-click" onClick={() => onPick(r)} title="Show transactions">
                <td>{r.name}{r.archived ? <span className="bk-muted"> (archived)</span> : ''}</td>
                <td className="num">{r.income ? fmt(r.income) : ''}</td>
                <td className="num">{r.expense ? fmt(r.expense) : ''}</td>
                <td className={`num ${r.net < 0 ? 'bk-neg' : ''}`}>{fmt(r.net)}</td>
                <td className="num bk-muted">{r.lines.length}</td>
              </tr>
            ))}
            <tr className="bk-total"><td>Total</td><td className="num">{fmt(report.totals.income)}</td><td className="num">{fmt(report.totals.expense)}</td><td className="num">{fmt(report.totals.net)}</td><td /></tr>
          </tbody>
        </table>
      </div>
      <div className="bk-muted bk-small">Cash basis: income and expense lines only (transfers and owner equity excluded). A split line's own project wins over the transaction's. Click a project to see its transactions.</div>
    </>
  );
}

const GROUPS = [['payee', 'Payee'], ['category', 'Category'], ['project', 'Project / app'], ['month', 'Month'], ['account', 'Account']];

/**
 * Spending / transactions report: filters, grouped totals, click a group for
 * its transactions (each opens in its register).
 */
export function SpendingReportView({ report, filters, setFilters, ledger, onPick }) {
  const cats = ledger.categories.filter((c) => c.kind === 'income' || c.kind === 'expense');
  const icCats = ledger.otherCategories.filter((c) => c.kind === 'expense' && !c.archived);
  const accounts = ledger.raw.accountsMine.filter((a) => a.kind !== 'intercompany');
  const set = (patch) => setFilters({ ...filters, ...patch });
  return (
    <>
      <div className="bk-toolbar bk-spend-filters">
        <input className="bk-input" placeholder="Payee contains… (e.g. Sharmin)" value={filters.payee} onChange={(e) => set({ payee: e.target.value })} aria-label="Payee contains" />
        <select className="bk-input" multiple size={4} value={filters.categoryIds} onChange={(e) => set({ categoryIds: [...e.target.selectedOptions].map((o) => o.value) })} aria-label="Categories (none selected = all)" title="Ctrl/Cmd-click to pick several; none selected = all">
          <optgroup label="Expense">{cats.filter((c) => c.kind === 'expense').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
          <optgroup label="Income">{cats.filter((c) => c.kind === 'income').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
          <optgroup label={`Paid for ${ledger.otherMeta.short}`}>{icCats.map((c) => <option key={c.id} value={`ic:${c.id}`}>{ledger.otherMeta.short} · {c.name}</option>)}</optgroup>
        </select>
        <select className="bk-input" value={filters.projectId} onChange={(e) => set({ projectId: e.target.value })} aria-label="Project">
          <option value="">All projects</option>
          <option value="_none">No project</option>
          {ledger.allProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="bk-input" value={filters.accountId} onChange={(e) => set({ accountId: e.target.value })} aria-label="Account">
          <option value="">All accounts</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.archived ? ' (closed)' : ''}</option>)}
        </select>
        <label className="bk-field-inline"><span>Group by</span>
          <select className="bk-input" value={filters.groupBy} onChange={(e) => set({ groupBy: e.target.value })} aria-label="Group by">
            {GROUPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="bk-check"><input type="checkbox" checked={filters.includeIntercompany} onChange={(e) => set({ includeIntercompany: e.target.checked })} /> Include paid for {ledger.otherMeta.short}</label>
        {(filters.payee || filters.categoryIds.length || filters.projectId || filters.accountId) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ payee: '', categoryIds: [], projectId: '', accountId: '' })}>Clear filters</button>}
      </div>
      {!report ? <Empty>Loading…</Empty> : !report.rows.length ? <Empty>No matching income or expense in this period.</Empty> : (
        <div className="bk-table-wrap">
          <table className="bk-table bk-statement">
            <thead><tr><th>{(GROUPS.find(([k]) => k === report.groupBy) || [])[1]}</th><th className="num">Entries</th><th className="num">Spent</th><th className="num">Received</th>{report.totals.intercompany ? <th className="num">Paid for {ledger.otherMeta.short}</th> : null}</tr></thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.key} className="bk-row bk-click" onClick={() => onPick(r)} title="Show transactions">
                  <td>{report.groupBy === 'month' ? monthLabel(r.key) : r.name}</td>
                  <td className="num bk-muted">{r.count}</td>
                  <td className="num">{r.spent ? fmt(r.spent) : ''}</td>
                  <td className="num">{r.received ? fmt(r.received) : ''}</td>
                  {report.totals.intercompany ? <td className="num">{r.intercompany ? fmt(r.intercompany) : ''}</td> : null}
                </tr>
              ))}
              <tr className="bk-total"><td>Total</td><td className="num">{report.totals.count}</td><td className="num">{fmt(report.totals.spent)}</td><td className="num">{fmt(report.totals.received)}</td>{report.totals.intercompany ? <td className="num">{fmt(report.totals.intercompany)}</td> : null}</tr>
            </tbody>
          </table>
        </div>
      )}
      <div className="bk-muted bk-small">All accounts unless one is picked. Same lines as the P&L: transfers, owner money and deleted rows are left out, split lines count by their own category, and refunds net against their category, so with no filters the totals equal the P&L. Click a row to see its transactions.</div>
    </>
  );
}

/** CSV rows (arrays) for the statement tabs. */
export function statementCsvRows(tab, d) {
  const rows = [];
  if (tab === 'bs' && d.bs) {
    rows.push(['Section', 'Line', 'Amount']);
    d.bs.assets.forEach((r) => rows.push(['Assets', r.name, money(r.cents)]));
    rows.push(['Assets', 'Total assets', money(d.bs.totals.assets)]);
    d.bs.liabilities.forEach((r) => rows.push(['Liabilities', r.name, money(r.cents)]));
    rows.push(['Liabilities', 'Total liabilities', money(d.bs.totals.liabilities)]);
    d.bs.equity.forEach((r) => rows.push(['Equity', r.name, money(r.cents)]));
    rows.push(['Equity', 'Total equity', money(d.bs.totals.equity)]);
    rows.push(['', 'Total liabilities & equity', money(d.bs.totals.liabilitiesAndEquity)]);
  } else if (tab === 'tb' && d.tb) {
    rows.push(['Account / category', 'Type', 'Debit', 'Credit']);
    d.tb.rows.forEach((r) => rows.push([r.name, r.group, r.debit ? money(r.debit) : '', r.credit ? money(r.credit) : '']));
    rows.push(['Totals', '', money(d.tb.totals.debit), money(d.tb.totals.credit)]);
  } else if (tab === 'gl' && d.gl) {
    rows.push(['Section', 'Name', 'Date', 'Payee', 'Description / notes', 'Amount', 'Balance']);
    const add = (kind, s) => {
      rows.push([kind, s.name, '', 'Opening balance', '', '', money(s.opening)]);
      s.lines.forEach((l) => rows.push([kind, s.name, l.date, l.payee, l.memo || '', money(l.cents), money(l.balance)]));
      rows.push([kind, s.name, '', 'Closing balance', '', '', money(s.closing)]);
    };
    d.gl.accounts.forEach((s) => add('Account', s));
    d.gl.categories.forEach((s) => add('Category', s));
  } else if (tab === 'assets' && d.assets) {
    rows.push(['Asset', 'In service', 'Life (months)', 'Cost', 'Salvage', 'Accumulated depreciation', 'Book value']);
    d.assets.forEach((s) => rows.push([s.name, s.inServiceDate, s.lifeMonths, money(s.costCents), money(s.salvageCents), money(s.accumulatedCents), money(s.bookValueCents)]));
  } else if (tab === 'projects' && d.projects) {
    rows.push(['Project / app', 'Income', 'Expenses', 'Net']);
    d.projects.rows.forEach((r) => rows.push([r.name, money(r.income), money(r.expense), money(r.net)]));
    rows.push(['Total', money(d.projects.totals.income), money(d.projects.totals.expense), money(d.projects.totals.net)]);
    rows.push([]);
    rows.push(['Project / app', 'Date', 'Payee', 'Category', 'Description / notes', 'Amount']);
    d.projects.rows.forEach((r) => r.lines.forEach((l) => rows.push([r.name, l.date, l.payee, l.category, l.memo || '', money(l.cents)])));
  } else if (tab === 'spending' && d.spending) {
    rows.push([d.spending.groupBy, 'Entries', 'Spent', 'Received', 'Paid for other company']);
    d.spending.rows.forEach((r) => rows.push([r.name, r.count, money(r.spent), money(r.received), money(r.intercompany)]));
    rows.push(['Total', d.spending.totals.count, money(d.spending.totals.spent), money(d.spending.totals.received), money(d.spending.totals.intercompany)]);
    rows.push([]);
    rows.push(['Group', 'Date', 'Payee', 'Category', 'Description / notes', 'Amount']);
    d.spending.rows.forEach((r) => r.lines.forEach((l) => rows.push([r.name, l.date, l.payee, l.category, l.memo || '', money(l.cents)])));
  } else if (tab === 'owner' && d.owner) {
    rows.push(['Month', 'Contributions', 'Distributions', 'Net']);
    d.owner.months.forEach((m) => rows.push([m.month, money(m.contributions), money(m.distributions), money(m.net)]));
    rows.push(['Total', money(d.owner.totals.contributions), money(d.owner.totals.distributions), money(d.owner.totals.net)]);
    rows.push([]);
    rows.push(['Date', 'Payee', 'Category', 'Description / notes', 'Amount']);
    d.owner.lines.forEach((l) => rows.push([l.date, l.payee, l.category, l.memo || '', money(l.cents)]));
  }
  return rows;
}
