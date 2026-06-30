// src/components/SubscriptionsDashboard.js
import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import {
  SUBSCRIPTION_APPS,
  SUBSCRIPTIONS,
  getMonthlyCost,
  formatSubscriptionCost,
  getCheckedApps,
  getAppMonthlyTotals,
} from '../data/subscriptionsData';
import AddSubscriptionModal from './AddSubscriptionModal';

function formatMoney(amount) {
  if (!amount) return '$0.00';
  return `$${amount.toFixed(2)}`;
}

function seedSubscription(sub) {
  return {
    name: sub.name,
    amount: sub.amount,
    period: sub.period,
    category: 'tools',
    apps: {},
  };
}

export default function SubscriptionsDashboard() {
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [seeded, setSeeded] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editAmount, setEditAmount] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'subscriptions'), async (snapshot) => {
      if (snapshot.empty && !seeded) {
        setSeeded(true);
        await Promise.all(
          SUBSCRIPTIONS.map(sub =>
            setDoc(doc(db, 'subscriptions', sub.id), seedSubscription(sub))
          )
        );
        return;
      }

      const data = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setSubscriptions(data);
      setLoading(false);
    });
    return () => unsub();
  }, [seeded]);

  const getAllocations = () => {
    const allocations = {};
    subscriptions.forEach(sub => {
      allocations[sub.id] = sub.apps || {};
    });
    return allocations;
  };

  const allocations = getAllocations();
  const appTotals = getAppMonthlyTotals(subscriptions, allocations, SUBSCRIPTION_APPS);
  const totalMonthlyTools = subscriptions.reduce((sum, sub) => sum + getMonthlyCost(sub), 0);
  const totalAllocated = Object.values(appTotals).reduce((sum, value) => sum + value, 0);
  const allocatedSubs = subscriptions.filter(sub => getCheckedApps(allocations, sub.id, SUBSCRIPTION_APPS).length > 0).length;

  const toggleAllocation = async (subscriptionId, appId) => {
    const sub = subscriptions.find(s => s.id === subscriptionId);
    if (!sub) return;
    const apps = { ...(sub.apps || {}) };
    apps[appId] = !apps[appId];
    await setDoc(doc(db, 'subscriptions', subscriptionId), { ...sub, apps });
  };

  const startEditPrice = (sub) => {
    setEditingId(sub.id);
    setEditAmount(String(sub.amount));
  };

  const savePrice = async (sub) => {
    const amount = parseFloat(editAmount) || 0;
    await setDoc(doc(db, 'subscriptions', sub.id), { ...sub, amount });
    setEditingId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditAmount('');
  };

  const handleAddSubscription = async (newSub) => {
    await setDoc(doc(db, 'subscriptions', newSub.id), newSub);
    setShowAddModal(false);
  };

  if (loading) {
    return (
      <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
        <span style={{ color: 'var(--text-muted)' }}>Loading subscriptions...</span>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Subscriptions</h1>
          <p className="page-subtitle">Split shared tool costs across apps — check which apps use each subscription</p>
        </div>
        <div className="page-actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
            + Add Subscription
          </button>
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
          <div className="stat-sub">{subscriptions.length} subscriptions tracked</div>
        </div>
        <div className="stat-card amber">
          <div className="stat-label">Allocated</div>
          <div className="stat-value" style={{ color: 'var(--amber)' }}>{formatMoney(totalAllocated)}</div>
          <div className="stat-sub">{allocatedSubs} of {subscriptions.length} subscriptions assigned</div>
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
              {subscriptions.map(sub => {
                const monthly = getMonthlyCost(sub);
                const checked = getCheckedApps(allocations, sub.id, SUBSCRIPTION_APPS);
                const share = checked.length ? monthly / checked.length : 0;
                const isEditing = editingId === sub.id;

                return (
                  <tr key={sub.id}>
                    <td className="subscriptions-sticky-col">
                      <div className="subscriptions-name-row">
                        <div className="subscriptions-name">{sub.name}</div>
                        {!isEditing && (
                          <button
                            className="subscriptions-edit-btn"
                            onClick={() => startEditPrice(sub)}
                            title="Edit price"
                          >
                            ✏️
                          </button>
                        )}
                      </div>
                      {isEditing ? (
                        <div className="subscriptions-price-edit">
                          <input
                            className="form-input"
                            type="number"
                            step="0.01"
                            min="0"
                            value={editAmount}
                            onChange={e => setEditAmount(e.target.value)}
                            style={{ width: 80, fontSize: 12, padding: '4px 8px' }}
                            autoFocus
                          />
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>/{sub.period === 'yearly' ? 'yr' : 'mo'}</span>
                          <button className="btn btn-primary btn-sm" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => savePrice(sub)}>Save</button>
                          <button className="btn btn-ghost btn-sm" style={{ padding: '2px 8px', fontSize: 11 }} onClick={cancelEdit}>Cancel</button>
                        </div>
                      ) : (
                        <div className="subscriptions-cost">{formatSubscriptionCost(sub)}</div>
                      )}
                      {sub.category && (
                        <div className="subscriptions-split" style={{ textTransform: 'capitalize' }}>{sub.category}</div>
                      )}
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

      {showAddModal && (
        <AddSubscriptionModal
          onAdd={handleAddSubscription}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}
