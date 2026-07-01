// src/data/subscriptionsData.js

export const SUBSCRIPTION_APPS = [
  { id: 'familywatch', name: 'FamilyLens' },
  { id: 'flarepad', name: 'Flarepad' },
  { id: 'logabode', name: 'Logabode' },
  { id: 'myclasslog', name: 'MyClassLog' },
  { id: 'rvvault', name: 'RV Vault' },
  { id: 'tenmilesahead', name: 'Ten Miles Ahead' },
  { id: 'dal-website', name: 'DAL Website' }
];

export const SUBSCRIPTIONS = [
  { id: 'eas-build', name: 'EAS Build', amount: 29, period: 'monthly' },
  { id: 'firebase', name: 'Firebase', amount: 25, period: 'monthly' },
  { id: 'revenuecat', name: 'RevenueCat', amount: 0, period: 'monthly' },
  { id: 'cursor', name: 'Cursor', amount: 20, period: 'monthly' },
  { id: 'claude-pro', name: 'Claude Pro', amount: 20, period: 'monthly' },
  { id: 'apple-dev', name: 'Apple Dev', amount: 99, period: 'yearly' },
  { id: 'google-workspace', name: 'Google Workspace', amount: 6, period: 'monthly' },
  { id: 'jotform', name: 'Jotform', amount: 34, period: 'monthly' },
  { id: 'massblogger', name: 'Massblogger', amount: 29, period: 'monthly' },
  { id: 'make', name: 'Make.com', amount: 9, period: 'monthly' },
  { id: 'aso-dev', name: 'ASO.dev', amount: 25, period: 'monthly' }
];

export function getMonthlyCost(subscription) {
  if (!subscription.amount) return 0;
  return subscription.period === 'yearly' ? subscription.amount / 12 : subscription.amount;
}

export function formatSubscriptionCost(subscription) {
  if (!subscription.amount) return 'free';
  const suffix = subscription.period === 'yearly' ? '/yr' : '/mo';
  return `$${subscription.amount}${suffix}`;
}

export function getCheckedApps(allocations, subscriptionId, apps) {
  return apps.filter(app => allocations[subscriptionId]?.[app.id]);
}

export function getAppMonthlyTotals(subscriptions, allocations, apps) {
  const totals = Object.fromEntries(apps.map(app => [app.id, 0]));

  subscriptions.forEach(sub => {
    const monthly = getMonthlyCost(sub);
    const checked = getCheckedApps(allocations, sub.id, apps);
    if (!checked.length) return;
    const share = monthly / checked.length;
    checked.forEach(app => {
      totals[app.id] += share;
    });
  });

  return totals;
}

export const INITIAL_ALLOCATIONS = {};
