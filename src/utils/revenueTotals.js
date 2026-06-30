import { collection, doc, getDocs, getDoc, setDoc } from 'firebase/firestore';
import { REVENUE_APPS } from '../data/revenueAppsData';

export function sumManualSales(entries) {
  return (entries || []).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
}

export function getCombinedTotalRevenue(revenueDoc, manualSalesTotal) {
  const rcTotal = Number(revenueDoc?.totalRevenue) || 0;
  return rcTotal + (Number(manualSalesTotal) || 0);
}

export async function fetchManualSalesTotals(db) {
  const totals = {};
  await Promise.all(
    REVENUE_APPS.map(async ({ appId }) => {
      const snap = await getDocs(collection(db, 'revenue', appId, 'manualSales'));
      totals[appId] = snap.docs.reduce((sum, d) => sum + (Number(d.data().amount) || 0), 0);
    })
  );
  return totals;
}

export async function syncDashboardRevenueTotals(db) {
  const totals = await fetchManualSalesTotals(db);

  let totalRcRevenue = 0;
  let totalManualSales = 0;

  await Promise.all(
    REVENUE_APPS.map(async ({ appId }) => {
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
