// Books state: the selected company (persisted per user) and the small
// reference data every screen needs (accounts, categories, rules, monthly
// aggregates, reconciliations). Everything is company-scoped.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import * as core from './core';
import { COL, prefsGet, prefsSet, watchCompany } from './ledgerStore';

const LedgerContext = createContext(null);
const LS_KEY = 'mc.books.company';

function readLocal() {
  try {
    const v = window.localStorage.getItem(LS_KEY);
    return core.COMPANY_IDS.includes(v) ? v : null;
  } catch (_) {
    return null;
  }
}

function useCompanyCollection(col, companyId, setError) {
  const [state, setState] = useState({ companyId: null, rows: [] });
  useEffect(() => {
    if (!companyId) return undefined;
    return watchCompany(col, companyId, (rows) => setState({ companyId, rows }), (e) => setError(`${col}: ${e.message}`));
  }, [col, companyId, setError]);
  // Never show the previous company's rows while the new ones load.
  return state.companyId === companyId ? state.rows : null;
}

export function LedgerProvider({ children }) {
  const { user } = useAuth();
  const [companyId, setCompanyIdState] = useState(() => readLocal() || 'dal');
  const [error, setErrorState] = useState('');
  const setError = useCallback((e) => setErrorState(e), []);

  // Per-user preference (Firestore), with localStorage for instant first paint.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    prefsGet(user.uid).then((p) => {
      if (!cancelled && p && core.COMPANY_IDS.includes(p.companyId)) setCompanyIdState(p.companyId);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [user]);

  const setCompanyId = useCallback((next) => {
    if (!core.COMPANY_IDS.includes(next)) return;
    setCompanyIdState(next);
    try { window.localStorage.setItem(LS_KEY, next); } catch (_) { /* private mode */ }
    if (user) prefsSet(user.uid, { companyId: next }).catch(() => {});
  }, [user]);

  const other = core.otherCompany(companyId);
  const accountsMine = useCompanyCollection(COL.accounts, companyId, setError);
  const accountsOther = useCompanyCollection(COL.accounts, other, setError);
  const categoriesMine = useCompanyCollection(COL.categories, companyId, setError);
  const categoriesOther = useCompanyCollection(COL.categories, other, setError);
  const rules = useCompanyCollection(COL.vendorRules, companyId, setError);
  const projectsRaw = useCompanyCollection(COL.projects, companyId, setError);
  const monthly = useCompanyCollection(COL.monthly, companyId, setError);
  const monthlyOther = useCompanyCollection(COL.monthly, other, setError);
  const reconciliations = useCompanyCollection(COL.reconciliations, companyId, setError);

  const value = useMemo(() => {
    const ready = [accountsMine, accountsOther, categoriesMine, categoriesOther, rules, monthly, monthlyOther, reconciliations, projectsRaw].every(Boolean);
    const allProjects = [...(projectsRaw || [])].sort((a, b) => a.name.localeCompare(b.name));
    const projectsById = Object.fromEntries(allProjects.map((p) => [p.id, p]));
    const accountsById = {};
    const categoriesById = {};
    [...(accountsMine || []), ...(accountsOther || [])].forEach((a) => { accountsById[a.id] = a; });
    [...(categoriesMine || []), ...(categoriesOther || [])].forEach((c) => { categoriesById[c.id] = c; });
    const sortAccounts = (list) => [...(list || [])].filter((a) => !a.archived).sort((a, b) => (a.sort || 9) - (b.sort || 9) || a.name.localeCompare(b.name));
    const accounts = sortAccounts(accountsMine);
    // Closed (archived) bank/card accounts keep their history; shown on request.
    const closedAccounts = [...(accountsMine || [])].filter((a) => a.archived && a.kind !== 'fixed_asset').sort((a, b) => a.name.localeCompare(b.name));
    const balances = {};
    [...accounts, ...closedAccounts].forEach((a) => { balances[a.id] = core.accountBalance(a, a.id, monthly || []); });
    const otherBalances = {};
    sortAccounts(accountsOther).forEach((a) => { otherBalances[a.id] = core.accountBalance(a, a.id, monthlyOther || []); });
    return {
      companyId,
      setCompanyId,
      meta: core.COMPANY_META[companyId],
      otherId: other,
      otherMeta: core.COMPANY_META[other],
      ready,
      error,
      accounts,
      closedAccounts,
      otherAccounts: sortAccounts(accountsOther),
      accountsById,
      categories: [...(categoriesMine || [])].sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999) || a.name.localeCompare(b.name)),
      otherCategories: [...(categoriesOther || [])].sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999) || a.name.localeCompare(b.name)),
      categoriesById,
      rules: rules || [],
      projects: allProjects.filter((p) => !p.archived),
      allProjects,
      projectsById,
      monthly: monthly || [],
      monthlyOther: monthlyOther || [],
      reconciliations: reconciliations || [],
      balances,
      otherBalances,
      raw: { accountsMine: accountsMine || [], categoriesMine: categoriesMine || [], rules: rules || [] },
    };
  }, [companyId, setCompanyId, other, error, accountsMine, accountsOther, categoriesMine, categoriesOther, rules, monthly, monthlyOther, reconciliations, projectsRaw]);

  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

export function useLedger() {
  const ctx = useContext(LedgerContext);
  if (!ctx) throw new Error('useLedger must be used inside <LedgerProvider>');
  return ctx;
}
