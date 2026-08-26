import React, { useMemo, useState } from 'react';
import { collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { EXPENSE_APPS, EXPENSE_CATEGORIES, formatMoney } from '../data/expensesData';
import { parseStatementPdf } from '../utils/parseExpenseStatement';

export default function ImportStatementModal({ onClose, onImported, onManualEntry }) {
  const [step, setStep] = useState('upload');
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [doneCount, setDoneCount] = useState(0);

  const selected = useMemo(() => rows.filter((r) => r.selected), [rows]);
  const selectedTotal = selected.reduce((sum, r) => sum + Number(r.amount || 0), 0);

  const handleFile = (next) => {
    setError('');
    if (!next) {
      setFile(null);
      return;
    }
    const isPdf = next.type === 'application/pdf' || /\.pdf$/i.test(next.name);
    if (!isPdf) {
      setError('Please upload a PDF statement.');
      return;
    }
    setFile(next);
    setRows([]);
    setStep('upload');
  };

  const parseFile = async () => {
    if (!file) return;
    setError('');
    setStep('parsing');
    try {
      const parsed = await parseStatementPdf(file);
      if (!parsed.length) {
        setStep('unparsed');
        return;
      }
      setRows(parsed.map((row, i) => ({ ...row, id: `row-${i}` })));
      setStep('preview');
    } catch (err) {
      setError(err.message || 'Could not parse this PDF.');
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
            source: 'import',
            description: '',
            parsedByAI: false,
            needsReview: false,
            createdAt: serverTimestamp(),
          },
          { merge: true }
        );
        setProgress({ current: i + 1, total: selected.length });
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
          <div className="modal-title">Import Statement</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>✕</button>
        </div>

        <div className="modal-body">
          {step === 'upload' && (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Upload your credit card or bank statement PDF</label>
              <input
                className="form-input"
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => handleFile(e.target.files && e.target.files[0])}
              />
              {file && <div className="expenses-file-name">{file.name}</div>}
            </div>
          )}

          {step === 'parsing' && (
            <div className="expenses-import-status">Parsing statement…</div>
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
                      <th className="expenses-amount-col">Amount</th>
                      <th>Category</th>
                      <th>App</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className={row.selected ? 'expenses-import-row-checked' : ''}>
                        <td className="expenses-import-check">
                          <input
                            type="checkbox"
                            checked={row.selected}
                            onChange={(e) => patchRow(row.id, { selected: e.target.checked })}
                            aria-label={`Select ${row.vendor}`}
                          />
                        </td>
                        <td>{row.date}</td>
                        <td>{row.vendor}</td>
                        <td className="expenses-amount-col">{formatMoney(row.amount)}</td>
                        <td>
                          <select
                            className="form-select"
                            value={row.category}
                            onChange={(e) => patchRow(row.id, { category: e.target.value })}
                          >
                            {EXPENSE_CATEGORIES.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            className="form-select"
                            value={row.appId}
                            onChange={(e) => patchRow(row.id, { appId: e.target.value })}
                          >
                            {EXPENSE_APPS.map((a) => (
                              <option key={a} value={a}>{a}</option>
                            ))}
                          </select>
                        </td>
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
