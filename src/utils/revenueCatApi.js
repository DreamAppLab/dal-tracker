// RevenueCat metrics for Mission Control.
// All RevenueCat calls happen server-side in api/revenuecat/sync.js, which holds
// the secret keys (REVENUECAT_SECRET_* Vercel env vars). The browser only ever
// talks to that authenticated endpoint — never to RevenueCat directly.

import { apiFetch } from '../lib/apiClient';

export const REVENUE_APP_IDS = ['logabode', 'flarepad', 'familywatch', 'myclasslog', 'tenmilesahead', 'rvvault'];

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function buildEmptyTrend() {
  return Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - (29 - i));
    return { date: formatDate(d), value: 0 };
  });
}

export async function fetchAllRevenueCatData() {
  const res = await apiFetch('/api/revenuecat/sync');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `RevenueCat sync failed (${res.status})`);
  }
  const data = await res.json();
  return data.apps || [];
}

function toFirestoreRevenueFields(metrics) {
  return {
    mrr: metrics.mrr ?? 0,
    subscribers: metrics.activeSubscribers ?? 0,
    totalRevenue: metrics.totalRevenue ?? 0,
    trials: metrics.trialConversions ?? 0,
    churnRate: metrics.churnRate ?? 0,
    revenueTrend: metrics.dailyRevenue ?? buildEmptyTrend(),
    lastUpdated: metrics.syncedAt || new Date().toISOString(),
    revenueCatSyncedAt: metrics.syncedAt || new Date().toISOString(),
  };
}

export async function syncRevenueCatToFirestore(db, firestoreFns) {
  const { doc, setDoc, updateDoc, getDoc } = firestoreFns;
  const results = await fetchAllRevenueCatData();

  let totalMrr = 0;
  let totalRevenue = 0;
  const errors = {};

  await Promise.all(
    results.map(async (result) => {
      if (!result.success) {
        errors[result.appId] = result.error || 'Failed to fetch from RevenueCat';
        return;
      }

      totalMrr += result.mrr || 0;
      totalRevenue += result.totalRevenue || 0;

      await setDoc(
        doc(db, 'revenue', result.appId),
        toFirestoreRevenueFields(result),
        { merge: true }
      );

      const projectRef = doc(db, 'projects', result.appId);
      const projectSnap = await getDoc(projectRef);
      if (projectSnap.exists()) {
        await updateDoc(projectRef, {
          'revenue.monthly': result.mrr || 0,
          'revenue.total': result.totalRevenue || 0,
        });
      }
    })
  );

  await setDoc(
    doc(db, 'dashboard', 'summary'),
    {
      monthlyRevenue: totalMrr,
      totalRevenue,
      revenueCatLastSynced: new Date().toISOString(),
    },
    { merge: true }
  );

  return { results, errors, totalMrr, totalRevenue };
}

