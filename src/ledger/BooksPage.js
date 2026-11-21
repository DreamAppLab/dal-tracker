// Books — bookkeeping for Dream App Lab LLC and Zerbiq (replaces Quicken).
// The company bar is always visible so it is obvious whose books are open.
import React, { useState } from 'react';
import * as core from './core';
import { LedgerProvider, useLedger } from './LedgerContext';
import Register from './Register';
import Reconcile from './Reconcile';
import Intercompany from './Intercompany';
import ImportPanel from './ImportPanel';
import Reports from './Reports';
import Setup from './Setup';
import { fmt } from './ui';
import useNewVersion from './useNewVersion';
import './books.css';

const TABS = [
  ['register', 'Register'],
  ['reconcile', 'Reconcile'],
  ['intercompany', 'Intercompany'],
  ['import', 'Import'],
  ['reports', 'Reports'],
  ['setup', 'Setup'],
];

function CompanyBar({ tab, setTab }) {
  const { companyId, setCompanyId, meta, balances, accounts, error } = useLedger();
  const checking = accounts.find((a) => a.kind === 'checking');
  const card = accounts.find((a) => a.kind === 'credit_card');
  return (
    <div className="bk-companybar" style={{ '--bk-co': meta.color, '--bk-co-tint': meta.tint }}>
      <div className="bk-companybar-top">
        <div className="bk-co-title">
          <span className="bk-co-dot" aria-hidden />
          <div>
            <div className="bk-co-kicker">You are in the books of</div>
            <h1 className="bk-co-name">{meta.legalName}</h1>
          </div>
        </div>
        <div className="bk-co-switch" role="radiogroup" aria-label="Company">
          {core.COMPANY_IDS.map((c) => {
            const m = core.COMPANY_META[c];
            return (
              <button key={c} type="button" role="radio" aria-checked={companyId === c}
                className={companyId === c ? 'active' : ''} style={{ '--sw': m.color, '--sw-tint': m.tint }}
                onClick={() => setCompanyId(c)}>
                {m.short}
              </button>
            );
          })}
        </div>
        <div className="bk-co-balances">
          {checking && <div><span>Checking</span><strong>{fmt(balances[checking.id] || 0)}</strong></div>}
          {card && <div><span>Card owed</span><strong>{fmt(-(balances[card.id] || 0))}</strong></div>}
        </div>
      </div>
      <nav className="bk-tabs" role="tablist" aria-label="Books sections">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </nav>
      {error && <div className="bk-error">Some Books data could not load: {error}</div>}
    </div>
  );
}

function BooksInner() {
  const ledger = useLedger();
  const stale = useNewVersion();
  const [tab, setTab] = useState(() => {
    try { return window.localStorage.getItem('mc.books.tab') || 'register'; } catch (_) { return 'register'; }
  });
  const [focusTxn, setFocusTxn] = useState(null);
  const go = (t) => {
    setTab(t);
    try { window.localStorage.setItem('mc.books.tab', t); } catch (_) { /* ignore */ }
  };
  // Open a transaction in its register. Legs open their main transaction;
  // entries paid by the other company stay in the intercompany register.
  const openTxn = (t) => {
    if (t.role === 'leg' && t.transferAccountId && ledger.accountsById[t.transferAccountId]) {
      setFocusTxn({ id: t.parentId, accountId: t.transferAccountId, date: t.date });
    } else {
      setFocusTxn({ id: t.id, accountId: t.accountId, date: t.date });
    }
    go('register');
  };
  return (
    <div className="page bk-page" key={ledger.companyId} style={{ '--bk-co': ledger.meta.color, '--bk-co-tint': ledger.meta.tint }}>
      {stale && (
        <div className="bk-notice bk-notice-warn bk-update" role="alert">
          <strong>Mission Control was updated.</strong> This tab is still running the previous version, which may book things differently. Reload before entering or changing anything.
          <button type="button" className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>Reload now</button>
        </div>
      )}
      <CompanyBar tab={tab} setTab={go} />
      <div className="bk-body">
        {tab === 'register' && <Register focusTxn={focusTxn} onFocusHandled={() => setFocusTxn(null)} />}
        {tab === 'reconcile' && <Reconcile />}
        {tab === 'intercompany' && <Intercompany onOpenTxn={openTxn} />}
        {tab === 'import' && <ImportPanel />}
        {tab === 'reports' && <Reports onOpenTxn={openTxn} />}
        {tab === 'setup' && <Setup />}
      </div>
    </div>
  );
}

export default function BooksPage() {
  return (
    <LedgerProvider>
      <BooksInner />
    </LedgerProvider>
  );
}
