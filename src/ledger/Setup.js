// Books setup for the selected company: accounts (opening balance + date,
// link to the Companies vault), categories, vendor rules, the one-time
// migration of the old Expenses data, and maintenance.
import React, { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import * as core from './core';
import { useLedger } from './LedgerContext';
import { apiPost, COL, createFixedAsset, db, deleteRule, disposeAsset, newId, saveDoc, seedCompany } from './ledgerStore';
import { Empty, fmt } from './ui';
import { recordAuditEvent } from '../lib/audit';

function useVault(companyId) {
  const [banks, setBanks] = useState([]);
  const [cards, setCards] = useState([]);
  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'companies', companyId, 'bankAccounts'), (s) => setBanks(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setBanks([]));
    const u2 = onSnapshot(collection(db, 'companies', companyId, 'creditCards'), (s) => setCards(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setCards([]));
    return () => { u1(); u2(); };
  }, [companyId]);
  return { banks, cards };
}

function last4Of(rec, field) {
  const m = rec && rec.masked && rec.masked[field];
  const d = String(m || '').replace(/\D/g, '');
  return d.slice(-4);
}

function AccountRow({ account, vault, ledger }) {
  const isCard = account.kind === 'credit_card';
  const [f, setF] = useState(() => ({
    name: account.name,
    last4: account.last4 || '',
    opening: core.centsToDecimalString(isCard ? -(account.openingBalanceCents || 0) : account.openingBalanceCents || 0),
    openingDate: account.openingDate,
    vaultId: (isCard ? account.vaultCreditCardId : account.vaultBankAccountId) || '',
  }));
  const [msg, setMsg] = useState('');
  const options = isCard ? vault.cards : vault.banks;
  const dirty = f.name !== account.name || f.last4 !== (account.last4 || '') || f.openingDate !== account.openingDate
    || core.parseMoneyToCents(f.opening) !== (isCard ? -(account.openingBalanceCents || 0) : account.openingBalanceCents || 0)
    || f.vaultId !== ((isCard ? account.vaultCreditCardId : account.vaultBankAccountId) || '');
  const save = async () => {
    const cents = core.parseMoneyToCents(f.opening);
    if (cents == null) { setMsg('Opening balance is not a valid amount.'); return; }
    if (!core.DATE_RE.test(f.openingDate)) { setMsg('Pick an opening date.'); return; }
    const activeMonths = ledger.monthly.filter((m) => m.acct && m.acct[account.id]).map((m) => m.month).sort();
    if (activeMonths.length && f.openingDate.slice(0, 7) > activeMonths[0]) {
      setMsg(`This account has transactions in ${activeMonths[0]}. The opening date must be on or before them.`);
      return;
    }
    try {
      const { id, updatedAt, createdAt, ...rest } = account;
      await saveDoc(COL.accounts, id, {
        ...rest,
        name: f.name.trim().slice(0, 80) || account.name,
        last4: f.last4.replace(/\D/g, '').slice(-4),
        openingBalanceCents: isCard ? -cents : cents,
        openingDate: f.openingDate,
        ...(isCard ? { vaultCreditCardId: f.vaultId || null } : { vaultBankAccountId: f.vaultId || null }),
      });
      const newCents = isCard ? -cents : cents;
      if (newCents !== (account.openingBalanceCents || 0) || f.openingDate !== account.openingDate) {
        recordAuditEvent('ledger_update', `ledgerAccounts/${id}`, {
          companyId: account.companyId, fromOpeningCents: account.openingBalanceCents || 0, toOpeningCents: newCents, fromDate: account.openingDate, toDate: f.openingDate,
        });
      }
      setMsg('Saved.');
    } catch (e) {
      setMsg(e.message);
    }
  };
  const pickVault = (id) => {
    const rec = options.find((o) => o.id === id);
    setF((p) => ({
      ...p,
      vaultId: id,
      last4: rec ? last4Of(rec, isCard ? 'cardNumber' : 'accountNumber') || p.last4 : p.last4,
      name: rec && p.name.startsWith('Business') ? rec.nickname || p.name : p.name,
    }));
  };
  return (
    <tr className="bk-row">
      <td><input className="bk-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Account name" /></td>
      <td>{isCard ? 'Credit card' : 'Checking'}</td>
      <td>
        <select className="bk-input" value={f.vaultId} onChange={(e) => pickVault(e.target.value)} aria-label="Vault record">
          <option value="">{options.length ? 'Not linked' : 'No vault records'}</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.nickname}{last4Of(o, isCard ? 'cardNumber' : 'accountNumber') ? ` ··${last4Of(o, isCard ? 'cardNumber' : 'accountNumber')}` : ''}</option>)}
        </select>
      </td>
      <td><input className="bk-input bk-last4" value={f.last4} onChange={(e) => setF({ ...f, last4: e.target.value })} maxLength={4} inputMode="numeric" aria-label="Last 4" /></td>
      <td className="num"><input className="bk-input bk-amt" value={f.opening} onChange={(e) => setF({ ...f, opening: e.target.value })} inputMode="decimal" aria-label={isCard ? 'Opening balance owed' : 'Opening balance'} /></td>
      <td><input className="bk-input bk-date" type="date" value={f.openingDate} onChange={(e) => setF({ ...f, openingDate: e.target.value })} aria-label="Opening date" /></td>
      <td className="num">{fmt(isCard ? -(ledger.balances[account.id] || 0) : ledger.balances[account.id] || 0)}</td>
      <td className="bk-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={!dirty}>Save</button>
        {msg && <span className="bk-muted bk-small">{msg}</span>}
      </td>
    </tr>
  );
}

function CategoryRow({ cat, inUse }) {
  const [name, setName] = useState(cat.name);
  const save = (patch) => saveDoc(COL.categories, cat.id, { companyId: cat.companyId, kind: cat.kind, name: cat.name, ...patch });
  return (
    <tr className={`bk-row ${cat.archived ? 'bk-row-dim' : ''}`}>
      <td><input className="bk-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== cat.name && save({ name: name.trim().slice(0, 80) })} aria-label="Category name" /></td>
      <td>{cat.kind === 'equity' ? 'Owner equity' : cat.kind === 'income' ? 'Income' : 'Expense'}</td>
      <td className="bk-muted">{inUse ? 'In use' : ''}</td>
      <td className="bk-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => save({ archived: !cat.archived })}>{cat.archived ? 'Restore' : 'Archive'}</button>
      </td>
    </tr>
  );
}

function FixedAssets({ ledger, run, busy }) {
  const { companyId, accounts, balances, categoriesById, accountsById } = ledger;
  const assets = accounts.filter((a) => a.kind === 'fixed_asset');
  const banks = accounts.filter((a) => a.kind === 'checking' || a.kind === 'credit_card');
  const booksStart = (accounts.find((a) => a.kind === 'checking') || {}).openingDate || '';
  const blank = { name: '', acquiredDate: '', inServiceDate: '', lifeYears: '5', salvage: '', cost: '', taken: '' };
  const [f, setF] = useState(blank);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(null); // { id, name, lifeYears, salvage }
  const [disposing, setDisposing] = useState(null); // { asset, date, proceeds, to }
  const saveEdit = () => {
    const a = accountsById[editing.id];
    const lifeMonths = Math.round(Number(editing.lifeYears) * 12);
    const salvage = editing.salvage ? core.parseMoneyToCents(editing.salvage) : 0;
    if (!editing.name.trim() || !lifeMonths || lifeMonths < 1 || lifeMonths > 600 || salvage == null || salvage < 0) { setErr('Check the name, life (1 month to 50 years) and salvage value.'); return; }
    const { id, updatedAt, createdAt, ...rest } = a;
    run(() => saveDoc(COL.accounts, id, { ...rest, name: editing.name.trim().slice(0, 80), lifeMonths, salvageCents: salvage }), () => { setEditing(null); return 'Asset updated. Future depreciation uses the new life and salvage value.'; });
  };
  const dispose = () => {
    const proceeds = disposing.proceeds ? core.parseMoneyToCents(disposing.proceeds) : 0;
    if (!core.DATE_RE.test(disposing.date)) { setErr('Enter the disposal date.'); return; }
    if (proceeds == null || proceeds < 0) { setErr('Proceeds must be zero or positive.'); return; }
    if (proceeds && !disposing.to) { setErr('Pick the account that received the money.'); return; }
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    run(() => disposeAsset(disposing.asset, { date: disposing.date, proceedsCents: proceeds, proceedsAccountId: disposing.to, today }, accountsById, categoriesById),
      (r) => { setDisposing(null); return `Disposed of ${disposing.asset.name}: book value ${fmt(r.bookValueCents)}, ${r.gainCents >= 0 ? 'gain' : 'loss'} ${fmt(Math.abs(r.gainCents))}. The asset is archived.`; });
  };
  const add = () => {
    setErr('');
    const lifeMonths = Math.round(Number(f.lifeYears) * 12);
    const salvage = f.salvage ? core.parseMoneyToCents(f.salvage) : 0;
    const cost = f.cost ? core.parseMoneyToCents(f.cost) : 0;
    const taken = f.taken ? core.parseMoneyToCents(f.taken) : 0;
    if (!f.name.trim()) { setErr('Name the asset.'); return; }
    if (!core.DATE_RE.test(f.acquiredDate)) { setErr('Enter the date you bought it.'); return; }
    const inService = f.inServiceDate || f.acquiredDate;
    if (!core.DATE_RE.test(inService) || inService < f.acquiredDate) { setErr('In-service date must be on or after the purchase date.'); return; }
    if (!lifeMonths || lifeMonths < 1 || lifeMonths > 600) { setErr('Useful life must be between 1 month and 50 years.'); return; }
    if (salvage == null || cost == null || taken == null || salvage < 0 || cost < 0 || taken < 0) { setErr('Amounts must be positive.'); return; }
    if (taken > cost) { setErr('Depreciation already taken cannot exceed the cost.'); return; }
    // Owned before the books started: it enters the books on their start date at book value.
    const openingDate = cost && booksStart && booksStart > f.acquiredDate ? booksStart : f.acquiredDate;
    run(() => createFixedAsset(companyId, { name: f.name.trim().slice(0, 80), acquiredDate: f.acquiredDate, openingDate, inServiceDate: inService, lifeMonths, salvageCents: salvage, openingCostCents: cost, openingAccumulatedCents: taken }, categoriesById),
      () => { setF(blank); return `Added fixed asset "${f.name.trim()}". ${cost ? '' : 'Record its purchase in the register as a transfer to it from checking or the card.'}`; });
  };
  return (
    <>
      <h3 className="bk-h3">Fixed assets</h3>
      <div className="bk-panel">
        <div className="bk-muted bk-small bk-mb">
          Equipment you keep for more than a year (computers, cameras, furniture) is capitalized, not expensed: record the purchase in the register as
          <strong> Transfer · [asset]</strong> from checking or the card. Books then posts straight-line depreciation each month (Reports → Fixed assets).
        </div>
        <div className="bk-form-grid bk-fa-grid">
          <label className="bk-field"><span>Asset name</span><input className="bk-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="MacBook Pro 16" /></label>
          <label className="bk-field"><span>Purchase date</span><input className="bk-input bk-date" type="date" value={f.acquiredDate} onChange={(e) => setF({ ...f, acquiredDate: e.target.value })} /></label>
          <label className="bk-field"><span>In service from</span><input className="bk-input bk-date" type="date" value={f.inServiceDate} onChange={(e) => setF({ ...f, inServiceDate: e.target.value })} /></label>
          <label className="bk-field"><span>Useful life (years)</span><input className="bk-input bk-amt" value={f.lifeYears} onChange={(e) => setF({ ...f, lifeYears: e.target.value })} inputMode="decimal" /></label>
          <label className="bk-field"><span>Salvage value</span><input className="bk-input bk-amt" value={f.salvage} onChange={(e) => setF({ ...f, salvage: e.target.value })} inputMode="decimal" placeholder="0.00" /></label>
          <label className="bk-field"><span>Cost if bought before these books</span><input className="bk-input bk-amt" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} inputMode="decimal" placeholder="0.00" /></label>
          {f.cost && <label className="bk-field"><span>Depreciation already taken (before {booksStart || 'the books'})</span><input className="bk-input bk-amt" value={f.taken} onChange={(e) => setF({ ...f, taken: e.target.value })} inputMode="decimal" placeholder="0.00" /></label>}
        </div>
        {err && <div className="bk-error">{err}</div>}
        <div className="bk-row-actions"><button type="button" className="btn btn-primary btn-sm" onClick={add} disabled={busy}>Add fixed asset</button></div>
      </div>
      {assets.length > 0 && (
        <div className="bk-table-wrap bk-mt">
          <table className="bk-table">
            <thead><tr><th>Asset</th><th>On books from</th><th>In service</th><th className="num">Life</th><th className="num">Salvage</th><th className="num">Book value</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {assets.map((a) => (editing && editing.id === a.id ? (
                <tr key={a.id} className="bk-edit-row">
                  <td><input className="bk-input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} aria-label="Asset name" /></td>
                  <td>{a.openingDate}</td>
                  <td>{a.inServiceDate || a.openingDate}</td>
                  <td className="num"><input className="bk-input bk-amt" value={editing.lifeYears} onChange={(e) => setEditing({ ...editing, lifeYears: e.target.value })} aria-label="Life in years" /></td>
                  <td className="num"><input className="bk-input bk-amt" value={editing.salvage} onChange={(e) => setEditing({ ...editing, salvage: e.target.value })} aria-label="Salvage" /></td>
                  <td className="num">{fmt(balances[a.id] || 0)}</td>
                  <td className="bk-actions"><button type="button" className="btn btn-primary btn-sm" onClick={saveEdit} disabled={busy}>Save</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>✕</button></td>
                </tr>
              ) : (
                <tr key={a.id} className="bk-row">
                  <td>{a.name}</td>
                  <td>{a.openingDate}</td>
                  <td>{a.inServiceDate || a.openingDate}</td>
                  <td className="num">{a.lifeMonths % 12 === 0 ? `${a.lifeMonths / 12} yr` : `${a.lifeMonths} mo`}</td>
                  <td className="num">{fmt(a.salvageCents || 0)}</td>
                  <td className="num">{fmt(balances[a.id] || 0)}</td>
                  <td className="bk-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing({ id: a.id, name: a.name, lifeYears: String(a.lifeMonths / 12), salvage: core.centsToDecimalString(a.salvageCents || 0) })}>Edit</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDisposing({ asset: a, date: '', proceeds: '', to: (banks.find((b) => b.kind === 'checking') || {}).id || '' })}>Sell / dispose</button>
                  </td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      )}
      {disposing && (
        <div className="bk-panel bk-mt">
          <div className="bk-kicker">Sell or dispose of {disposing.asset.name}</div>
          <div className="bk-muted bk-small bk-mb">Depreciation is posted through the disposal date first. The remaining book value is removed, the proceeds go to the account you pick, and the difference is booked as a gain or loss. The asset is then archived.</div>
          <div className="bk-form-grid bk-fa-grid">
            <label className="bk-field"><span>Disposal date</span><input className="bk-input bk-date" type="date" value={disposing.date} onChange={(e) => setDisposing({ ...disposing, date: e.target.value })} /></label>
            <label className="bk-field"><span>Sale proceeds (0 if scrapped)</span><input className="bk-input bk-amt" value={disposing.proceeds} onChange={(e) => setDisposing({ ...disposing, proceeds: e.target.value })} inputMode="decimal" placeholder="0.00" /></label>
            <label className="bk-field"><span>Money received in</span>
              <select className="bk-input" value={disposing.to} onChange={(e) => setDisposing({ ...disposing, to: e.target.value })}>{banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            </label>
          </div>
          <div className="bk-row-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDisposing(null)}>Cancel</button>
            <button type="button" className="btn btn-danger btn-sm" onClick={dispose} disabled={busy}>Record disposal</button>
          </div>
        </div>
      )}
    </>
  );
}

export default function Setup() {
  const ledger = useLedger();
  const { companyId, meta, accounts, categories, rules, raw, monthly } = ledger;
  const vault = useVault(companyId);
  const [newCat, setNewCat] = useState({ name: '', kind: 'expense' });
  const [newRule, setNewRule] = useState({ pattern: '', categoryId: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [migration, setMigration] = useState(null);
  const [confirmRollback, setConfirmRollback] = useState(false);

  const usedCats = new Set(monthly.flatMap((m) => Object.entries(m.cat || {}).filter(([, v]) => v !== 0).map(([k]) => k)));
  const missingDefaults = !accounts.some((a) => a.kind === 'checking') || !accounts.some((a) => a.kind === 'credit_card') || !accounts.some((a) => a.kind === 'intercompany') || !categories.length;

  const run = async (fn, done) => {
    setBusy(true);
    setMsg('');
    try {
      const r = await fn();
      if (done) setMsg(done(r));
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  const seed = () => run(() => seedCompany(companyId, { accounts: raw.accountsMine, categories: raw.categoriesMine, rules: raw.rules }, { openingDate: `${new Date().getFullYear()}-01-01` }), (n) => `Created ${n} default records for ${meta.legalName}.`);
  const addCategory = () => {
    const name = newCat.name.trim();
    if (!name) return;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'custom';
    const id = core.ids.category(companyId, `${slug}_${Date.now().toString(36).slice(-4)}`);
    run(() => saveDoc(COL.categories, id, { companyId, name: name.slice(0, 80), kind: newCat.kind, slug, sort: 500, archived: false, isDefault: false }, false), () => { setNewCat({ name: '', kind: newCat.kind }); return `Added “${name}”.`; });
  };
  const addRule = () => {
    const pattern = newRule.pattern.trim().toUpperCase();
    if (!pattern || !newRule.categoryId) return;
    run(() => saveDoc(COL.vendorRules, newId(companyId, 'rule'), { companyId, pattern: pattern.slice(0, 100), categoryId: newRule.categoryId, isDefault: false }, false), () => { setNewRule({ pattern: '', categoryId: newRule.categoryId }); return `Rule added: payees containing “${pattern}”.`; });
  };
  const migrate = (mode) => run(() => apiPost('/api/ledger/migrate', { mode }), (r) => { setMigration(r.summary); return mode === 'dry-run' ? 'Dry run finished (nothing written).' : mode === 'apply' ? (r.summary.verified ? 'Migration complete and verified.' : 'Migration finished but totals did not verify — see details.') : 'Rollback complete.'; });
  const card = accounts.find((a) => a.id === 'dal_card');
  const savedHistAs = (card && card.historicalPaymentsAs) || 'owner';
  const [histAs, setHistAs] = useState(savedHistAs);
  useEffect(() => { setHistAs(savedHistAs); }, [savedHistAs]);
  const settle = () => run(() => apiPost('/api/ledger/migrate', { mode: 'settle', as: histAs }), (r) => {
    setMigration(r.summary);
    const st = r.summary.settled || {};
    const problems = (st.errors || []).length;
    return `Migrated card charges marked as paid before Books: ${st.months || 0} monthly entries totalling ${fmt(st.totalCents || 0)}, booked as ${histAs === 'owner' ? 'owner contributions' : 'opening balance equity'}. ${problems ? `${problems} month(s) could not be updated (reconciled) — see details below.` : "The card's migrated history now owes $0.00."}`;
  });
  const rebuild = () => run(() => apiPost('/api/ledger/rebuild', { companyId }), (r) => `Rebuilt ${r.result.months} months from ${r.result.transactions} transactions.`);

  if (!ledger.ready) return <Empty>Loading…</Empty>;
  const bankish = accounts.filter((a) => a.kind === 'checking' || a.kind === 'credit_card');
  const catName = (id) => (ledger.categoriesById[id] || {}).name || 'Unknown';

  return (
    <div className="bk-setup">
      {msg && <div className="bk-notice">{msg}</div>}
      {missingDefaults && (
        <div className="bk-panel bk-setup-seed">
          <div>
            <div className="bk-kicker">Set up {meta.legalName}</div>
            <div>Creates the business checking account, the business credit card, the intercompany account and the default categories and vendor rules. Nothing existing is overwritten.</div>
          </div>
          <button type="button" className="btn btn-primary" onClick={seed} disabled={busy}>Create default books</button>
        </div>
      )}

      <h3 className="bk-h3">Accounts</h3>
      <div className="bk-table-wrap">
        <table className="bk-table bk-accounts-table">
          <thead><tr><th>Name</th><th>Type</th><th>Companies vault record</th><th>Last 4</th><th className="num">Opening balance</th><th>Opening date</th><th className="num">Current</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {!bankish.length && <tr><td colSpan={8}><Empty>No accounts yet.</Empty></td></tr>}
            {bankish.map((a) => <AccountRow key={`${a.id}-${a.updatedAt ? a.updatedAt.seconds : ''}`} account={a} vault={vault} ledger={ledger} />)}
          </tbody>
        </table>
      </div>
      <div className="bk-muted bk-small">Credit card balances are entered as the amount owed. Linking a vault record copies its nickname and last 4 so both modules show the same account; full numbers stay encrypted in the vault.</div>

      <FixedAssets ledger={ledger} run={run} busy={busy} />

      <div className="bk-two-col">
        <div>
          <h3 className="bk-h3">Categories</h3>
          <div className="bk-inline-form">
            <input className="bk-input" placeholder="New category name" value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addCategory()} />
            <select className="bk-input bk-kind" value={newCat.kind} onChange={(e) => setNewCat({ ...newCat, kind: e.target.value })}>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
              <option value="equity">Owner equity</option>
            </select>
            <button type="button" className="btn btn-primary btn-sm" onClick={addCategory} disabled={busy || !newCat.name.trim()}>Add</button>
          </div>
          <div className="bk-table-wrap bk-scroll-y">
            <table className="bk-table">
              <thead><tr><th>Name</th><th>Type</th><th /><th aria-label="Actions" /></tr></thead>
              <tbody>{categories.map((c) => <CategoryRow key={c.id} cat={c} inUse={usedCats.has(c.id)} />)}</tbody>
            </table>
          </div>
        </div>
        <div>
          <h3 className="bk-h3">Vendor rules</h3>
          <div className="bk-inline-form">
            <input className="bk-input" placeholder="Payee contains… (e.g. SUPABASE)" value={newRule.pattern} onChange={(e) => setNewRule({ ...newRule, pattern: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addRule()} />
            <select className="bk-input" value={newRule.categoryId} onChange={(e) => setNewRule({ ...newRule, categoryId: e.target.value })} aria-label="Rule category">
              <option value="">Category…</option>
              {categories.filter((c) => !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button type="button" className="btn btn-primary btn-sm" onClick={addRule} disabled={busy || !newRule.pattern.trim() || !newRule.categoryId}>Add</button>
          </div>
          <div className="bk-table-wrap bk-scroll-y">
            <table className="bk-table">
              <thead><tr><th>Payee contains</th><th>Category</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {!rules.length && <tr><td colSpan={3}><Empty>No rules yet.</Empty></td></tr>}
                {[...rules].sort((a, b) => a.pattern.localeCompare(b.pattern)).map((r) => (
                  <tr key={r.id} className="bk-row">
                    <td className="bk-mono">{r.pattern}</td>
                    <td>
                      <select className="bk-input" value={r.categoryId} onChange={(e) => saveDoc(COL.vendorRules, r.id, { companyId, pattern: r.pattern, categoryId: e.target.value })} aria-label="Rule category">
                        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        {!ledger.categoriesById[r.categoryId] && <option value={r.categoryId}>{catName(r.categoryId)}</option>}
                      </select>
                    </td>
                    <td className="bk-actions"><button type="button" className="btn btn-ghost btn-sm bk-del" onClick={() => run(() => deleteRule(r), () => 'Rule deleted.')}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bk-muted bk-small">Rules fill the category when you type a payee or import a statement. The longest matching text wins.</div>
        </div>
      </div>

      <h3 className="bk-h3">Maintenance</h3>
      <div className="bk-panel bk-maint">
        {companyId === 'dal' && (
          <div className="bk-maint-row">
            <div>
              <strong>Old Expenses data</strong>
              <div className="bk-muted bk-small">Moves every record from the retired Expenses tab into the DAL credit card register. Backs up first, safe to re-run (already-moved rows are skipped), and can be rolled back. The old records are kept read-only.</div>
            </div>
            <div className="bk-row-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => migrate('dry-run')} disabled={busy}>Dry run</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => migrate('apply')} disabled={busy}>Migrate</button>
              {confirmRollback
                ? <button type="button" className="btn btn-danger btn-sm" onClick={() => { setConfirmRollback(false); migrate('rollback'); }} disabled={busy}>Confirm roll back</button>
                : <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmRollback(true)} disabled={busy} title="Removes migrated rows from the ledger; the original Expenses records are untouched">Roll back</button>}
            </div>
          </div>
        )}
        {companyId === 'dal' && (
          <div className="bk-maint-row">
            <div>
              <strong>Migrated card charges were paid before Books</strong>
              <div className="bk-muted bk-small">
                The old Expenses were paid long ago, outside these books. This adds one "Card payments before Books" entry per month on the card
                (dated that month's last migrated charge) so the card owes $0.00 for that history. Expenses and P&L stay exactly the same and checking is
                not touched. They are booked as <em>Owner contributions</em> (you paid the old card bills personally; default — they appear in the
                owner contributions report), or switch to <em>Opening balance equity</em> if they were paid from accounts these books don't track.
                Migrate runs this automatically and keeps your choice; you can switch any time.
              </div>
            </div>
            <div className="bk-row-actions">
              <select className="bk-input bk-kind" value={histAs} onChange={(e) => setHistAs(e.target.value)} aria-label="Book historical card payments as">
                <option value="owner">Owner contributions</option>
                <option value="equity">Opening balance equity</option>
              </select>
              <button type="button" className="btn btn-primary btn-sm" onClick={settle} disabled={busy}>Mark as paid</button>
            </div>
          </div>
        )}
        {migration && (
          <pre className="bk-pre">{JSON.stringify({ ...migration, errors: (migration.errors || []).slice(0, 20) }, null, 2)}</pre>
        )}
        <div className="bk-maint-row">
          <div>
            <strong>Rebuild totals</strong>
            <div className="bk-muted bk-small">Recomputes {meta.legalName}'s cached monthly totals (balances and reports) from its transactions. Use if the intercompany balances ever disagree.</div>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={rebuild} disabled={busy}>Rebuild totals</button>
        </div>
      </div>
    </div>
  );
}
