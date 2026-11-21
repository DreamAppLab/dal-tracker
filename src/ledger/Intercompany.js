// Intercompany: what DAL and Zerbiq owe each other, open items (FIFO),
// settlement history, and recording a (partial) reimbursement.
import React, { useEffect, useMemo, useState } from 'react';
import * as core from './core';
import { useLedger } from './LedgerContext';
import { getTxn, recordSettlement as saveSettlement, setDeleted, settleThroughOwners, watchAccountWindow } from './ledgerStore';
import { CompanyBadge, Empty, fmt, fmtDate, todayISO } from './ui';

export default function Intercompany({ onOpenTxn }) {
  const ledger = useLedger();
  const { companyId, otherId, meta, otherMeta, accounts, otherAccounts, accountsById, categoriesById, balances, otherBalances } = ledger;
  const icId = core.ids.intercompany(companyId);
  const otherIcId = core.ids.intercompany(otherId);
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const balance = balances[icId] || 0;
  const otherBalance = otherBalances[otherIcId] || 0;
  const agree = core.balancesAgree(balance, otherBalance);

  useEffect(() => {
    if (!accountsById[icId]) return undefined;
    setEntries(null);
    return watchAccountWindow(companyId, icId, '1900-01-01', (r) => setEntries(r), (e) => setError(e.message));
  }, [companyId, icId, accountsById]);

  const result = useMemo(() => core.openItems(entries || []), [entries]);
  const settlements = useMemo(() => (entries || []).filter((e) => e.settlementId && !e.deleted).sort((a, b) => b.date.localeCompare(a.date)), [entries]);
  const charges = useMemo(() => (entries || []).filter((e) => !e.settlementId && !e.deleted).sort((a, b) => b.date.localeCompare(a.date)), [entries]);

  // Who pays whom by default: whoever owes.
  const defaultPayer = balance > 0 ? otherId : companyId;
  const [form, setForm] = useState({ payer: '', amount: '', date: todayISO(), from: '', to: '', memo: '' });
  const payer = form.payer || defaultPayer;
  const receiver = core.otherCompany(payer);
  const payerAccounts = (payer === companyId ? accounts : otherAccounts).filter((a) => a.kind === 'checking' || a.kind === 'credit_card');
  const receiverAccounts = (receiver === companyId ? accounts : otherAccounts).filter((a) => a.kind === 'checking' || a.kind === 'credit_card');
  const fromId = form.from && payerAccounts.some((a) => a.id === form.from) ? form.from : (payerAccounts.find((a) => a.kind === 'checking') || payerAccounts[0] || {}).id;
  const toId = form.to && receiverAccounts.some((a) => a.id === form.to) ? form.to : (receiverAccounts.find((a) => a.kind === 'checking') || receiverAccounts[0] || {}).id;

  const recordSettlement = async () => {
    setError('');
    setNotice('');
    const amountCents = core.parseMoneyToCents(form.amount);
    if (!amountCents || amountCents <= 0) { setError('Enter the amount paid.'); return; }
    if (!fromId || !toId) { setError('Both companies need a bank account. Open Setup.'); return; }
    setBusy(true);
    try {
      const base = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const sid = `set_${base}`;
      const { payerTxnId, receiverTxnId } = core.settlementTxnIds(base, payer);
      const drafts = core.settlementDrafts({
        settlementId: sid, payer, payerTxnId, receiverTxnId, payerAccountId: fromId, receiverAccountId: toId,
        amountCents, date: form.date, memo: form.memo,
        payerPayee: `Reimbursement to ${core.COMPANY_META[receiver].legalName}`,
        receiverPayee: `Reimbursement from ${core.COMPANY_META[payer].legalName}`,
      });
      await saveSettlement(drafts, accountsById, categoriesById);
      setNotice(`Recorded: ${core.COMPANY_META[payer].short} paid ${core.COMPANY_META[receiver].short} ${fmt(amountCents)} on ${fmtDate(form.date)} (both books updated).`);
      setForm((f) => ({ ...f, amount: '', memo: '' }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Non-cash: the owners funded it personally and nobody will be repaid.
  const settleOwners = async () => {
    setError('');
    setNotice('');
    const amountCents = core.parseMoneyToCents(form.amount);
    if (!amountCents || amountCents <= 0) { setError('Enter the amount to settle.'); return; }
    setBusy(true);
    try {
      const key = `manual_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      await settleThroughOwners(receiver, [{ key, amountCents, date: form.date, memo: form.memo || 'Settled through the owners: no repayment' }], accountsById, categoriesById);
      setNotice(`Settled through the owners: ${core.COMPANY_META[payer].short} records ${fmt(amountCents)} as an owner contribution and ${core.COMPANY_META[receiver].short}'s owner money goes down by the same amount (both “Paid personally” accounts). No bank account moves; neither P&L changes.`);
      setForm((f) => ({ ...f, amount: '', memo: '' }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteSettlement = async (leg) => {
    setBusy(true);
    setError('');
    try {
      const mainHere = await getTxn(leg.parentId);
      if (!mainHere) throw new Error('Settlement not found.');
      // Deletes both companies' halves in one transaction.
      await setDeleted({ txn: mainHere, deleted: true, accounts: accountsById, categories: categoriesById });
      setNotice('Settlement deleted from both companies. It can be restored from Register → Recently deleted.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!ledger.ready) return <Empty>Loading…</Empty>;
  if (!accountsById[icId]) return <Empty>The intercompany account is missing. Open Setup to create the default accounts.</Empty>;

  const owesText = balance === 0
    ? 'All settled — nobody owes anything.'
    : balance > 0
      ? `${otherMeta.legalName} owes ${meta.legalName} ${fmt(balance)}`
      : `${meta.legalName} owes ${otherMeta.legalName} ${fmt(-balance)}`;

  return (
    <div className="bk-ic">
      <div className="bk-ic-cards">
        <div className="bk-panel bk-ic-balance">
          <div className="bk-kicker">Net intercompany balance</div>
          <div className={`bk-big ${balance === 0 ? '' : balance > 0 ? 'bk-pos' : 'bk-neg'}`}>{fmt(Math.abs(balance))}</div>
          <div>{owesText}</div>
          <div className={`bk-agree ${agree ? 'bk-ok' : 'bk-bad'}`}>
            {agree ? `✓ Matches ${otherMeta.short}'s books (${fmt(otherBalance)})` : `⚠ ${otherMeta.short}'s books show ${fmt(otherBalance)} — expected ${fmt(-balance)}. Run Setup → Rebuild totals for both companies.`}
          </div>
        </div>
        <div className="bk-panel bk-ic-totals">
          <div className="bk-sum-row"><span><CompanyBadge meta={meta} /> paid for <CompanyBadge meta={otherMeta} /></span><span className="num">{fmt(result.totals.paidForThem)}</span></div>
          <div className="bk-sum-row"><span><CompanyBadge meta={otherMeta} /> paid for <CompanyBadge meta={meta} /></span><span className="num">{fmt(result.totals.paidForUs)}</span></div>
          <div className="bk-sum-row"><span>Reimbursed to {meta.short}</span><span className="num">{fmt(result.totals.settledIn)}</span></div>
          <div className="bk-sum-row"><span>Reimbursed to {otherMeta.short}</span><span className="num">{fmt(result.totals.settledOut)}</span></div>
        </div>
        <div className="bk-panel bk-ic-form">
          <div className="bk-kicker">Record a reimbursement</div>
          <div className="bk-seg" role="radiogroup" aria-label="Who paid">
            {[companyId, otherId].map((c) => (
              <button key={c} type="button" className={payer === c ? 'active' : ''} onClick={() => setForm({ ...form, payer: c, from: '', to: '' })}>
                {core.COMPANY_META[c].short} paid {core.COMPANY_META[core.otherCompany(c)].short}
              </button>
            ))}
          </div>
          <div className="bk-form-grid">
            <label className="bk-field"><span>Amount</span><input className="bk-input bk-amt" value={form.amount} placeholder={balance ? core.centsToDecimalString(Math.abs(balance)) : '0.00'} onChange={(e) => setForm({ ...form, amount: e.target.value })} inputMode="decimal" /></label>
            <label className="bk-field"><span>Date</span><input className="bk-input bk-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
            <label className="bk-field"><span>From ({core.COMPANY_META[payer].short})</span>
              <select className="bk-input" value={fromId || ''} onChange={(e) => setForm({ ...form, from: e.target.value })}>{payerAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            </label>
            <label className="bk-field"><span>To ({core.COMPANY_META[receiver].short})</span>
              <select className="bk-input" value={toId || ''} onChange={(e) => setForm({ ...form, to: e.target.value })}>{receiverAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            </label>
            <label className="bk-field bk-span2"><span>Memo</span><input className="bk-input" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} placeholder="Optional" /></label>
          </div>
          <div className="bk-row-actions">
            {balance !== 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm({ ...form, payer: defaultPayer, amount: core.centsToDecimalString(Math.abs(balance)) })}>Settle full balance</button>}
            <button type="button" className="btn btn-primary btn-sm" onClick={recordSettlement} disabled={busy}>Record payment</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={settleOwners} disabled={busy} title="Nobody pays anybody back: the owners funded it personally">Settle through owners (no repayment)</button>
          </div>
          <div className="bk-muted bk-small">Partial payments are fine. <strong>Record payment</strong>: both companies' bank registers get the payment. <strong>Settle through owners</strong>: no money moves — the owners paid personally and won't be repaid, so {core.COMPANY_META[payer].short} records it as an owner contribution and {core.COMPANY_META[receiver].short}'s owner money goes down by the same amount. Neither P&L changes.</div>
        </div>
      </div>

      {error && <div className="bk-error" role="alert">{error}</div>}
      {notice && <div className="bk-notice">{notice}</div>}

      <h3 className="bk-h3">Open items</h3>
      <div className="bk-table-wrap">
        <table className="bk-table">
          <thead><tr><th>Date</th><th>Payee</th><th>Booked</th><th className="num">Original</th><th className="num">Still open</th><th aria-label="Open" /></tr></thead>
          <tbody>
            {entries === null && <tr><td colSpan={6}><Empty>Loading…</Empty></td></tr>}
            {entries !== null && !result.open.length && <tr><td colSpan={6}><Empty>No open items.</Empty></td></tr>}
            {result.open.map((e) => (
              <tr key={e.id} className="bk-row">
                <td>{fmtDate(e.date)}</td>
                <td className="bk-payee">{e.payee}</td>
                <td>{e.kind === 'settlement' ? 'Overpayment' : e.kind === 'charge_paid' ? `${meta.short} paid for ${otherMeta.short}` : `${otherMeta.short} paid for ${meta.short}${e.categoryId && categoriesById[e.categoryId] ? ` · ${categoriesById[e.categoryId].name}` : ''}`}</td>
                <td className="num">{fmt(Math.abs(e.amountCents))}</td>
                <td className={`num ${e.remainingCents > 0 ? 'bk-pos' : 'bk-neg'}`}>{fmt(Math.abs(e.remainingCents))} {e.remainingCents > 0 ? `due from ${otherMeta.short}` : `due to ${otherMeta.short}`}</td>
                <td className="bk-actions">{onOpenTxn && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpenTxn(e)}>Open</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bk-two-col">
        <div>
          <h3 className="bk-h3">Settlement history</h3>
          <div className="bk-table-wrap">
            <table className="bk-table">
              <thead><tr><th>Date</th><th>Direction</th><th className="num">Amount</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {!settlements.length && <tr><td colSpan={4}><Empty>No reimbursements yet.</Empty></td></tr>}
                {settlements.map((s) => (
                  <tr key={s.id} className="bk-row">
                    <td>{fmtDate(s.date)}</td>
                    <td>{s.amountCents < 0 ? `${otherMeta.short} → ${meta.short}` : `${meta.short} → ${otherMeta.short}`}</td>
                    <td className="num">{fmt(Math.abs(s.amountCents))}</td>
                    <td className="bk-actions">{s.status !== 'reconciled' && <button type="button" className="btn btn-ghost btn-sm bk-del" onClick={() => deleteSettlement(s)} disabled={busy}>Delete</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h3 className="bk-h3">Charges between companies</h3>
          <div className="bk-table-wrap">
            <table className="bk-table">
              <thead><tr><th>Date</th><th>Payee</th><th>Who paid</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {!charges.length && <tr><td colSpan={4}><Empty>None yet. In the register, book a line to “Paid for {otherMeta.short}”.</Empty></td></tr>}
                {charges.map((c) => (
                  <tr key={c.id} className="bk-row" onDoubleClick={() => onOpenTxn && onOpenTxn(c)}>
                    <td>{fmtDate(c.date)}</td>
                    <td className="bk-payee">{c.payee}</td>
                    <td>{c.amountCents > 0 ? `${meta.short} for ${otherMeta.short}` : `${otherMeta.short} for ${meta.short}`}</td>
                    <td className="num">{fmt(Math.abs(c.amountCents))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
