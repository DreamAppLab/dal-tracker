import React, { useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { EXPENSE_APPS, EXPENSE_CATEGORIES, formatMoney, taxYearFromDate } from '../data/expensesData';
import { parseStatementPdf } from '../utils/parseExpenseStatement';

const FIVERR_CATEGORIES = ['Design', 'Development', 'Office', 'Uncategorized', 'Professional Services'];
const IMPORT_CATEGORIES = Array.from(new Set([...EXPENSE_CATEGORIES, ...FIVERR_CATEGORIES]));
const IMPORT_APPS = Array.from(new Set([...EXPENSE_APPS, 'DAL']));

const SERVICE_CATEGORY_MAP = {
  'logo design': 'Design',
  'website development': 'Development',
  'mobile app development': 'Development',
  'software development': 'Development',
  'data entry': 'Professional Services',
  'data formatting': 'Professional Services',
  'voice over': 'Professional Services',
  office: 'Office',
};

const PROJECT_APP_MAP = {
  travelwhirl: 'TravelWhirl',
  'family thread': 'FamilyThread',
  familythread: 'FamilyThread',
  'my class log': 'MyClassLog',
  myclasslog: 'MyClassLog',
  'rv vault': 'RV Vault',
  'ten miles ahead': 'Ten Miles Ahead',
  dal: 'DAL',
};

function fileKind(file) {
  const name = String(file && file.name ? file.name : '').toLowerCase();
  if (name.endsWith('.pdf') || (file && file.type === 'application/pdf')) return 'pdf';
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return 'excel';
  if (name.endsWith('.csv')) return 'csv';
  return '';
}

async function statementIdFromFile(file) {
  const buf = await file.arrayBuffer();
  if (window.crypto && window.crypto.subtle) {
    const hash = await window.crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function excelStatementId(invoiceNumbers) {
  const first = invoiceNumbers
    .map((n) => String(n || '').trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((n) => n.replace(/[^\w-]/g, ''));
  if (!first.length) return '';
  return `excel_${first.join('_')}`;
}

function isDuplicateExpense(existing, transaction) {
  return existing.some((e) => (
    e.date === transaction.date
    && Math.abs(parseFloat(e.amount) - parseFloat(transaction.amount)) < 0.01
    && String(e.vendor || '').toLowerCase().trim() === String(transaction.vendor || '').toLowerCase().trim()
  ));
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (window.XLSX) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Could not load Excel parser.')));
      return;
    }
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('Could not load Excel parser.'));
    document.head.appendChild(el);
  });
}

async function loadSheetJs() {
  if (window.XLSX) return window.XLSX;
  await loadScriptOnce('https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js');
  if (!window.XLSX) throw new Error('Could not load Excel parser.');
  return window.XLSX;
}

function mapServiceToCategory(service) {
  const key = String(service || '').trim().toLowerCase();
  return SERVICE_CATEGORY_MAP[key] || 'Uncategorized';
}

function mapProjectToApp(project) {
  const key = String(project || '').trim().toLowerCase();
  return PROJECT_APP_MAP[key] || 'DAL';
}

function parseImportDate(value, XLSX) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof value === 'number' && XLSX && XLSX.SSF && typeof XLSX.SSF.parse_date_code === 'function') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && parsed.y) {
      const m = String(parsed.m).padStart(2, '0');
      const d = String(parsed.d).padStart(2, '0');
      return `${parsed.y}-${m}-${d}`;
    }
  }
  const s = String(value == null ? '' : value).trim();
  const match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return '';
  return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
}

function parseImportAmount(total, documentType) {
  const raw = String(total == null ? '' : total).replace(/,/g, '').trim();
  let n = parseFloat(raw);
  if (!Number.isFinite(n)) return null;
  const isCredit = String(documentType || '').trim().toLowerCase() === 'credit invoice';
  if (isCredit && n > 0) n = -n;
  return n;
}

function mapInvoiceRows(rawRows, XLSX) {
  const dataRows = rawRows.slice(1);
  const out = [];
  dataRows.forEach((cols) => {
    const cells = Array.isArray(cols) ? cols : [];
    if (!cells.length || cells.every((c) => c == null || String(c).trim() === '')) return;
    const documentType = cells[1];
    const invoiceNumber = cells[2] == null ? '' : String(cells[2]).trim();
    const service = cells[3] == null ? '' : String(cells[3]).trim();
    const project = cells[4] == null ? '' : String(cells[4]).trim();
    const date = parseImportDate(cells[0], XLSX);
    const amount = parseImportAmount(cells[5], documentType);
    if (!date || amount == null) return;
    out.push({
      date,
      vendor: 'Fiverr',
      amount,
      category: mapServiceToCategory(service),
      appId: mapProjectToApp(project),
      notes: invoiceNumber,
      description: invoiceNumber,
      taxYear: taxYearFromDate(date),
      source: 'excel-import',
      service,
      project,
      isCredit: amount < 0,
      selected: true,
    });
  });
  return out;
}

async function parseExcelFile(file) {
  const XLSX = await loadSheetJs();
  const buf = await file.arrayBuffer();
  const workbook = XLSX.read(buf, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('This spreadsheet has no sheets.');
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  return mapInvoiceRows(rows, XLSX);
}

function splitCsvLine(line) {
  if (line.includes('\t')) return line.split('\t');
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

async function parseCsvFile(file) {
  const text = await file.text();
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim());
  const rows = lines.map(splitCsvLine);
  return mapInvoiceRows(rows, null);
}

export default function ImportStatementModal({ onClose, onImported, onManualEntry }) {
  const [step, setStep] = useState('upload');
  const [file, setFile] = useState(null);
  const [kind, setKind] = useState('');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [doneCount, setDoneCount] = useState(0);
  const [statementId, setStatementId] = useState('');
  const [billingRange, setBillingRange] = useState({ start: '', end: '' });

  const selected = useMemo(() => rows.filter((r) => r.selected), [rows]);
  const selectedTotal = selected.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const duplicateCount = rows.filter((r) => r.isDuplicate).length;
  const creditCount = rows.filter((r) => Number(r.amount) < 0).length;
  const isExcelKind = kind === 'excel' || kind === 'csv';

  const handleFile = (next) => {
    setError('');
    if (!next) {
      setFile(null);
      setKind('');
      return;
    }
    const detected = fileKind(next);
    if (!detected) {
      setError('Please upload a PDF, Excel, or CSV file.');
      return;
    }
    setFile(next);
    setKind(detected);
    setRows([]);
    setStatementId('');
    setStep('upload');
  };

  const parseFile = async () => {
    if (!file) return;
    setError('');
    setStep('parsing');
    try {
      let parsed = [];
      let id = '';
      if (kind === 'pdf') {
        parsed = await parseStatementPdf(file);
        id = await statementIdFromFile(file);
      } else if (kind === 'excel') {
        parsed = await parseExcelFile(file);
        id = excelStatementId(parsed.map((r) => r.notes));
        if (!id) id = `excel_${await statementIdFromFile(file)}`;
      } else if (kind === 'csv') {
        parsed = await parseCsvFile(file);
        id = excelStatementId(parsed.map((r) => r.notes));
        if (!id) id = `excel_${await statementIdFromFile(file)}`;
      }

      if (!parsed.length) {
        setStep('unparsed');
        return;
      }

      setStatementId(id);
      const stmtSnap = await getDoc(doc(db, 'importedStatements', id));
      if (stmtSnap.exists()) {
        setError('This statement has already been imported. Upload a different file, or review existing expenses.');
        setStep('upload');
        return;
      }

      const dates = parsed.map((row) => row.date).filter(Boolean).sort();
      const billingStart = dates[0];
      const billingEnd = dates[dates.length - 1];
      setBillingRange({ start: billingStart, end: billingEnd });

      let existingExpenses = [];
      if (billingStart && billingEnd) {
        const q = query(
          collection(db, 'expenses'),
          where('date', '>=', billingStart),
          where('date', '<=', billingEnd)
        );
        const existingSnap = await getDocs(q);
        existingExpenses = existingSnap.docs.map((d) => d.data());
      }

      setRows(parsed.map((row, i) => {
        const duplicate = isDuplicateExpense(existingExpenses, row);
        return {
          ...row,
          id: `row-${i}`,
          isDuplicate: duplicate,
          selected: !duplicate,
        };
      }));
      setStep('preview');
    } catch (err) {
      setError(err.message || 'Could not parse this file.');
      setStep('upload');
    }
  };

  const patchRow = (id, patch) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const toggleAll = (checked) => {
    setRows((prev) => prev.map((row) => ({ ...row, selected: checked })));
  };

  const importSelected = async () => {
    if (!selected.length) {
      setError('Select at least one transaction to import.');
      return;
    }
    setError('');
    setStep('importing');
    setProgress({ current: 0, total: selected.length });

    try {
      for (let i = 0; i < selected.length; i += 1) {
        const row = selected[i];
        const ref = doc(collection(db, 'expenses'));
        await setDoc(
          ref,
          {
            date: row.date,
            vendor: row.vendor,
            amount: Number(row.amount),
            category: row.category,
            appId: row.appId,
            app: row.appId,
            taxYear: row.taxYear,
            source: row.source || (isExcelKind ? 'excel-import' : 'import'),
            statementId: statementId || '',
            notes: row.notes || '',
            description: row.notes || row.description || '',
            parsedByAI: false,
            needsReview: false,
            createdAt: serverTimestamp(),
          },
          { merge: true }
        );
        setProgress({ current: i + 1, total: selected.length });
      }

      if (statementId) {
        await setDoc(
          doc(db, 'importedStatements', statementId),
          {
            statementId,
            fileName: file ? file.name : '',
            billingStart: billingRange.start,
            billingEnd: billingRange.end,
            importedCount: selected.length,
            importedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      setDoneCount(selected.length);
      setStep('done');
      if (onImported) onImported();
      window.setTimeout(() => onClose(), 1400);
    } catch (err) {
      setError(err.message || 'Import failed. Some expenses may already be saved.');
      setStep('preview');
    }
  };

  const busy = step === 'parsing' || step === 'importing';

  return (
    <div className="modal-overlay expenses-import-overlay" onClick={() => !busy && onClose()}>
      <div className="modal expenses-import-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Import Expenses</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>✕</button>
        </div>

        <div className="modal-body">
          {step === 'upload' && (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Upload a statement or invoice export</label>
              <input
                className="form-input"
                type="file"
                accept=".pdf,.xlsx,.xls,.csv,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                onChange={(e) => handleFile(e.target.files && e.target.files[0])}
              />
              <div className="expenses-file-name" style={{ marginTop: 8 }}>
                Supports Capital One PDF statements and Excel/CSV invoice exports (Fiverr, and other tab-separated formats)
              </div>
              {file && <div className="expenses-file-name">{file.name}</div>}
            </div>
          )}

          {step === 'parsing' && (
            <div className="expenses-import-status">Parsing file…</div>
          )}

          {step === 'importing' && (
            <div className="expenses-import-status">
              Importing {progress.current} of {progress.total}...
            </div>
          )}

          {step === 'done' && (
            <div className="expenses-import-status expenses-import-done">
              ✓ {doneCount} expenses imported
            </div>
          )}

          {step === 'unparsed' && (
            <div className="expenses-import-status" style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
              <p style={{ margin: 0, maxWidth: 520 }}>
                Could not parse this statement format. Try copying and pasting transactions manually or contact support.
              </p>
              {onManualEntry && (
                <button className="btn btn-primary" type="button" onClick={onManualEntry}>
                  Add Expense Manually
                </button>
              )}
            </div>
          )}

          {step === 'preview' && (
            <>
              {creditCount > 0 && (
                <div
                  className="expenses-review-banner"
                  style={{ background: 'rgba(59,130,246,0.16)', borderColor: 'rgba(59,130,246,0.35)', color: '#93C5FD' }}
                >
                  {creditCount} credit/refund row{creditCount === 1 ? '' : 's'} detected — these will import as negative expenses to offset the original charge.
                </div>
              )}
              {duplicateCount > 0 && (
                <div className="expenses-review-banner">
                  {duplicateCount} transaction{duplicateCount === 1 ? '' : 's'} may already be imported (unchecked). Review before importing.
                </div>
              )}
              <div className="expenses-import-table-wrap">
                <table className="quotes-table expenses-table expenses-import-table">
                  <thead>
                    <tr>
                      <th className="expenses-import-check">
                        <input
                          type="checkbox"
                          checked={rows.length > 0 && rows.every((r) => r.selected)}
                          onChange={(e) => toggleAll(e.target.checked)}
                          aria-label="Select all"
                        />
                      </th>
                      <th>Date</th>
                      <th>Vendor</th>
                      {isExcelKind && <th>Service</th>}
                      <th>Category</th>
                      {isExcelKind && <th>Project</th>}
                      <th>App</th>
                      <th className="expenses-amount-col">Amount</th>
                      {isExcelKind && <th>Notes</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={row.id}
                        className={[
                          row.selected ? 'expenses-import-row-checked' : '',
                          row.isDuplicate ? 'expenses-import-row-dup' : '',
                        ].filter(Boolean).join(' ')}
                      >
                        <td className="expenses-import-check">
                          <input
                            type="checkbox"
                            checked={row.selected}
                            onChange={(e) => patchRow(row.id, { selected: e.target.checked })}
                            aria-label={`Select ${row.vendor}`}
                          />
                        </td>
                        <td>{row.date}</td>
                        <td>
                          <div className="expenses-vendor">{row.vendor}</div>
                          {row.isDuplicate && (
                            <span className="expenses-review-badge">Already imported</span>
                          )}
                        </td>
                        {isExcelKind && <td>{row.service || '—'}</td>}
                        <td>
                          <select
                            className="form-select"
                            value={row.category}
                            onChange={(e) => patchRow(row.id, { category: e.target.value })}
                          >
                            {IMPORT_CATEGORIES.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        </td>
                        {isExcelKind && <td>{row.project || '—'}</td>}
                        <td>
                          <select
                            className="form-select"
                            value={row.appId}
                            onChange={(e) => patchRow(row.id, { appId: e.target.value })}
                          >
                            {IMPORT_APPS.map((a) => (
                              <option key={a} value={a}>{a}</option>
                            ))}
                          </select>
                        </td>
                        <td className="expenses-amount-col">{formatMoney(row.amount)}</td>
                        {isExcelKind && <td>{row.notes || '—'}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="expenses-import-totals">
                <span>{selected.length} selected of {rows.length}</span>
                <span>Total: <strong>{formatMoney(selectedTotal)}</strong></span>
              </div>
            </>
          )}

          {error && <div className="ft-error" style={{ marginTop: 12 }}>{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          {step === 'upload' && (
            <button className="btn btn-primary" onClick={parseFile} disabled={!file}>
              Parse Statement
            </button>
          )}
          {step === 'preview' && (
            <button className="btn btn-primary" onClick={importSelected} disabled={!selected.length}>
              Import Selected
            </button>
          )}
          {step === 'unparsed' && onManualEntry && (
            <button className="btn btn-primary" type="button" onClick={onManualEntry}>
              Add Expense Manually
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
