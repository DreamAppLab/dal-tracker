import { collection, doc, getDocs, getDoc, setDoc } from 'firebase/firestore';

export const CLIENT_REVENUE_TYPES = ['deposit', 'balance', 'reversal'];

export function isClientProjectRevenueEntry(entry) {
  return CLIENT_REVENUE_TYPES.includes(String(entry?.type || '').toLowerCase());
}

export function sumManualSales(entries) {
  return (entries || []).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
}

export function sumClientProjectRevenue(entries) {
  let deposits = 0;
  let balances = 0;
  let reversals = 0;
  (entries || []).forEach((entry) => {
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
      totals[appId] = snap.docs.reduce((sum, d) => sum + (Number(d.data().amount) || 0), 0);
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
