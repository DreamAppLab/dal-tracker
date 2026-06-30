import React, { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../firebase';
import { collection, doc, onSnapshot, setDoc, updateDoc, getDoc } from 'firebase/firestore';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { REVENUE_APPS, getDefaultRevenueDoc } from '../data/revenueAppsData';
import { syncRevenueCatToFirestore } from '../utils/revenueCatApi';

function formatMoney(amount) {
  return `$${(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function RevenueAppDetail({ appMeta, data, onBack, onSave }) {
  const [form, setForm] = useState({ ...data });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({ ...data });
  }, [data]);

  const setField = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  const setTrendValue = (index, value) => {
    const trend = [...(form.revenueTrend || [])];
    trend[index] = { ...trend[index], value: parseFloat(value) || 0 };
    setForm(prev => ({ ...prev, revenueTrend: trend }));
  };

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      ...form,
      lastUpdated: new Date().toISOString(),
    });
    setSaving(false);
  };

  const chartData = (form.revenueTrend || []).map(t => ({
    date: t.date.slice(5),
    value: t.value,
  }));

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
          <div className="project-logo" style={{ background: `${appMeta.color}18`, border: `1px solid ${appMeta.color}30`, width: 40, height: 40, fontSize: 20 }}>
            {appMeta.logo}
          </div>
          <div>
            <h1 className="page-title" style={{ marginBottom: 0 }}>{appMeta.name}</h1>
            <p className="page-subtitle">Revenue metrics — edit values manually until RevenueCat sync is live</p>
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 24 }}>
        {[
          { key: 'mrr', label: 'MRR', color: 'var(--green)' },
          { key: 'subscribers', label: 'Active Subscribers', color: 'var(--teal)' },
          { key: 'trials', label: 'Trial Conversions', color: 'var(--amber)' },
          { key: 'churnRate', label: 'Churn Rate (%)', color: 'var(--coral)' },
          { key: 'totalRevenue', label: 'Total Revenue', color: 'var(--indigo)' },
        ].map(({ key, label, color }) => (
          <div key={key} className="stat-card">
            <div className="stat-label">{label}</div>
            <input
              className="form-input"
              type="number"
              step={key === 'churnRate' ? '0.1' : '1'}
              value={form[key] ?? 0}
              onChange={e => setField(key, parseFloat(e.target.value) || 0)}
              style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color, marginTop: 8 }}
            />
          </div>
        ))}
      </div>

      <div className="chart-container">
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 16 }}>
          Revenue Trend — Last 30 Days
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData}>
            <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval={4} />
            <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} tickFormatter={v => `$${v}`} />
            <Tooltip
              contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8 }}
              labelStyle={{ color: 'var(--text-secondary)' }}
              formatter={v => [formatMoney(v), 'Revenue']}
            />
            <Line type="monotone" dataKey="value" stroke={appMeta.color} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="data-section">
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12 }}>
          Daily Revenue Values (editable)
        </div>
        <div className="revenue-trend-grid">
          {(form.revenueTrend || []).map((t, i) => (
            <div key={t.date} className="revenue-trend-cell">
              <label className="revenue-trend-date">{t.date.slice(5)}</label>
              <input
                className="form-input"
                type="number"
                step="0.01"
                value={t.value}
                onChange={e => setTrendValue(i, e.target.value)}
                style={{ fontSize: 12, padding: '6px 8px' }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function RevenueDashboard() {
  const [revenueData, setRevenueData] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [appErrors, setAppErrors] = useState({});
  const [selectedAppId, setSelectedAppId] = useState(null);
  const [seeded, setSeeded] = useState(false);
  const autoSyncStarted = useRef(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'revenue'), async (snapshot) => {
      const data = {};
      snapshot.docs.forEach(d => {
        data[d.id] = { ...d.data(), appId: d.id };
      });

      const missing = REVENUE_APPS.filter(a => !data[a.appId]);
      if (missing.length > 0 && !seeded) {
        setSeeded(true);
        await Promise.all(
          missing.map(a => setDoc(doc(db, 'revenue', a.appId), getDefaultRevenueDoc(a.appId), { merge: true }))
        );
        return;
      }

      setRevenueData(data);
      setLoading(false);
    });
    return () => unsub();
  }, [seeded]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const { errors } = await syncRevenueCatToFirestore(db, {
        doc,
        setDoc,
        updateDoc,
        getDoc,
      });
      setAppErrors(errors);
    } catch (error) {
      console.error('RevenueCat sync failed:', error);
      const fallback = {};
      REVENUE_APPS.forEach(a => {
        fallback[a.appId] = error.message || 'RevenueCat sync failed';
      });
      setAppErrors(fallback);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!loading && !autoSyncStarted.current) {
      autoSyncStarted.current = true;
      handleRefresh();
    }
  }, [loading, handleRefresh]);

  const totalRevenue = REVENUE_APPS.reduce((sum, a) => sum + (revenueData[a.appId]?.totalRevenue || 0), 0);

  const handleSave = async (appId, updated) => {
    await setDoc(doc(db, 'revenue', appId), updated, { merge: true });
    setRevenueData(prev => ({ ...prev, [appId]: updated }));
  };

  if (loading || refreshing) {
    return (
      <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
        <span style={{ color: 'var(--text-muted)' }}>
          {refreshing ? 'Syncing from RevenueCat...' : 'Loading revenue data...'}
        </span>
      </div>
    );
  }

  if (selectedAppId) {
    const appMeta = REVENUE_APPS.find(a => a.appId === selectedAppId);
    const data = revenueData[selectedAppId] || getDefaultRevenueDoc(selectedAppId);
    return (
      <RevenueAppDetail
        appMeta={appMeta}
        data={data}
        onBack={() => setSelectedAppId(null)}
        onSave={updated => handleSave(selectedAppId, updated)}
      />
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Revenue</h1>
          <p className="page-subtitle">Sales & subscription revenue across all DAL apps</p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className={`btn ${refreshing ? 'btn-disabled' : 'btn-secondary'}`}
            onClick={handleRefresh}
            disabled={refreshing}
          >
            ↻ Refresh from RevenueCat
          </button>
        </div>
      </div>

      <div className="revenue-total-banner">
        <div className="revenue-total-label">Total Revenue — All Apps</div>
        <div className="revenue-total-value">{formatMoney(totalRevenue)}</div>
      </div>

      <div className="stats-grid">
        {REVENUE_APPS.map(app => {
          const d = revenueData[app.appId] || {};
          const syncError = appErrors[app.appId];
          return (
            <div
              key={app.appId}
              className="project-card revenue-app-card"
              onClick={() => setSelectedAppId(app.appId)}
              style={{ cursor: 'pointer' }}
              title={syncError || undefined}
            >
              <div className="project-card-accent" style={{ background: `linear-gradient(90deg, ${app.color}, transparent)` }} />
              <div className="project-card-top">
                <div className="project-logo-wrap">
                  <div className="project-logo" style={{ background: `${app.color}18`, border: `1px solid ${app.color}30` }}>
                    {app.logo}
                  </div>
                  <div>
                    <div className="project-name">{app.name}</div>
                    <div className="project-tagline">
                      {syncError ? `Sync error: ${syncError}` : 'Tap for full metrics'}
                    </div>
                  </div>
                </div>
              </div>
              <div className="card-mini-stats">
                <div className="card-mini-stat">
                  <div className="card-mini-stat-value" style={{ color: 'var(--green)' }}>{formatMoney(d.mrr)}</div>
                  <div className="card-mini-stat-label">MRR</div>
                </div>
                <div className="card-mini-stat">
                  <div className="card-mini-stat-value">{d.subscribers || 0}</div>
                  <div className="card-mini-stat-label">Subscribers</div>
                </div>
                <div className="card-mini-stat">
                  <div className="card-mini-stat-value" style={{ color: 'var(--indigo)' }}>{formatMoney(d.totalRevenue)}</div>
                  <div className="card-mini-stat-label">Total Revenue</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
