// src/components/SubscriptionsDashboard.js
import React from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';
import {
  SUBSCRIPTION_APPS,
  SUBSCRIPTIONS,
  INITIAL_ALLOCATIONS,
  getMonthlyCost,
  formatSubscriptionCost,
  getCheckedApps,
  getAppMonthlyTotals
} from '../data/subscriptionsData';

function formatMoney(amount) {
  if (!amount) return '$0.00';
  return `$${amount.toFixed(2)}`;
}

export default function SubscriptionsDashboard() {
  const [allocations, setAllocations] = useLocalStorage('dal-subscriptions', INITIAL_ALLOCATIONS);

  const appTotals = getAppMonthlyTotals(SUBSCRIPTIONS, allocations, SUBSCRIPTION_APPS);
  const totalMonthlyTools = SUBSCRIPTIONS.reduce((sum, sub) => sum + getMonthlyCost(sub), 0);
  const totalAllocated = Object.values(appTotals).reduce((sum, value) => sum + value, 0);
  const allocatedSubs = SUBSCRIPTIONS.filter(sub => getCheckedApps(allocations, sub.id, SUBSCRIPTION_APPS).length > 0).length;

  const toggleAllocation = (subscriptionId, appId) => {
    setAllocations(prev => {
      const subAllocations = { ...(prev[subscriptionId] || {}) };
      subAllocations[appId] = !subAllocations[appId];
      return { ...prev, [subscriptionId]: subAllocations };
    });
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Subscriptions</h1>
          <p className="page-subtitle">Split shared tool costs across apps — check which apps use each subscription</p>
        </div>
        <div className="page-actions">
          <div className="live-indicator">
            <span className="live-dot" />
            {formatMoney(totalMonthlyTools)}/mo total tools
          </div>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card teal">
          <div className="stat-label">Monthly Tool Spend</div>
          <div className="stat-value" style={{ color: 'var(--teal)' }}>{formatMoney(totalMonthlyTools)}</div>
          <div className="stat-sub">{SUBSCRIPTIONS.length} subscriptions tracked</div>
        </div>
        <div className="stat-card amber">
          <div className="stat-label">Allocated</div>
          <div className="stat-value" style={{ color: 'var(--amber)' }}>{formatMoney(totalAllocated)}</div>
          <div className="stat-sub">{allocatedSubs} of {SUBSCRIPTIONS.length} subscriptions assigned</div>
        </div>
        <div className="stat-card indigo">
          <div className="stat-label">Apps</div>
          <div className="stat-value">{SUBSCRIPTION_APPS.length}</div>
          <div className="stat-sub">Cost columns in allocation grid</div>
        </div>
      </div>

      <div className="data-section" style={{ paddingTop: 0 }}>
        <div className="subscriptions-table-wrap">
          <table className="stack-table subscriptions-table">
            <thead>
              <tr>
                <th className="subscriptions-sticky-col">Subscription</th>
                {SUBSCRIPTION_APPS.map(app => (
                  <th key={app.id} className="subscriptions-app-col">{app.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SUBSCRIPTIONS.map(sub => {
                const monthly = getMonthlyCost(sub);
                const checked = getCheckedApps(allocations, sub.id, SUBSCRIPTION_APPS);
                const share = checked.length ? monthly / checked.length : 0;

                return (
                  <tr key={sub.id}>
                    <td className="subscriptions-sticky-col">
                      <div className="subscriptions-name">{sub.name}</div>
                      <div className="subscriptions-cost">{formatSubscriptionCost(sub)}</div>
                      {checked.length > 0 && monthly > 0 && (
                        <div className="subscriptions-split">{formatMoney(share)}/app</div>
                      )}
                    </td>
                    {SUBSCRIPTION_APPS.map(app => {
                      const isChecked = !!allocations[sub.id]?.[app.id];
                      return (
                        <td key={app.id} className="subscriptions-cell">
                          <label className="subscriptions-checkbox-label">
                            <input
                              type="checkbox"
                              className="subscriptions-checkbox"
                              checked={isChecked}
                              onChange={() => toggleAllocation(sub.id, app.id)}
                            />
                            {isChecked && monthly > 0 && (
                              <span className="subscriptions-share">{formatMoney(share)}</span>
                            )}
                          </label>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="subscriptions-totals-row">
                <td className="subscriptions-sticky-col">
                  <div className="subscriptions-total-label">Monthly cost per app</div>
                </td>
                {SUBSCRIPTION_APPS.map(app => (
                  <td key={app.id} className="subscriptions-total-cell">
                    <span className="subscriptions-total-value">{formatMoney(appTotals[app.id])}</span>
                    <span className="subscriptions-total-sub">/mo</span>
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
