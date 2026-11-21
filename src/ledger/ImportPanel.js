// Statement import: Capital One PDF, bank/card CSV, Excel (incl. the Fiverr
// invoice export). Saved column mapping per account, preview before commit,
// duplicate detection (re-importing a statement is a no-op), matching
// existing entries/transfer legs, vendor-rule categories, card-payment
// transfer pairing, and an uncategorized review queue.
import React, { useMemo, useState } from 'react';
import * as core from './core';
import { useLedger } from './LedgerContext';
import {
  apiPost, COL, db, doc, fetchAccountRange, importRecordExists, getTxn, runPlans, saveDoc, serverTimestamp, writeBatch,
} from './ledgerStore';
import { parseStatementPdf } from './import/capOnePdf';
import { CategorySelect, Empty, fmt, fmtDate, lineFromPick, pickFromLine } from './ui';
import { recordAuditEvent } from '../lib/audit';

function fileKind(file) {
  const n = String((file && file.name) || '').toLowerCase();
  if (n.endsWith('.pdf') || (file && file.type === 'application/pdf')) return 'pdf';
  if (n.endsWith('.xlsx') || n.endsWith('.xls')) return 'excel';
  if (n.endsWith('.qfx') || n.endsWith('.ofx') || n.endsWith('.qbo')) return 'ofx';
  if (n.endsWith('.csv') || n.endsWith('.txt') || n.endsWith('.tsv')) return 'csv';
  return '';
}

async function sha256Hex(file) {
  const buf = await file.arrayBuffer();
  const hash = await window.crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (window.XLSX) { resolve(); return; }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Could not load the Excel reader.')));
      return;
    }
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('Could not load the Excel reader.'));
    document.head.appendChild(el);
  });
}

async function readExcel(file) {
  if (!window.XLSX) await loadScriptOnce('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js');
  const XLSX = window.XLSX;
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('This spreadsheet has no sheets.');
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }).map((r) => (r || []).map((c) => (c == null ? '' : c)));
}

/** Fiverr "invoices" export: Date | Document type | Invoice # | Service | Project | Total. */
function isFiverrTable(table) {
  const h = (table[0] || []).map((x) => String(x).toLowerCase());
  return h.some((x) => x.includes('document type')) && h.some((x) => x.includes('invoice'));
}
function fiverrRows(table) {
  const h = table[0].map((x) => String(x).toLowerCase());
  const ix = (needle) => h.findIndex((x) => x.includes(needle));
  const [d, t, inv, svc, total] = [ix('date'), ix('document type'), ix('invoice'), ix('service'), ix('total')];
  return table.slice(1).map((c) => {
    const cents = core.parseMoneyToCents(c[total]);
    const credit = String(c[t] || '').toLowerCase().includes('credit');
    return { date: core.parseFlexibleDate(c[d]), payee: 'Fiverr', memo: [c[inv], c[svc]].filter(Boolean).join(' · '), amountCents: cents ? (credit ? Math.abs(cents) : -Math.abs(cents)) : 0 };
  }).filter((r) => r.date && r.amountCents);
}

const STATUS_LABEL = {
  new: { text: 'New', cls: 'bk-pill-ok' },
  duplicate: { text: 'Already imported', cls: '' },
  match: { text: 'Matches existing', cls: 'bk-pill-info' },
  possible: { text: 'Possible duplicate', cls: 'bk-pill-warn' },
};

export default function ImportPanel({ onDone }) {
  const ledger = useLedger();
  const { companyId, accounts, accountsById, categoriesById, rules } = ledger;
  const ownerCat = core.ids.category(companyId, 'owner_contribution');
  const bankish = accounts.filter((a) => a.kind === 'checking' || a.kind === 'credit_card');
  const [accountId, setAccountId] = useState('');
  const [file, setFile] = useState(null);
  const [step, setStep] = useState('pick'); // pick | map | preview | importing | done
  const [table, setTable] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null); // { hash, importId, kind }
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState('');

  const acctId = accountId && accountsById[accountId] && accountsById[accountId].companyId === companyId ? accountId : (bankish[0] || {}).id;
  const account = accountsById[acctId];
  const otherAcct = account ? bankish.find((a) => a.id !== account.id && a.kind !== account.kind) : null;

  const reset = () => { setStep('pick'); setTable(null); setMapping(null); setRows([]); setMeta(null); setError(''); setProgress(''); };

  const parse = async () => {
    setError('');
    setNotice('');
    if (!file || !account) return;
    const kind = fileKind(file);
    if (!kind) { setError('Upload a Chase QFX/CSV download, a Capital One PDF, or an Excel file.'); return; }
    try {
      setProgress('Reading file…');
      const hash = await sha256Hex(file);
      const importId = core.ids.imported(companyId, hash);
      // Also recognise statements imported by the retired Expenses importer
      // (CSV/Excel ids were "excel_<sha>" or built from Fiverr invoice numbers).
      const candidates = [importId];
      let legacyTable = null;
      if (companyId === 'dal' && (kind === 'csv' || kind === 'excel')) {
        candidates.push(core.legacyImportId(`excel_${hash}`));
        legacyTable = kind === 'excel' ? await readExcel(file) : core.parseCsvText(await file.text());
        if (legacyTable.length && isFiverrTable(legacyTable)) {
          const h = legacyTable[0].map((x) => String(x).toLowerCase());
          const inv = h.findIndex((x) => x.includes('invoice'));
          const nums = legacyTable.slice(1).map((r) => String(r[inv] || '').trim()).filter(Boolean).slice(0, 8).map((n) => n.replace(/[^\w-]/g, ''));
          if (nums.length) candidates.push(core.legacyImportId(`excel_${nums.join('_')}`));
        }
      }
      let prior = null;
      for (const c of candidates) {
        prior = await importRecordExists(c);
        if (prior) break;
      }
      if (prior) {
        setProgress('');
        setNotice(`This exact statement file was already imported${prior.fileName ? ` (${prior.fileName})` : ''}. Nothing to do — re-importing is a no-op.`);
        return;
      }
      setMeta({ hash, importId, kind });
      if (kind === 'ofx') {
        const parsed = core.parseOfx(await file.text());
        if (!parsed.rows.length) throw new Error(parsed.errors[0] || 'No transactions found in this QFX/OFX file.');
        if (parsed.accountType && parsed.accountType !== account.kind) {
          throw new Error(`This file is a ${parsed.accountType === 'credit_card' ? 'credit card' : 'bank account'} download${parsed.last4 ? ` (ending ${parsed.last4})` : ''}, but you picked ${account.name}. Choose the matching account.`);
        }
        if (parsed.last4 && account.last4 && parsed.last4 !== account.last4) {
          throw new Error(`This file is for the account ending ${parsed.last4}; ${account.name} ends ${account.last4}. Choose the matching account.`);
        }
        await classify(parsed.rows, importId);
        return;
      }
      if (kind === 'pdf') {
        const parsed = await parseStatementPdf(file);
        const ledgerRows = core.fromCapOnePdfRows(parsed);
        if (!ledgerRows.length) throw new Error('No transactions found. This parser reads Capital One card statements; for other banks export CSV instead.');
        await classify(ledgerRows, importId);
        return;
      }
      const t = legacyTable || (kind === 'excel' ? await readExcel(file) : core.parseCsvText(await file.text()));
      if (!t.length) throw new Error('The file is empty.');
      if (isFiverrTable(t)) {
        await classify(fiverrRows(t), importId);
        return;
      }
      setTable(t);
      const saved = account.importMapping;
      const preset = core.detectPreset(t[0] || []);
      const headers = (t[0] || []).map(String);
      const savedFits = saved && [saved.dateCol, saved.payeeCol].every((c) => headers.includes(c));
      setMapping(savedFits ? saved : preset ? { ...core.PRESETS[preset].mapping, dateFormat: 'auto' } : {
        dateCol: headers.find((h) => /date/i.test(h)) || '', payeeCol: headers.find((h) => /desc|payee|merchant|name/i.test(h)) || '',
        amountCol: headers.find((h) => /amount/i.test(h)) || '', memoCol: '', debitCol: '', creditCol: '', typeCol: '',
        amountSign: account.kind === 'credit_card' ? 'inverted' : 'signed', dateFormat: 'auto',
      });
      setStep('map');
      setProgress('');
    } catch (e) {
      setProgress('');
      setError(e.message || 'Could not read this file.');
    }
  };

  const mapped = useMemo(() => (table && mapping ? core.applyMapping(table, mapping) : { rows: [], errors: [] }), [table, mapping]);

  async function classify(incoming, importId) {
    setProgress('Checking for duplicates…');
    const fp = core.withFingerprints(account.id, incoming);
    const dates = fp.map((r) => r.date).sort();
    const from = core.addDays(dates[0], -7);
    const to = core.addDays(dates[dates.length - 1], 7);
    const existing = await fetchAccountRange(companyId, account.id, from, to);
    const otherTxns = otherAcct ? await fetchAccountRange(companyId, otherAcct.id, from, to) : [];
    const classified = core.classifyRows(fp, existing);
    const used = new Set();
    const out = classified.map((r, i) => {
      const row = { ...r, key: i, importId, pick: '', pairTxnId: null };
      if (r.status === 'new' || r.status === 'possible') {
        const s = core.suggestTransfer(r, account.kind, otherAcct && otherAcct.id, otherTxns, used);
        if (s) {
          row.pick = `xfer:${s.transferAccountId}`;
          row.pairTxnId = s.pairTxnId;
          if (s.pairTxnId) {
            used.add(s.pairTxnId);
            const pt = otherTxns.find((t) => t.id === s.pairTxnId);
            row.pairLabel = pt ? `${pt.payee || '—'} · ${fmtDate(pt.date)}` : '';
          }
        } else {
          const rule = core.matchVendorRule(r.payee, rules);
          if (rule) {
            row.pick = `cat:${rule.categoryId}`;
            row.projectId = rule.projectId || null;
            row.rulePick = `cat:${rule.categoryId}`;
          }
        }
      }
      if (r.status === 'match') {
        const m = existing.find((t) => t.id === r.matchTxnId);
        row.matchLabel = m ? `${m.payee || '—'} · ${fmtDate(m.date)}` : '';
      }
      return row;
    });
    // "Card payments on this account are paid personally": a payment is the
    // owners' money, so it's an owner contribution, not a transfer from checking.
    if (account.kind === 'credit_card' && account.cardPaymentsPaidPersonally && categoriesById[ownerCat]) {
      out.forEach((row) => {
        if ((row.status === 'new' || row.status === 'possible') && core.isLikelyCardPayment(row, 'credit_card')) {
          row.pick = `cat:${ownerCat}`;
          row.pairTxnId = null;
          row.pairLabel = '';
        }
      });
    }
    setRows(out);
    setStep('preview');
    setProgress('');
  }

  const patch = (key, p) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)));

  // Double-count guard (DAL card with migrated history): a payment paid
  // personally that is bigger than what the card owes at that point is paying
  // charges already covered by "Card payments before Books". That part is
  // marked so the estimate shrinks instead of the owners' money counting twice
  // (and the card going below $0.00).
  const coverage = useMemo(() => {
    if (!account || account.id !== core.ACCOUNT || !account.cardPaymentsPaidPersonally) return {};
    let owed = -((ledger.balances || {})[account.id] || 0);
    const out = {};
    const live = rows.filter((r) => r.selected && r.status !== 'match' && r.status !== 'duplicate')
      .sort((a, b) => a.date.localeCompare(b.date) || a.amountCents - b.amountCents);
    for (const r of live) {
      if (r.amountCents < 0) { owed += -r.amountCents; continue; }
      if (r.pick === `cat:${ownerCat}`) {
        const excess = Math.max(0, r.amountCents - Math.max(owed, 0));
        if (excess) out[r.key] = excess;
        owed = Math.max(owed, 0) - (r.amountCents - excess);
      } else {
        owed -= r.amountCents;
      }
    }
    return out;
  }, [rows, account, ledger.balances, ownerCat]);
  const selected = rows.filter((r) => r.selected);
  const counts = rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
  const pairCount = rows.filter((r) => r.selected && r.pick.startsWith('xfer:')).length;
  const uncatCount = rows.filter((r) => r.selected && r.status !== 'match' && !r.pick).length;

  const commit = async () => {
    setError('');
    setStep('importing');
    try {
      const work = [];
      for (const r of selected) {
        if (r.status === 'match') {
          work.push({ kind: 'match', r });
        } else if (r.pairTxnId && r.pick === `xfer:${otherAcct && otherAcct.id}`) {
          work.push({ kind: 'pair', r });
        } else {
          work.push({ kind: 'new', r });
        }
      }
      let done = 0;
      const CHUNK = 60;
      for (let i = 0; i < work.length; i += CHUNK) {
        const slice = work.slice(i, i + CHUNK);
        // Matches only stamp the existing entry (no money moves).
        const matches = slice.filter((w) => w.kind === 'match');
        if (matches.length) {
          const batch = writeBatch(db);
          for (const { r } of matches) {
            const t = await getTxn(r.matchTxnId);
            if (!t) continue;
            batch.set(doc(db, COL.transactions, t.id), {
              fingerprint: r.fingerprint, importId: r.importId,
              ...(t.status === 'reconciled' ? {} : { status: 'cleared' }),
              updatedAt: serverTimestamp(),
            }, { merge: true });
          }
          await batch.commit();
        }
        // Pairs and new rows are planned inside one Firestore transaction with
        // fresh reads, like every other ledger write.
        const entries = slice.filter((w) => w.kind !== 'match').map(({ kind, r }) => {
          if (kind === 'pair') {
            // The existing opposite entry becomes a transfer; its new leg in
            // this account IS the imported row (fingerprinted, cleared).
            return {
              id: r.pairTxnId,
              linkedOverrides: { [core.ids.leg(r.pairTxnId, '0')]: { status: 'cleared', fingerprint: r.fingerprint, importId: r.importId } },
              makeDraft: (before) => {
                if (!before || before.deleted || before.transferAccountId || before.categoryId || (before.splits && before.splits.length)) return undefined;
                return { ...before, transferAccountId: account.id, categoryId: null, icCategoryId: null, splits: [], lineId: null };
              },
            };
          }
          return {
            id: `${account.id}_${r.fingerprint}`,
            // Never overwrite: an existing doc (moved outside the preview
            // window, or deleted) means this row was imported before.
            makeDraft: (before) => (before ? undefined : {
              companyId, accountId: account.id, date: r.date, payee: r.payee, memo: r.memo || '', amountCents: r.amountCents,
              ...lineFromPick(r.pick, companyId), splits: [], status: 'cleared', source: 'import',
              projectId: r.projectId && r.pick === r.rulePick ? r.projectId : null,
              coversHistoricalCents: coverage[r.key] && r.coverAck !== false ? coverage[r.key] : null,
              fingerprint: r.fingerprint, importId: r.importId,
            }),
          };
        });
        if (entries.length) await runPlans(entries, accountsById, categoriesById);
        done += slice.length;
        setProgress(`Imported ${done} of ${work.length}…`);
      }
      const dates = rows.map((r) => r.date).sort();
      await saveDoc(COL.imports, meta.importId, {
        companyId, accountId: account.id, fileName: file ? file.name.slice(0, 200) : '', kind: meta.kind,
        periodStart: dates[0] || '', periodEnd: dates[dates.length - 1] || '', rowCount: rows.length, importedCount: work.length,
        importedAt: serverTimestamp(),
      }, false);
      if (mapping && meta.kind !== 'pdf') await saveDoc(COL.accounts, account.id, { importMapping: mapping });
      recordAuditEvent('import', `ledgerImports/${meta.importId}`, { companyId, accountId: account.id, rows: work.length, fileType: meta.kind });
      const coveredRows = selected.filter((r) => coverage[r.key] && r.coverAck !== false && r.status !== 'match');
      if (coveredRows.length) {
        // Recompute "Card payments before Books" now that real payments cover part of it.
        setProgress('Updating “Card payments before Books”…');
        await apiPost('/api/ledger/migrate', { mode: 'settle', as: account.historicalPaymentsAs || 'owner' });
      }
      setProgress('');
      setNotice(`Imported ${work.length} transactions into ${account.name}. ${uncatCount ? `${uncatCount} need a category (Register → Review queue).` : ''}`);
      setStep('done');
      if (onDone) onDone();
    } catch (e) {
      setError(`${e.message} — anything already written is safe; re-run the import and duplicates will be skipped.`);
      setStep('preview');
    }
  };

  if (!ledger.ready) return <Empty>Loading…</Empty>;
  if (!bankish.length) return <Empty>No accounts yet. Open Setup first.</Empty>;

  const headers = table ? (table[0] || []).map(String) : [];
  const colSelect = (field, label, optional) => (
    <label className="bk-field">
      <span>{label}</span>
      <select className="bk-input" value={mapping[field] || ''} onChange={(e) => setMapping({ ...mapping, [field]: e.target.value })}>
        <option value="">{optional ? '— none —' : 'Pick a column'}</option>
        {headers.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
    </label>
  );

  return (
    <div className="bk-import">
      <div className="bk-panel bk-import-pick">
        <label className="bk-field">
          <span>Import into</span>
          <select className="bk-input" value={acctId} onChange={(e) => { setAccountId(e.target.value); reset(); }} disabled={step === 'importing'}>
            {bankish.map((a) => <option key={a.id} value={a.id}>{a.name}{a.last4 ? ` ··${a.last4}` : ''}</option>)}
          </select>
        </label>
        <label className="bk-field bk-grow">
          <span>Statement file (Chase QFX or CSV, Capital One PDF, Excel)</span>
          <input className="bk-input" type="file" accept=".qfx,.ofx,.qbo,.csv,.tsv,.txt,.pdf,.xlsx,.xls,application/pdf,text/csv" onChange={(e) => { setFile(e.target.files && e.target.files[0]); reset(); setNotice(''); }} disabled={step === 'importing'} />
        </label>
        <button type="button" className="btn btn-primary" onClick={parse} disabled={!file || step === 'importing'}>Read statement</button>
      </div>

      {progress && <div className="bk-notice">{progress}</div>}
      {notice && <div className="bk-notice">{notice}</div>}
      {error && <div className="bk-error" role="alert">{error}</div>}

      {step === 'map' && mapping && (
        <div className="bk-panel">
          <div className="bk-kicker">Column mapping · saved for {account.name} after import</div>
          <div className="bk-form-grid bk-map-grid">
            {colSelect('dateCol', 'Date')}
            {colSelect('payeeCol', 'Description / payee')}
            {colSelect('amountCol', 'Amount (single column)', true)}
            {colSelect('debitCol', 'Debit column', true)}
            {colSelect('creditCol', 'Credit column', true)}
            {colSelect('typeCol', 'Debit/Credit type column', true)}
            {colSelect('memoCol', 'Memo', true)}
            <label className="bk-field">
              <span>Amount sign</span>
              <select className="bk-input" value={mapping.amountSign || 'signed'} onChange={(e) => setMapping({ ...mapping, amountSign: e.target.value })}>
                <option value="signed">Negative = money out</option>
                <option value="inverted">Positive = money out (most card exports)</option>
                <option value="positive">Always positive; type column says debit/credit</option>
              </select>
            </label>
            <label className="bk-field">
              <span>Date format</span>
              <select className="bk-input" value={mapping.dateFormat || 'auto'} onChange={(e) => setMapping({ ...mapping, dateFormat: e.target.value })}>
                <option value="auto">Auto (MM/DD/YYYY or YYYY-MM-DD)</option>
                <option value="DMY">DD/MM/YYYY</option>
              </select>
            </label>
          </div>
          {mapped.errors.length > 0 && <div className="bk-muted bk-small">{mapped.errors.slice(0, 5).join(' ')}{mapped.errors.length > 5 ? ` (+${mapped.errors.length - 5} more)` : ''}</div>}
          <div className="bk-map-sample">
            {mapped.rows.slice(0, 4).map((r, i) => <div key={i}><span>{fmtDate(r.date)}</span><span>{r.payee}</span><span className={`num ${r.amountCents > 0 ? 'bk-pos' : ''}`}>{fmt(r.amountCents)}</span></div>)}
          </div>
          <div className="bk-row-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={reset}>Cancel</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={!mapped.rows.length} onClick={() => classify(mapped.rows, meta.importId).catch((e) => setError(e.message))}>
              Preview {mapped.rows.length} rows
            </button>
          </div>
        </div>
      )}

      {(step === 'preview' || step === 'importing') && (
        <>
          <div className="bk-import-summary">
            <span className="bk-pill bk-pill-ok">{counts.new || 0} new</span>
            <span className="bk-pill">{counts.duplicate || 0} already imported</span>
            <span className="bk-pill bk-pill-info">{counts.match || 0} match existing</span>
            <span className="bk-pill bk-pill-warn">{counts.possible || 0} possible duplicates</span>
            <span className="bk-pill">{pairCount} card payments → transfers</span>
            <span className="bk-pill">{uncatCount} uncategorized</span>
            <span className="bk-grow" />
            <button type="button" className="btn btn-secondary btn-sm" onClick={reset} disabled={step === 'importing'}>Cancel</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={commit} disabled={!selected.length || step === 'importing'}>
              Import {selected.length} selected
            </button>
          </div>
          <div className="bk-table-wrap">
            <table className="bk-table bk-import-table">
              <thead>
                <tr>
                  <th className="center"><input type="checkbox" aria-label="Select all" checked={rows.length > 0 && rows.filter((r) => r.status !== 'duplicate').every((r) => r.selected)} onChange={(e) => setRows((p) => p.map((r) => (r.status === 'duplicate' ? r : { ...r, selected: e.target.checked })))} /></th>
                  <th>Status</th><th>Date</th><th>Payee</th><th>Category / transfer</th>
                  <th className="num">{account.kind === 'credit_card' ? 'Charge' : 'Payment'}</th>
                  <th className="num">{account.kind === 'credit_card' ? 'Payment' : 'Deposit'}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className={`bk-row ${r.status === 'duplicate' ? 'bk-row-dim' : ''}`}>
                    <td className="center"><input type="checkbox" checked={r.selected} disabled={r.status === 'duplicate'} onChange={(e) => patch(r.key, { selected: e.target.checked })} aria-label={`Import ${r.payee}`} /></td>
                    <td>
                      <span className={`bk-pill ${STATUS_LABEL[r.status].cls}`}>{STATUS_LABEL[r.status].text}</span>
                      {r.status === 'match' && <div className="bk-muted bk-small">{r.matchLabel}</div>}
                      {r.pairTxnId && r.pick.startsWith('xfer:') && <div className="bk-muted bk-small">Links to {r.pairLabel || 'the payment'} in {otherAcct && otherAcct.name}</div>}
                    </td>
                    <td className="bk-nowrap">{fmtDate(r.date)}</td>
                    <td className="bk-payee" title={r.payee}>{r.payee}{r.memo ? <div className="bk-muted bk-small">{r.memo}</div> : null}
                      {coverage[r.key] > 0 && (
                        <label className="bk-check bk-small bk-warn-text">
                          <input type="checkbox" checked={r.coverAck !== false} onChange={(e) => patch(r.key, { coverAck: e.target.checked })} />
                          {fmt(coverage[r.key])} of this pays charges already counted in “Card payments before Books” — don’t count it twice
                        </label>
                      )}
                    </td>
                    <td>
                      {r.status === 'match' || r.status === 'duplicate'
                        ? <span className="bk-muted">{r.status === 'match' ? 'Keeps existing booking' : '—'}</span>
                        : <CategorySelect ledger={ledger} accountId={account.id} value={r.pick} allowSplit={false} onChange={(v) => patch(r.key, { pick: v, pairTxnId: v === pickFromLine({ transferAccountId: otherAcct && otherAcct.id }) ? r.pairTxnId : null })} />}
                    </td>
                    <td className="num">{r.amountCents < 0 ? fmt(-r.amountCents) : ''}</td>
                    <td className="num bk-pos">{r.amountCents > 0 ? fmt(r.amountCents) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {step === 'pick' && !notice && !error && (
        <div className="bk-panel bk-help">
          <div className="bk-kicker">How import works</div>
          <ul>
            <li><strong>Chase:</strong> on chase.com open the account → Download account activity → choose <em>Quicken Web Connect (.QFX)</em> (best: exact duplicate detection) or <em>Spreadsheet (.CSV)</em>. Both checking and credit card formats are recognised automatically.</li>
            <li>Pick the account, choose the file, review the preview, then import. Nothing is written before you click Import.</li>
            <li>Re-importing the same statement is a no-op: the file fingerprint and each row's fingerprint are remembered.</li>
            <li>Rows that match something you already entered (or the other side of a card payment) are attached to it instead of duplicated.</li>
            <li>Card payments become transfers between checking and the card — never expenses. On a card marked <em>Payments paid personally</em> (Setup → Accounts) they import as owner contributions instead. Vendor rules fill categories; anything left goes to the Review queue.</li>
          </ul>
        </div>
      )}
    </div>
  );
}
