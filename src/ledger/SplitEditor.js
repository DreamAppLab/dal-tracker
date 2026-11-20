// Split transaction editor (also used for Stripe payouts: gross revenue + fee).
import React, { useMemo, useState } from 'react';
import * as core from './core';
import { CategorySelect, fmt, lineFromPick, pickFromLine } from './ui';

// Stable line ids: existing lines keep their key (lines saved before ids
// existed use their index, matching their leg/mirror ids); new lines get a
// fresh random id, so editing other lines never recreates a transfer leg.
const newLineId = () => Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, '') || 'l1';

function centsToInput(c) {
  if (c == null || c === 0) return '';
  return core.centsToDecimalString(c);
}

export default function SplitEditor({ ledger, accountId, totalCents, lines, payee, onSave, onClose }) {
  // Lines are shown in the transaction's direction: a payment's lines are
  // positive payments, a deposit's lines positive deposits. A negative line is
  // the opposite direction (e.g. the Stripe fee inside a payout).
  const initialDir = totalCents < 0 ? -1 : 1;
  const [dir, setDir] = useState(initialDir);
  const [total, setTotal] = useState(centsToInput(Math.abs(totalCents || 0)));
  const [rows, setRows] = useState(() => {
    const src = lines && lines.length ? lines : [{ amountCents: totalCents || 0 }];
    return src.map((l, i) => ({ key: i, lineId: core.lineKey(l, i), pick: pickFromLine(l), amount: centsToInput((l.amountCents || 0) * initialDir), memo: l.memo || '' }));
  });
  const [gross, setGross] = useState('');
  const [fee, setFee] = useState('');
  const [error, setError] = useState('');

  const totalAbs = core.parseMoneyToCents(total) || 0;
  const parsed = rows.map((r) => core.parseMoneyToCents(r.amount) || 0);
  const sum = parsed.reduce((a, b) => a + b, 0);
  const remaining = totalAbs - sum;
  const stripeIncome = useMemo(() => ledger.categories.find((c) => c.kind === 'income' && /subscription/i.test(c.name)) || ledger.categories.find((c) => c.kind === 'income'), [ledger.categories]);
  const stripeFee = useMemo(() => ledger.categories.find((c) => c.slug === 'stripe_fees') || ledger.categories.find((c) => /stripe/i.test(c.name)), [ledger.categories]);

  const patch = (key, p) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const addRow = () => setRows((prev) => [...prev, { key: Date.now(), lineId: newLineId(), pick: '', amount: remaining > 0 ? centsToInput(remaining) : '', memo: '' }]);

  const applyStripe = () => {
    const g = core.parseMoneyToCents(gross);
    const f = core.parseMoneyToCents(fee) || 0;
    if (!g || g <= 0) { setError('Enter the gross amount Stripe charged customers.'); return; }
    setDir(1);
    setTotal(centsToInput(g - Math.abs(f)));
    setRows([
      { key: 1, lineId: newLineId(), pick: stripeIncome ? `cat:${stripeIncome.id}` : '', amount: centsToInput(g), memo: 'Gross revenue' },
      { key: 2, lineId: newLineId(), pick: stripeFee ? `cat:${stripeFee.id}` : '', amount: centsToInput(-Math.abs(f)), memo: 'Stripe fees' },
    ]);
    setError('');
  };

  const save = () => {
    if (!totalAbs) { setError('Enter the transaction total.'); return; }
    if (remaining !== 0) { setError(`Lines must add up to the total. ${fmt(remaining)} left to assign.`); return; }
    const out = rows.map((r, i) => ({ lineId: r.lineId, ...lineFromPick(r.pick, ledger.companyId), amountCents: parsed[i] * dir, memo: r.memo }));
    if (out.some((l) => l.amountCents === 0)) { setError('Remove lines with a zero amount.'); return; }
    onSave(out, totalAbs * dir);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal bk-modal bk-split-modal" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
        <div className="modal-header">
          <div className="modal-title">Split transaction{payee ? ` · ${payee}` : ''}</div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          <div className="bk-split-top">
            <div className="bk-seg" role="radiogroup" aria-label="Direction">
              <button type="button" className={dir < 0 ? 'active' : ''} onClick={() => setDir(-1)}>Payment / charge</button>
              <button type="button" className={dir > 0 ? 'active' : ''} onClick={() => setDir(1)}>Deposit / credit</button>
            </div>
            <label className="bk-field">
              <span>Total</span>
              <input className="bk-input bk-amt" value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" />
            </label>
          </div>

          <details className="bk-stripe">
            <summary>Stripe payout helper (gross − fees = payout)</summary>
            <div className="bk-stripe-row">
              <label className="bk-field"><span>Gross</span><input className="bk-input bk-amt" value={gross} onChange={(e) => setGross(e.target.value)} inputMode="decimal" placeholder="100.00" /></label>
              <label className="bk-field"><span>Stripe fees</span><input className="bk-input bk-amt" value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal" placeholder="3.20" /></label>
              <button type="button" className="btn btn-secondary btn-sm" onClick={applyStripe}>Fill lines</button>
            </div>
          </details>

          <table className="bk-table bk-split-table">
            <thead>
              <tr><th>Category / transfer</th><th>Memo</th><th className="num">Amount</th><th aria-label="Remove" /></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td><CategorySelect ledger={ledger} accountId={accountId} value={r.pick} allowSplit={false} onChange={(v) => patch(r.key, { pick: v })} /></td>
                  <td><input className="bk-input" value={r.memo} onChange={(e) => patch(r.key, { memo: e.target.value })} /></td>
                  <td className="num"><input className="bk-input bk-amt" value={r.amount} onChange={(e) => patch(r.key, { amount: e.target.value })} inputMode="decimal" /></td>
                  <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => setRows((p) => p.filter((x) => x.key !== r.key))} disabled={rows.length <= 1} aria-label="Remove line">✕</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td><button type="button" className="btn btn-secondary btn-sm" onClick={addRow}>+ Add line</button></td>
                <td className="bk-muted">Assigned {fmt(sum)}</td>
                <td className={`num ${remaining === 0 ? 'bk-ok' : 'bk-bad'}`}>{remaining === 0 ? 'Balanced' : `${fmt(remaining)} left`}</td>
                <td />
              </tr>
            </tfoot>
          </table>
          {error && <div className="bk-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={remaining !== 0}>Save split</button>
        </div>
      </div>
    </div>
  );
}
