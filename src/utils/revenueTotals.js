import { collection, doc, getDocs, getDoc, setDoc } from 'firebase/firestore';

export const CLIENT_REVENUE_TYPES = ['deposit', 'balance', 'reversal'];

export function isClientProjectRevenueEntry(entry) {
  return CLIENT_REVENUE_TYPES.includes(String(entry?.type || '').toLowerCase());
}

export function isTestRevenueEntry(entry) {
  if (!entry) return false;
  if (entry.isTest === false) return false;
  if (entry.isTest === true || entry.test === true) return true;
  const type = String(entry.type || '').toLowerCase();
  const amount = Number(entry.amount);
  return type === 'deposit' && Number.isFinite(amount) && Math.abs(amount) === 2;
}

export function sumManualSales(entries) {
  return (entries || []).reduce((sum, e) => {
    if (isTestRevenueEntry(e)) return sum;
    return sum + (Number(e.amount) || 0);
  }, 0);
}

export function sumClientProjectRevenue(entries) {
  let deposits = 0;
  let balances = 0;
  let reversals = 0;
  (entries || []).forEach((entry) => {
    if (isTestRevenueEntry(entry)) return;
    const amount = Number(entry.amount) || 0;
    const type = String(entry.type || '').toLowerCase();
    if (type === 'deposit') deposits += amount;
    else if (type === 'balance') balances += amount;
    else if (type === 'reversal') reversals += Math.abs(amount);
  });
  return {
    deposits,
    balances,
    reversals,
    net: deposits + balances - reversals,
  };
}

export function getCombinedTotalRevenue(revenueDoc, manualSalesTotal) {
  const rcTotal = Number(revenueDoc?.totalRevenue) || 0;
  return rcTotal + (Number(manualSalesTotal) || 0);
}

async function resolveRevenueAppIds(db, appIds) {
  if (appIds?.length) return appIds;
  const revenueSnap = await getDocs(collection(db, 'revenue'));
  return revenueSnap.docs.map(d => d.id);
}

export async function fetchManualSalesTotals(db, appIds) {
  const ids = await resolveRevenueAppIds(db, appIds);
  const totals = {};
  await Promise.all(
    ids.map(async (appId) => {
      const snap = await getDocs(collection(db, 'revenue', appId, 'manualSales'));
      totals[appId] = snap.docs.reduce((sum, d) => {
        const data = d.data() || {};
        if (isTestRevenueEntry(data)) return sum;
        return sum + (Number(data.amount) || 0);
      }, 0);
    })
  );
  return totals;
}

export async function syncDashboardRevenueTotals(db, appIds) {
  const ids = await resolveRevenueAppIds(db, appIds);
  const totals = await fetchManualSalesTotals(db, ids);

  let totalRcRevenue = 0;
  let totalManualSales = 0;

  await Promise.all(
    ids.map(async (appId) => {
      const revSnap = await getDoc(doc(db, 'revenue', appId));
      const rcTotal = Number(revSnap.data()?.totalRevenue) || 0;
      totalRcRevenue += rcTotal;
      totalManualSales += totals[appId] || 0;
    })
  );

  await setDoc(
    doc(db, 'dashboard', 'summary'),
    {
      totalRevenue: totalRcRevenue + totalManualSales,
      manualSalesTotal: totalManualSales,
      revenueCatTotalRevenue: totalRcRevenue,
      revenueTotalsLastSynced: new Date().toISOString(),
    },
    { merge: true }
  );

  return {
    totalRevenue: totalRcRevenue + totalManualSales,
    totalManualSales,
    totalRcRevenue,
    manualSalesByApp: totals,
  };
}
