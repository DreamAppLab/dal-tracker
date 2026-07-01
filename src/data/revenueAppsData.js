export const REVENUE_MOBILE_APPS = [
  { appId: 'logabode', name: 'LogAbode', logo: '🏠', color: '#8B5CF6' },
  { appId: 'myclasslog', name: 'MyClassLog', logo: '📚', color: '#6366F1' },
  { appId: 'tenmilesahead', name: 'Ten Miles Ahead', logo: '✈️', color: '#00D4B8' },
  { appId: 'rvvault', name: 'RV Vault', logo: '🚐', color: '#F59E0B' },
  { appId: 'flarepad', name: 'FlarePad', logo: '🩺', color: '#FF5B5B' },
  { appId: 'familywatch', name: 'FamilyLens', logo: '👨‍👩‍👧', color: '#3B82F6' },
];

/** @deprecated Use REVENUE_MOBILE_APPS or getRevenueEntries() */
export const REVENUE_APPS = REVENUE_MOBILE_APPS;

const WEB_REVENUE_TYPES = new Set(['own-website', 'client-website']);

export function isWebRevenueProject(project) {
  if (!project?.id) return false;
  if (WEB_REVENUE_TYPES.has(project.type)) return true;
  return project.platform === 'web' && project.type !== 'own-app';
}

export function projectToRevenueEntry(project) {
  return {
    appId: project.id,
    name: project.name,
    logo: project.logo || '🌐',
    color: project.color || '#58c6f4',
    isWeb: true,
  };
}

export function getRevenueEntries(projects = []) {
  const mobileIds = new Set(REVENUE_MOBILE_APPS.map(a => a.appId));
  const webEntries = projects
    .filter(p => isWebRevenueProject(p) && !mobileIds.has(p.id))
    .map(projectToRevenueEntry);
  return [...REVENUE_MOBILE_APPS, ...webEntries];
}

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
