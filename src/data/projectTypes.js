export const PROJECT_TYPE_OPTIONS = [
  'Own App',
  'Client App',
  'Website',
  'PWA',
  'Client Job',
];

export const PROJECT_TYPE_BADGE = {
  'Own App': { bg: 'rgba(59,130,246,0.18)', color: '#60A5FA' },
  'Client App': { bg: 'rgba(139,92,246,0.18)', color: '#C4B5FD' },
  Website: { bg: 'rgba(249,115,22,0.18)', color: '#FB923C' },
  PWA: { bg: 'rgba(34,197,94,0.18)', color: '#4ADE80' },
  'Client Job': { bg: 'rgba(234,179,8,0.2)', color: '#FACC15' },
};

export const PIPELINE_PROJECT_TYPES = PROJECT_TYPE_OPTIONS;

export function hasPipelineTab(projectType) {
  return PIPELINE_PROJECT_TYPES.includes(projectType);
}

export function pipelineKindForProjectType(projectType) {
  if (projectType === 'Own App' || projectType === 'Client App') return 'app';
  if (projectType === 'Website' || projectType === 'Client Job') return 'website';
  if (projectType === 'PWA') return 'pwa';
  return null;
}

export function internalTypeForProjectType(projectType) {
  switch (projectType) {
    case 'Own App':
      return 'own-app';
    case 'Client App':
      return 'client-app';
    case 'Website':
      return 'own-website';
    case 'PWA':
      return 'own-website';
    case 'Client Job':
      return 'client-website';
    default:
      return 'own-app';
  }
}

export function platformForProjectType(projectType) {
  if (projectType === 'Own App' || projectType === 'Client App') return 'mobile';
  return 'web';
}
