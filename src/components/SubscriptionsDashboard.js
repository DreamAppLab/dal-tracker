// src/components/SubscriptionsDashboard.js
import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase';
import { collection, doc, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';
import {
  SUBSCRIPTION_APPS,
  SUBSCRIPTIONS,
  getMonthlyCost,
  formatSubscriptionCost,
  getCheckedApps,
  getAppMonthlyTotals,
  getSubscriptionStatus,
  isSubscriptionSuspended,
} from '../data/subscriptionsData';
import AddSubscriptionModal from './AddSubscriptionModal';

const REQUIRED_NEW_SUBSCRIPTIONS = [
  { name: 'Twilio' },
  { name: 'Vercel' },
];

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
    status: 'active',
  };
}

function buildNewSubscription(name) {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + `-${Date.now()}`;
  return {
    id,
    name,
    amount: 0,
    period: 'monthly',
    category: 'tools',
    apps: {},
    status: 'active',
  };
}

export default function SubscriptionsDashboard({ projects = [] }) {
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [seeded, setSeeded] = useState(false);
  const [newSubsEnsured, setNewSubsEnsured] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingSubscription, setEditingSubscription] = useState(null);

  const modalApps = useMemo(() => {
    if (!projects.length) return SUBSCRIPTION_APPS;

    const subByName = new Map(
      SUBSCRIPTION_APPS.map((a) => [a.name.toLowerCase(), a])
    );
    const result = [];
    const usedSubIds = new Set();

    projects.forEach((p) => {
      if (!p?.id) return;
      const match = subByName.get((p.name || '').toLowerCase());
      if (match) {
        if (!usedSubIds.has(match.id)) {
          result.push({ id: match.id, name: match.name });
          usedSubIds.add(match.id);
        }
      } else {
        result.push({ id: p.id, name: p.name || p.id });
      }
    });

    SUBSCRIPTION_APPS.forEach((app) => {
      if (!usedSubIds.has(app.id)) result.push(app);
    });

    return result;
  }, [projects]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'subscriptions'), async (snapshot) => {
      if (snapshot.empty && !seeded) {
        setSeeded(true);
        await Promise.all(
          SUBSCRIPTIONS.map(sub =>
            setDoc(doc(db, 'subscriptions', sub.id), seedSubscription(sub), { merge: true })
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

  useEffect(() => {
    if (loading || newSubsEnsured) return;

    const ensureNewSubscriptions = async () => {
      const missing = REQUIRED_NEW_SUBSCRIPTIONS.filter(
        req => !subscriptions.some(s => s.name.toLowerCase() === req.name.toLowerCase())
      );

      if (missing.length > 0) {
        await Promise.all(
          missing.map(req => {
            const newSub = buildNewSubscription(req.name);
            return setDoc(doc(db, 'subscriptions', newSub.id), newSub, { merge: true });
          })
        );
      }

      setNewSubsEnsured(true);
    };

    ensureNewSubscriptions();
  }, [loading, subscriptions, newSubsEnsured]);

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
  const activeCount = subscriptions.filter(sub => !isSubscriptionSuspended(sub)).length;

  const toggleAllocation = async (subscriptionId, appId) => {
    const sub = subscriptions.find(s => s.id === subscriptionId);
    if (!sub || isSubscriptionSuspended(sub)) return;
    const apps = { ...(sub.apps || {}) };
    apps[appId] = !apps[appId];
    await setDoc(doc(db, 'subscriptions', subscriptionId), { apps }, { merge: true });
  };

  const toggleStatus = async (sub) => {
    const currentStatus = getSubscriptionStatus(sub);
    const status = currentStatus === 'suspended' ? 'active' : 'suspended';
    await setDoc(doc(db, 'subscriptions', sub.id), { status }, { merge: true });
  };

  const openAddModal = () => {
    setEditingSubscription(null);
    setShowModal(true);
  };

  const openEditModal = (sub) => {
    setEditingSubscription(sub);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingSubscription(null);
  };

  const handleSaveSubscription = async (payload) => {
    const { id, ...fields } = payload;
    await setDoc(doc(db, 'subscriptions', id), fields, { merge: true });
    closeModal();
  };

  const handleDeleteSubscription = async (sub) => {
    if (!window.confirm(`Delete ${sub.name}? This cannot be undone.`)) return;
    await deleteDoc(doc(db, 'subscriptions', sub.id));
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
          <button className="btn btn-primary" onClick={openAddModal}>
            ＋ Add Subscription
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
          <div className="stat-sub">{activeCount} active of {subscriptions.length} subscriptions</div>
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
                const status = getSubscriptionStatus(sub);
                const suspended = isSubscriptionSuspended(sub);

                return (
                  <tr key={sub.id} className={suspended ? 'subscriptions-row-suspended' : ''}>
                    <td className="subscriptions-sticky-col">
                      <div className="subscriptions-name-row">
                        <div className="subscriptions-name">{sub.name}</div>
                        <button
                          type="button"
                          className="subscriptions-edit-btn"
                          onClick={() => openEditModal(sub)}
                          title="Edit subscription"
                          aria-label={`Edit ${sub.name}`}
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          className="subscriptions-edit-btn"
                          onClick={() => handleDeleteSubscription(sub)}
                          title="Delete subscription"
                          aria-label={`Delete ${sub.name}`}
                        >
                          🗑
                        </button>
                      </div>
                      <div className="subscriptions-cost">{formatSubscriptionCost(sub)}</div>
                      <div className="subscriptions-status-row">
                        <span className={`subscriptions-status-badge subscriptions-status-${status}`}>
                          {status}
                        </span>
                        <button
                          type="button"
                          className={`btn btn-sm ${suspended ? 'btn-primary' : 'btn-ghost'}`}
                          style={{ padding: '2px 8px', fontSize: 11 }}
                          onClick={() => toggleStatus(sub)}
                        >
                          {suspended ? 'Resume' : 'Suspend'}
                        </button>
                      </div>
                      {sub.category && (
                        <div className="subscriptions-split" style={{ textTransform: 'capitalize' }}>{sub.category}</div>
                      )}
                      {sub.renewalDate && (
                        <div className="subscriptions-split">Renews {sub.renewalDate}</div>
                      )}
                      {checked.length > 0 && monthly > 0 && (
                        <div className="subscriptions-split">{formatMoney(share)}/app</div>
                      )}
                    </td>
                    {SUBSCRIPTION_APPS.map(app => {
                      const isChecked = !!allocations[sub.id]?.[app.id];
                      return (
                        <td key={app.id} className="subscriptions-cell">
                          <label className={`subscriptions-checkbox-label ${suspended ? 'disabled' : ''}`}>
                            <input
                              type="checkbox"
                              className="subscriptions-checkbox"
                              checked={isChecked}
                              disabled={suspended}
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

      {showModal && (
        <AddSubscriptionModal
          subscription={editingSubscription}
          apps={modalApps}
          onSave={handleSaveSubscription}
          onClose={closeModal}
        />
      )}
    </div>
  );
}
