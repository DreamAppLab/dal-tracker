export const REVENUE_APPS = [
  { appId: 'logabode', name: 'LogAbode', logo: '🏠', color: '#8B5CF6' },
  { appId: 'myclasslog', name: 'MyClassLog', logo: '📚', color: '#6366F1' },
  { appId: 'tenmilesahead', name: 'Ten Miles Ahead', logo: '✈️', color: '#00D4B8' },
  { appId: 'rvvault', name: 'RV Vault', logo: '🚐', color: '#F59E0B' },
  { appId: 'flarepad', name: 'FlarePad', logo: '🩺', color: '#FF5B5B' },
  { appId: 'familywatch', name: 'FamilyLens', logo: '👨‍👩‍👧', color: '#3B82F6' },
];

export function getDefaultRevenueDoc(appId) {
  const trend = Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    return { date: d.toISOString().split('T')[0], value: 0 };
  });
  return {
    appId,
    mrr: 0,
    subscribers: 0,
    totalRevenue: 0,
    trials: 0,
    churnRate: 0,
    revenueTrend: trend,
    lastUpdated: new Date().toISOString(),
  };
}
