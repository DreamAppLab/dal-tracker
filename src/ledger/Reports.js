// Cash-basis reports for the selected company: P&L (month / quarter / YTD /
// year / custom, prior-period comparison, drill-down), income vs expense by
// month, category breakdown, category trends, income by source and the
// intercompany balance. Charts + CSV/PDF export. Month-aligned ranges read
// the cached monthly aggregates; custom ranges run one date-bounded query.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import * as core from './core';
import { useLedger } from './LedgerContext';
import { fetchAccountAll, fetchRange, postDepreciation } from './ledgerStore';
import {
  BalanceSheetView, FixedAssetsView, GeneralLedgerView, OwnerEquityView, TrialBalanceView, statementCsvRows,
} from './ReportsStatements';
import { csvCell, downloadText, Empty, fmt, fmtDate, monthLabel, todayISO } from './ui';

// Validated categorical palette (dark surface #1A2234): fixed order, never cycled.
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'];
const INCOME = SERIES[0];
const EXPENSE = SERIES[1];
const NET = SERIES[6];
const AXIS = { stroke: 'rgba(255,255,255,0.25)', tick: { fill: '#94A3B8', fontSize: 11 } };
const GRID = <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />;

const dollars = (c) => c / 100;
const tickMoney = (v) => {
  const a = Math.abs(v);
  if (a >= 1000000) return `$${(v / 1000000).toFixed(1)}M`;
  if (a >= 1000) return `$${Math.round(v / 1000)}k`;
  return `$${Math.round(v)}`;
};
const tipMoney = (v) => fmt(Math.round(v * 100));

const TABS = [
  ['pnl', 'Profit & loss', 'Statements'],
  ['bs', 'Balance sheet', 'Statements'],
  ['tb', 'Trial balance', 'Statements'],
  ['gl', 'General ledger', 'Statements'],
  ['monthly', 'Income vs expense', 'Analysis'],
  ['categories', 'Category breakdown', 'Analysis'],
  ['trends', 'Category trends', 'Analysis'],
  ['income', 'Income by source', 'Analysis'],
  ['assets', 'Fixed assets', 'Schedules'],
  ['owner', 'Owner contributions & distributions', 'Schedules'],
  ['ic', 'Intercompany', 'Schedules'],
];
const AS_OF_TABS = ['bs', 'tb', 'assets'];

function ChartTip({ active, payload, label, labelFmt }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bk-tip">
      <div className="bk-tip-title">{labelFmt ? labelFmt(label) : label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="bk-tip-row"><span className="bk-swatch" style={{ background: p.color }} />{p.name}<span className="num">{tipMoney(p.value)}</span></div>
      ))}
    </div>
  );
}

export default function Reports({ onOpenTxn }) {
  const ledger = useLedger();
  const { companyId, meta, categoriesById, categories, monthly, accountsById } = ledger;
  const [tab, setTab] = useState('pnl');
  const [kind, setKind] = useState('ytd');
  const [anchor, setAnchor] = useState(todayISO());
  const [custom, setCustom] = useState({ from: `${todayISO().slice(0, 4)}-01-01`, to: todayISO() });
  const [compare, setCompare] = useState(true);
  const [txCache, setTxCache] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [drill, setDrill] = useState(null);
  const [trendCats, setTrendCats] = useState([]);
  const [exporting, setExporting] = useState(false);
  const reportRef = useRef(null);

  const range = useMemo(() => (kind === 'custom' ? { ...custom, kind: 'custom' } : core.periodRange(kind, anchor)), [kind, anchor, custom]);
  const prior = useMemo(() => core.priorRange(range), [range]);
  const validRange = core.DATE_RE.test(range.from) && core.DATE_RE.test(range.to) && range.from <= range.to;
  const needsTx = (r) => !core.isMonthAligned(r.from, r.to);
  // Cached transactions are keyed by the aggregates' state, so any edit refreshes them.
  const sig = useMemo(() => monthly.map((m) => `${m.id}:${m.count}:${JSON.stringify(m.cat)}:${JSON.stringify(m.acct)}`).sort().join('|'), [monthly]);
  const key = (r) => `${companyId}|${r.from}|${r.to}|${sig}`;

  // Load transactions only for non month-aligned ranges (and for drill-downs).
  const inFlight = useRef(new Set());
  const PNL_TABS = ['pnl', 'categories', 'income', 'trends'];
  useEffect(() => {
    if (!validRange || !PNL_TABS.includes(tab)) return;
    const wanted = [range, ...(compare && tab === 'pnl' ? [prior] : [])].filter(needsTx).filter((r) => !txCache[key(r)] && !inFlight.current.has(key(r)));
    if (!wanted.length) return;
    let cancelled = false;
    setLoading(true);
    loadInto(wanted, () => cancelled);
    return () => { cancelled = true; };
  }, [range, prior, compare, companyId, validRange, sig, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Statements: balance sheet, trial balance, general ledger, owner equity, fixed assets ──
  const asOf = range.to;
  // Depreciation is only ever posted for months that have ended (never future-dated).
  const postThrough = asOf < todayISO() ? asOf : todayISO();
  const statementRanges = useMemo(() => {
    const list = [];
    if (['bs', 'tb'].includes(tab) && core.needsMonthTxns(asOf)) list.push({ from: core.monthStart(asOf), to: asOf });
    if (['gl', 'owner'].includes(tab)) {
      list.push({ from: range.from, to: range.to });
      if (range.from !== core.monthStart(range.from)) list.push({ from: core.monthStart(range.from), to: core.addDays(range.from, -1) });
    }
    return list;
  }, [tab, asOf, range]);
  useEffect(() => {
    if (!validRange) return undefined;
    const wanted = statementRanges.filter((r) => !txCache[key(r)] && !inFlight.current.has(key(r)));
    if (!wanted.length) return undefined;
    let cancelled = false;
    loadInto(wanted, () => cancelled);
    return () => { cancelled = true; };
  }, [statementRanges, companyId, validRange, sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const haveAll = statementRanges.every((r) => txCache[key(r)]);
  const rangeTxns = useMemo(() => statementRanges.flatMap((r) => txCache[key(r)] || []), [statementRanges, txCache, sig]); // eslint-disable-line react-hooks/exhaustive-deps

  // Include disposed (archived) assets so the schedule still shows them.
  const assetAccounts = useMemo(() => ledger.raw.accountsMine.filter((a) => a.kind === 'fixed_asset').sort((a, b) => a.name.localeCompare(b.name)), [ledger.raw.accountsMine]);
  const [assetTx, setAssetTx] = useState(null); // { key, byId }
  const assetKey = `${companyId}|${sig}|${assetAccounts.map((a) => a.id).join(',')}`;
  useEffect(() => {
    if (!['assets', 'bs'].includes(tab) || !validRange) return undefined;
    if (assetTx && assetTx.key === assetKey) return undefined;
    let cancelled = false;
    Promise.all(assetAccounts.map((a) => fetchAccountAll(companyId, a.id).then((rows) => [a.id, rows])))
      .then((pairs) => { if (!cancelled) setAssetTx({ key: assetKey, byId: Object.fromEntries(pairs) }); })
      .catch((e) => setError(e.message));
    return () => { cancelled = true; };
  }, [tab, assetKey, validRange]); // eslint-disable-line react-hooks/exhaustive-deps
  const assetsReady = !!(assetTx && assetTx.key === assetKey);
  const assetSummaries = useMemo(() => (assetsReady ? assetAccounts.map((a) => core.assetSummary(a, assetTx.byId[a.id] || [], asOf)) : null), [assetsReady, assetAccounts, assetTx, asOf]);
  const depreciationDue = useMemo(() => {
    if (!assetsReady) return 0;
    return assetAccounts.reduce((n, a) => {
      const rows = assetTx.byId[a.id] || [];
      const skip = rows.filter((t) => t.deleted && t.source === 'depreciation').map((t) => t.date.slice(0, 7));
      return n + core.depreciationToPost(a, rows, postThrough, skip).length;
    }, 0);
  }, [assetsReady, assetAccounts, assetTx, postThrough]);
  const [posting, setPosting] = useState(false);
  const [notice, setNotice] = useState('');
  const postAll = async () => {
    setPosting(true);
    setError('');
    try {
      let n = 0;
      for (const a of assetAccounts) n += await postDepreciation(a, postThrough, accountsById, categoriesById);
      setNotice(`Posted ${n} monthly depreciation entr${n === 1 ? 'y' : 'ies'} through ${fmtDate(postThrough)}.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setPosting(false);
    }
  };

  const statements = useMemo(() => {
    if (!validRange || !haveAll) return {};
    const fyBefore = (date) => `${Number(date.slice(0, 4)) - 1}-12-31`;
    const allAccounts = ledger.raw.accountsMine;
    if (['bs', 'tb'].includes(tab)) {
      const totals = core.totalsAsOf({ monthly, monthTxns: rangeTxns, companyId, asOf });
      const totalsBeforeFy = core.totalsAsOf({ monthly, monthTxns: [], companyId, asOf: fyBefore(asOf) });
      const fixedAssets = assetSummaries ? Object.fromEntries(assetSummaries.map((x) => [x.accountId, x])) : null;
      return {
        bs: core.balanceSheet({ accounts: allAccounts, categories: categoriesById, totals, totalsBeforeFy, companyId, asOf, fixedAssets }),
        tb: core.trialBalance({ accounts: allAccounts, categories: categoriesById, totals, totalsBeforeFy, companyId, asOf }),
      };
    }
    if (['gl', 'owner'].includes(tab)) {
      const before = core.addDays(range.from, -1);
      const totalsBefore = core.totalsAsOf({ monthly, monthTxns: rangeTxns, companyId, asOf: before });
      const totalsBeforeFyOfFrom = core.totalsAsOf({ monthly, monthTxns: [], companyId, asOf: fyBefore(range.from) });
      if (tab === 'gl') return { gl: core.generalLedger({ accounts: allAccounts, categories: categoriesById, totalsBefore, totalsBeforeFyOfFrom, txns: rangeTxns, companyId, from: range.from, to: range.to }) };
      return { owner: core.ownerEquityReport({ categories: categoriesById, txns: rangeTxns, companyId, from: range.from, to: range.to, totalsBefore }) };
    }
    return {};
  }, [tab, validRange, haveAll, rangeTxns, monthly, companyId, asOf, range, categoriesById, ledger.raw.accountsMine, assetSummaries]);

  function loadInto(wanted, isCancelled) {
    if (!wanted.length) return;
    wanted.forEach((r) => inFlight.current.add(key(r)));
    setLoading(true);
    Promise.all(wanted.map((r) => fetchRange(companyId, r.from, r.to).then((rows) => [key(r), rows])))
      .then((pairs) => {
        if (isCancelled()) return;
        // Keep only entries for the current aggregate state (old copies are dropped).
        setTxCache((c) => Object.fromEntries([...Object.entries(c).filter(([k]) => k.endsWith(`|${sig}`)), ...pairs]));
      })
      .catch((e) => setError(e.message))
      .finally(() => {
        wanted.forEach((r) => inFlight.current.delete(key(r)));
        if (!isCancelled()) setLoading(false);
      });
  }

  const pnlFor = (r) => {
    if (!core.isMonthAligned(r.from, r.to)) {
      const rows = txCache[key(r)];
      return rows ? core.pnlFromTransactions(rows, categoriesById, companyId, r.from, r.to) : null;
    }
    return core.pnlFromMonthly(monthly, categoriesById, companyId, r.from, r.to);
  };
  const current = validRange ? pnlFor(range) : null;
  const previous = validRange && compare ? pnlFor(prior) : null;
  const cmp = current && previous ? core.comparePnl(current, previous) : null;

  const endMonth = range.to.slice(0, 7);
  const startMonth12 = core.addMonths(endMonth, -11);
  const series = useMemo(() => core.incomeVsExpenseByMonth(monthly, categoriesById, companyId, startMonth12, endMonth)
    .map((r) => ({ month: r.month, income: dollars(r.income), expense: dollars(r.expense), net: dollars(r.net) })), [monthly, categoriesById, companyId, startMonth12, endMonth]);

  const topExpense = current ? current.expense.slice(0, 7) : [];
  useEffect(() => {
    if (!trendCats.length && topExpense.length) setTrendCats(topExpense.slice(0, 4).map((r) => r.categoryId));
  }, [topExpense.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setTrendCats([]); }, [companyId]);
  const trend = useMemo(() => core.categoryTrend(monthly, categoriesById, companyId, trendCats, startMonth12, endMonth)
    .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === 'month' ? v : dollars(v)]))), [monthly, categoriesById, companyId, trendCats, startMonth12, endMonth]);

  const icId = core.ids.intercompany(companyId);
  const icSeries = useMemo(() => core.balanceSeries(monthly, accountsById[icId], icId, companyId, startMonth12, endMonth)
    .map((r) => ({ month: r.month, balance: dollars(r.balance) })), [monthly, accountsById, icId, companyId, startMonth12, endMonth]);

  useEffect(() => {
    if (!drill) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setDrill(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drill]);

  const openDrill = async (row, which) => {
    const r = which === 'prior' ? prior : range;
    setDrill({ title: row.name, range: r, rows: null, categoryId: row.categoryId });
    try {
      let rows = txCache[key(r)];
      if (!rows) {
        rows = await fetchRange(companyId, r.from, r.to);
        setTxCache((c) => ({ ...c, [key(r)]: rows }));
      }
      setDrill({ title: row.name, range: r, categoryId: row.categoryId, rows: core.drillDown(rows, companyId, row.categoryId, r.from, r.to) });
    } catch (e) {
      setDrill(null);
      setError(e.message);
    }
  };

  // ── Exports ──────────────────────────────────────────────────────────
  const fileBase = `${meta.short}_${TABS.find((t) => t[0] === tab)[1].replace(/[^A-Za-z]+/g, '-')}_${range.from}_${range.to}`;
  const exportCsv = () => {
    const period = AS_OF_TABS.includes(tab) ? `As of ${asOf}` : `${range.from} to ${range.to}${compare && tab === 'pnl' ? ` vs ${prior.from} to ${prior.to}` : ''}`;
    const lines = [[`${meta.legalName} — ${TABS.find((t) => t[0] === tab)[1]} (cash basis)`], [period], []];
    const money = (c) => core.centsToDecimalString(c);
    if (tab === 'pnl' && current) {
      const hdr = compare && previous ? ['Section', 'Category', 'Current', 'Prior', 'Change'] : ['Section', 'Category', 'Amount'];
      lines.push(hdr);
      const rowsFor = (section, list, priorList) => list.forEach((r) => {
        const p = (priorList || []).find((x) => x.categoryId === r.categoryId);
        lines.push(compare && previous ? [section, r.name, money(r.cents), money(p ? p.cents : 0), money(r.cents - (p ? p.cents : 0))] : [section, r.name, money(r.cents)]);
      });
      rowsFor('Income', current.income, previous && previous.income);
      lines.push(compare && previous ? ['Income', 'Total income', money(current.totalIncome), money(previous.totalIncome), money(current.totalIncome - previous.totalIncome)] : ['Income', 'Total income', money(current.totalIncome)]);
      rowsFor('Expense', current.expense, previous && previous.expense);
      lines.push(compare && previous ? ['Expense', 'Total expense', money(current.totalExpense), money(previous.totalExpense), money(current.totalExpense - previous.totalExpense)] : ['Expense', 'Total expense', money(current.totalExpense)]);
      lines.push(compare && previous ? ['', 'Net income', money(current.net), money(previous.net), money(current.net - previous.net)] : ['', 'Net income', money(current.net)]);
      if (current.uncategorizedCents) lines.push(['', 'Uncategorized (excluded)', money(current.uncategorizedCents)]);
    } else if (tab === 'monthly') {
      lines.push(['Month', 'Income', 'Expense', 'Net']);
      series.forEach((r) => lines.push([r.month, r.income.toFixed(2), r.expense.toFixed(2), r.net.toFixed(2)]));
    } else if ((tab === 'categories' || tab === 'income') && current) {
      lines.push(['Category', 'Amount', '% of total']);
      const list = tab === 'income' ? current.income : current.expense;
      const total = tab === 'income' ? current.totalIncome : current.totalExpense;
      list.forEach((r) => lines.push([r.name, money(r.cents), total ? ((r.cents / total) * 100).toFixed(1) : '0']));
    } else if (tab === 'trends') {
      lines.push(['Month', ...trendCats.map((id) => (categoriesById[id] || {}).name || id)]);
      trend.forEach((r) => lines.push([r.month, ...trendCats.map((id) => (r[id] || 0).toFixed(2))]));
    } else if (['bs', 'tb', 'gl', 'assets', 'owner'].includes(tab)) {
      lines.push(...statementCsvRows(tab, { ...statements, assets: assetSummaries }));
    } else if (tab === 'ic') {
      lines.push(['Month end', `Balance (+ due from ${ledger.otherMeta.short}, − due to)`]);
      icSeries.forEach((r) => lines.push([r.month, r.balance.toFixed(2)]));
    }
    downloadText(`${fileBase}.csv`, lines.map((l) => l.map(csvCell).join(',')).join('\n'));
  };

  const exportPdf = async () => {
    if (!reportRef.current) return;
    setExporting(true);
    try {
      const [{ jsPDF }, html2canvasMod] = await Promise.all([import('jspdf'), import('html2canvas')]);
      const html2canvas = html2canvasMod.default || html2canvasMod;
      const canvas = await html2canvas(reportRef.current, {
        backgroundColor: '#ffffff',
        scale: 2,
        onclone: (d) => {
          const el = d.querySelector('[data-report-root]');
          if (el) el.classList.add('bk-print');
        },
      });
      const pdf = new jsPDF({ unit: 'pt', format: 'letter' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 36;
      pdf.setFontSize(14);
      pdf.text(`${meta.legalName} · ${TABS.find((t) => t[0] === tab)[1]} (cash basis)`, margin, margin);
      pdf.setFontSize(9);
      pdf.text(`${range.from} to ${range.to}${compare && tab === 'pnl' ? `  ·  compared with ${prior.from} to ${prior.to}` : ''}  ·  generated ${todayISO()}`, margin, margin + 14);
      const imgW = pageW - margin * 2;
      const scale = imgW / canvas.width;
      const sliceH = Math.floor((pageH - margin * 2 - 24) / scale);
      let y = 0;
      let first = true;
      while (y < canvas.height) {
        const h = Math.min(sliceH, canvas.height - y);
        const part = document.createElement('canvas');
        part.width = canvas.width;
        part.height = h;
        part.getContext('2d').drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
        if (!first) pdf.addPage();
        pdf.addImage(part.toDataURL('image/jpeg', 0.9), 'JPEG', margin, first ? margin + 24 : margin, imgW, h * scale);
        first = false;
        y += h;
      }
      pdf.save(`${fileBase}.pdf`);
    } catch (e) {
      setError(`PDF export failed: ${e.message}`);
    } finally {
      setExporting(false);
    }
  };

  if (!ledger.ready) return <Empty>Loading…</Empty>;

  const changeCell = (c) => <td className={`num ${c > 0 ? 'bk-pos' : c < 0 ? 'bk-neg' : 'bk-muted'}`}>{c ? fmt(c, { plus: true }) : '—'}</td>;
  const pnlSection = (title, rows, totals, isExpense) => (
    <>
      <tr className="bk-sec"><td colSpan={compare ? 4 : 2}>{title}</td></tr>
      {rows.map((r) => (
        <tr key={r.categoryId} className="bk-row bk-click" onClick={() => openDrill(r, 'current')} title="Show transactions">
          <td className="bk-indent">{r.name}</td>
          <td className="num">{fmt(r.cents)}</td>
          {compare && <td className="num bk-muted">{fmt(r.priorCents != null ? r.priorCents : 0)}</td>}
          {compare && changeCell(isExpense ? -(r.changeCents || 0) : r.changeCents || 0)}
        </tr>
      ))}
      {!rows.length && <tr><td className="bk-indent bk-muted" colSpan={compare ? 4 : 2}>None</td></tr>}
      <tr className="bk-subtotal">
        <td>Total {title.toLowerCase()}</td>
        <td className="num">{fmt(totals[0])}</td>
        {compare && <td className="num bk-muted">{fmt(totals[1] || 0)}</td>}
        {compare && changeCell(isExpense ? -((totals[0] || 0) - (totals[1] || 0)) : (totals[0] || 0) - (totals[1] || 0))}
      </tr>
    </>
  );

  const incomeRows = cmp ? cmp.income : (current ? current.income.map((r) => ({ ...r, priorCents: 0, changeCents: 0 })) : []);
  const expenseRows = cmp ? cmp.expense : (current ? current.expense.map((r) => ({ ...r, priorCents: 0, changeCents: 0 })) : []);
  const breakdown = current ? current.expense : [];
  const income = current ? current.income : [];

  return (
    <div className="bk-reports">
      <div className="bk-toolbar bk-report-controls">
        <div className="bk-seg" role="radiogroup" aria-label="Period">
          {[['month', 'Month'], ['quarter', 'Quarter'], ['ytd', 'YTD'], ['year', 'Year'], ['custom', 'Custom']].map(([k, l]) => (
            <button key={k} type="button" className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>{l}</button>
          ))}
        </div>
        {kind !== 'custom'
          ? <label className="bk-field-inline"><span>{kind === 'ytd' ? 'Through' : 'Period of'}</span><input className="bk-input bk-date" type="date" value={anchor} onChange={(e) => e.target.value && setAnchor(e.target.value)} /></label>
          : (
            <>
              <label className="bk-field-inline"><span>From</span><input className="bk-input bk-date" type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></label>
              <label className="bk-field-inline"><span>To</span><input className="bk-input bk-date" type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></label>
            </>
          )}
        <label className="bk-check"><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> Compare with prior period</label>
        <span className="bk-grow" />
        <button type="button" className="btn btn-secondary btn-sm" onClick={exportCsv}>Export CSV</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={exportPdf} disabled={exporting}>{exporting ? 'Building PDF…' : 'Export PDF'}</button>
      </div>

      <div className="bk-subtabs" role="tablist">
        {['Statements', 'Analysis', 'Schedules'].map((g) => (
          <span key={g} className="bk-subtab-group">
            <span className="bk-subtab-label">{g}</span>
            {TABS.filter((t) => t[2] === g).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => { setTab(k); setNotice(''); }}>{l}</button>)}
          </span>
        ))}
      </div>

      {error && <div className="bk-error" role="alert">{error}</div>}
      {!validRange && <div className="bk-error">Pick a valid date range.</div>}

      <div ref={reportRef} data-report-root className="bk-report-body">
        <div className="bk-report-head">
          <strong>{meta.legalName}</strong> · {AS_OF_TABS.includes(tab) ? `as of ${fmtDate(asOf)}` : `${fmtDate(range.from)} – ${fmtDate(range.to)}`}
          {compare && ['pnl'].includes(tab) && <span className="bk-muted"> · vs {fmtDate(prior.from)} – {fmtDate(prior.to)}</span>}
          <span className="bk-muted"> · cash basis{['pnl', 'monthly', 'categories', 'trends', 'income'].includes(tab) ? ` · excludes transfers, owner equity and amounts paid for ${ledger.otherMeta.short}` : ''}</span>
        </div>

        {tab === 'pnl' && (
          !current || (compare && !previous) ? <Empty>{loading ? 'Loading…' : 'Loading…'}</Empty> : (
            <>
              <div className="bk-kpis">
                <div className="bk-kpi"><span>Income</span><strong>{fmt(current.totalIncome)}</strong>{compare && previous && <em className="bk-muted">prior {fmt(previous.totalIncome)}</em>}</div>
                <div className="bk-kpi"><span>Expenses</span><strong>{fmt(current.totalExpense)}</strong>{compare && previous && <em className="bk-muted">prior {fmt(previous.totalExpense)}</em>}</div>
                <div className="bk-kpi"><span>Net income</span><strong className={current.net < 0 ? 'bk-neg' : ''}>{fmt(current.net)}</strong>{compare && previous && <em className="bk-muted">prior {fmt(previous.net)}</em>}</div>
              </div>
              {current.uncategorizedCents !== 0 && (
                <div className="bk-warn">⚠ {fmt(Math.abs(current.uncategorizedCents))} of uncategorized activity is not included. Categorize it in Register → Review queue.</div>
              )}
              <div className="bk-table-wrap">
                <table className="bk-table bk-pnl">
                  <thead><tr><th>Category</th><th className="num">{fmtDate(range.from)} – {fmtDate(range.to)}</th>{compare && <th className="num">Prior</th>}{compare && <th className="num">Change</th>}</tr></thead>
                  <tbody>
                    {pnlSection('Income', incomeRows, cmp ? cmp.totals.income : [current.totalIncome], false)}
                    {pnlSection('Expenses', expenseRows, cmp ? cmp.totals.expense : [current.totalExpense], true)}
                    <tr className="bk-total">
                      <td>Net income</td>
                      <td className={`num ${current.net < 0 ? 'bk-neg' : ''}`}>{fmt(current.net)}</td>
                      {compare && <td className="num bk-muted">{fmt(previous.net)}</td>}
                      {compare && changeCell(current.net - previous.net)}
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="bk-muted bk-small">Click a category to see its transactions.{current.excludedEquityCents ? ` Owner equity moves (${fmt(current.excludedEquityCents)}) are excluded.` : ''}</div>
            </>
          )
        )}

        {tab === 'bs' && <BalanceSheetView bs={statements.bs} asOf={asOf} />}
        {tab === 'tb' && <TrialBalanceView tb={statements.tb} asOf={asOf} />}
        {tab === 'gl' && <GeneralLedgerView gl={statements.gl} accountsById={accountsById} onOpenTxn={onOpenTxn} />}
        {tab === 'owner' && <OwnerEquityView report={statements.owner} onOpenTxn={onOpenTxn} />}
        {tab === 'assets' && (
          <>
            {notice && <div className="bk-notice">{notice}</div>}
            <FixedAssetsView summaries={assetSummaries} asOf={asOf} postThrough={postThrough} onPost={postAll} busy={posting} toPostCount={depreciationDue} />
          </>
        )}

        {tab === 'monthly' && (
          <div className="bk-chart-card">
            <div className="bk-chart-title">Income vs expense · last 12 months to {monthLabel(endMonth)}</div>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={series} barGap={2} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                {GRID}
                <XAxis dataKey="month" tickFormatter={monthLabel} {...AXIS} />
                <YAxis tickFormatter={tickMoney} {...AXIS} width={56} />
                <Tooltip content={<ChartTip labelFmt={monthLabel} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Legend wrapperStyle={{ color: '#94A3B8', fontSize: 12 }} />
                <Bar dataKey="income" name="Income" fill={INCOME} radius={[4, 4, 0, 0]} maxBarSize={18} />
                <Bar dataKey="expense" name="Expense" fill={EXPENSE} radius={[4, 4, 0, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
            <div className="bk-chart-title bk-mt">Net income by month</div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={series} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                {GRID}
                <XAxis dataKey="month" tickFormatter={monthLabel} {...AXIS} />
                <YAxis tickFormatter={tickMoney} {...AXIS} width={56} />
                <Tooltip content={<ChartTip labelFmt={monthLabel} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="net" name="Net" fill={NET} radius={[4, 4, 0, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
            <DataTable cols={['Month', 'Income', 'Expense', 'Net']} rows={series.map((r) => [monthLabel(r.month), r.income, r.expense, r.net])} />
          </div>
        )}

        {tab === 'categories' && (
          <Breakdown title={`Expenses by category · ${fmtDate(range.from)} – ${fmtDate(range.to)}`} list={breakdown} total={current ? current.totalExpense : 0} color={EXPENSE} onPick={(r) => openDrill(r, 'current')} loading={!current} />
        )}

        {tab === 'income' && (
          <Breakdown title={`Income by source · ${fmtDate(range.from)} – ${fmtDate(range.to)}`} list={income} total={current ? current.totalIncome : 0} color={INCOME} onPick={(r) => openDrill(r, 'current')} loading={!current} />
        )}

        {tab === 'trends' && (
          <div className="bk-chart-card">
            <div className="bk-trend-picks">
              {categories.filter((c) => c.kind !== 'equity').map((c) => {
                const on = trendCats.includes(c.id);
                const idx = trendCats.indexOf(c.id);
                return (
                  <button key={c.id} type="button" className={`bk-chip ${on ? 'active' : ''}`} disabled={!on && trendCats.length >= SERIES.length}
                    onClick={() => setTrendCats((p) => (on ? p.filter((x) => x !== c.id) : [...p, c.id]))}>
                    {on && <span className="bk-swatch" style={{ background: SERIES[idx] }} />}{c.name}
                  </button>
                );
              })}
            </div>
            <div className="bk-chart-title">Monthly amount per category · last 12 months to {monthLabel(endMonth)}</div>
            {!trendCats.length ? <Empty>Pick one or more categories above.</Empty> : (
              <>
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={trend} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                    {GRID}
                    <XAxis dataKey="month" tickFormatter={monthLabel} {...AXIS} />
                    <YAxis tickFormatter={tickMoney} {...AXIS} width={56} />
                    <Tooltip content={<ChartTip labelFmt={monthLabel} />} />
                    <Legend wrapperStyle={{ color: '#94A3B8', fontSize: 12 }} />
                    {trendCats.map((id, i) => (
                      <Line key={id} type="monotone" dataKey={id} name={(categoriesById[id] || {}).name || id} stroke={SERIES[i]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
                <DataTable cols={['Month', ...trendCats.map((id) => (categoriesById[id] || {}).name || id)]} rows={trend.map((r) => [monthLabel(r.month), ...trendCats.map((id) => r[id] || 0)])} />
              </>
            )}
          </div>
        )}

        {tab === 'ic' && (
          <div className="bk-chart-card">
            <div className="bk-chart-title">Intercompany balance with {ledger.otherMeta.legalName} at each month end (+ due from them, − due to them)</div>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={icSeries} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                {GRID}
                <XAxis dataKey="month" tickFormatter={monthLabel} {...AXIS} />
                <YAxis tickFormatter={tickMoney} {...AXIS} width={56} />
                <Tooltip content={<ChartTip labelFmt={monthLabel} />} />
                <Line type="stepAfter" dataKey="balance" name="Balance" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
            <DataTable cols={['Month end', 'Balance']} rows={icSeries.map((r) => [monthLabel(r.month), r.balance])} />
          </div>
        )}
      </div>

      {drill && (
        <div className="modal-overlay" onClick={() => setDrill(null)}>
          <div className="modal bk-modal bk-drill" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">{drill.title} · {fmtDate(drill.range.from)} – {fmtDate(drill.range.to)}</div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDrill(null)} aria-label="Close">✕</button>
            </div>
            <div className="modal-body">
              {!drill.rows ? <Empty>Loading…</Empty> : (
                <div className="bk-table-wrap">
                  <table className="bk-table">
                    <thead><tr><th>Date</th><th>Payee</th><th>Account</th><th>Memo</th><th className="num">Amount</th><th aria-label="Open" /></tr></thead>
                    <tbody>
                      {!drill.rows.length && <tr><td colSpan={6}><Empty>No transactions.</Empty></td></tr>}
                      {drill.rows.map((r) => (
                        <tr key={`${r.txnId}-${r.line}`} className="bk-row">
                          <td>{fmtDate(r.date)}</td>
                          <td className="bk-payee">{r.payee}{r.split && <span className="bk-pill">split</span>}</td>
                          <td>{(accountsById[r.accountId] || {}).name || r.accountId}</td>
                          <td className="bk-memo">{r.memo}</td>
                          <td className={`num ${r.cents > 0 ? 'bk-pos' : ''}`}>{fmt(r.cents)}</td>
                          <td className="bk-actions">{onOpenTxn && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setDrill(null); onOpenTxn({ id: r.txnId, accountId: r.accountId, date: r.date }); }}>Open</button>}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr className="bk-subtotal"><td colSpan={4}>Total</td><td className="num">{fmt(drill.rows.reduce((s, r) => s + r.cents, 0))}</td><td /></tr></tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Breakdown({ title, list, total, color, onPick, loading }) {
  if (loading) return <Empty>Loading…</Empty>;
  if (!list.length) return <Empty>No activity in this period.</Empty>;
  const data = list.map((r) => ({ ...r, value: dollars(r.cents) }));
  return (
    <div className="bk-chart-card">
      <div className="bk-chart-title">{title}</div>
      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 30 + 30)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />
          <XAxis type="number" tickFormatter={tickMoney} {...AXIS} />
          <YAxis type="category" dataKey="name" width={190} {...AXIS} />
          <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <Bar dataKey="value" name="Amount" radius={[0, 4, 4, 0]} maxBarSize={16} onClick={(d) => onPick(d && d.payload ? d.payload : d)} style={{ cursor: 'pointer' }}>
            {data.map((d) => <Cell key={d.categoryId} fill={color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="bk-table-wrap bk-mt">
        <table className="bk-table">
          <thead><tr><th>Category</th><th className="num">Amount</th><th className="num">Share</th></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.categoryId} className="bk-row bk-click" onClick={() => onPick(r)}>
                <td>{r.name}</td>
                <td className="num">{fmt(r.cents)}</td>
                <td className="num bk-muted">{total ? `${((r.cents / total) * 100).toFixed(1)}%` : '—'}</td>
              </tr>
            ))}
            <tr className="bk-subtotal"><td>Total</td><td className="num">{fmt(total)}</td><td className="num">100%</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DataTable({ cols, rows }) {
  return (
    <details className="bk-datatable">
      <summary>Show data table</summary>
      <div className="bk-table-wrap">
        <table className="bk-table">
          <thead><tr>{cols.map((c, i) => <th key={c} className={i ? 'num' : ''}>{c}</th>)}</tr></thead>
          <tbody>{rows.map((r) => <tr key={r[0]}>{r.map((v, i) => <td key={i} className={i ? 'num' : ''}>{i ? tipMoney(v) : v}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}
