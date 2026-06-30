import React, { useState, useEffect, useCallback, useRef } from 'react';
import { db, storage } from '../firebase';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  addDoc,
  getDoc,
  updateDoc,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { REVENUE_APPS, getDefaultRevenueDoc } from '../data/revenueAppsData';
import { syncRevenueCatToFirestore } from '../utils/revenueCatApi';
import {
  getCombinedTotalRevenue,
  sumManualSales,
  syncDashboardRevenueTotals,
} from '../utils/revenueTotals';
import AppLogo from './AppLogo';

const LAYOUT_DOC_ID = 'layout';
const DEFAULT_CARD_WIDTH = 300;
const DEFAULT_CARD_HEIGHT = 200;
const ACCEPTED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml'];

function formatMoney(amount) {
  return `$${(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function getDefaultLayout() {
  return {
    order: REVENUE_APPS.map(a => a.appId),
    sizes: {},
  };
}

function RevenueAppDetail({
  appMeta,
  data,
  manualSales,
  onBack,
  onSave,
  onManualSaleSaved,
}) {
  const [form, setForm] = useState({ ...data });
  const [saving, setSaving] = useState(false);
  const [saleDate, setSaleDate] = useState(todayISO());
  const [saleAmount, setSaleAmount] = useState('');
  const [saleNote, setSaleNote] = useState('');
  const [savingSale, setSavingSale] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    setForm({ ...data });
  }, [data]);

  const manualSalesTotal = sumManualSales(manualSales);
  const combinedTotal = getCombinedTotalRevenue(form, manualSalesTotal);

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

  const handleSaveManualSale = async () => {
    const amount = parseFloat(saleAmount);
    if (!amount || amount <= 0) return;
    setSavingSale(true);
    try {
      await addDoc(collection(db, 'revenue', appMeta.appId, 'manualSales'), {
        date: saleDate,
        amount,
        note: saleNote.trim(),
        createdAt: new Date().toISOString(),
      });
      setSaleAmount('');
      setSaleNote('');
      setSaleDate(todayISO());
      await onManualSaleSaved();
    } finally {
      setSavingSale(false);
    }
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ACCEPTED_LOGO_TYPES.includes(file.type)) {
      alert('Please upload a PNG, JPG, or SVG file.');
      return;
    }
    setUploadingLogo(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const storageRef = ref(storage, `appLogos/${appMeta.appId}/logo.${ext}`);
      await uploadBytes(storageRef, file);
      const logoUrl = await getDownloadURL(storageRef);
      await setDoc(doc(db, 'revenue', appMeta.appId), { logoUrl }, { merge: true });
      setForm(prev => ({ ...prev, logoUrl }));
    } catch (err) {
      console.error('Logo upload failed:', err);
      alert('Logo upload failed. Check the console for details.');
    } finally {
      setUploadingLogo(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const chartData = (form.revenueTrend || []).map(t => ({
    date: t.date.slice(5),
    value: t.value,
  }));

  const sortedSales = [...manualSales].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
          <AppLogo
            logoUrl={form.logoUrl}
            fallback={appMeta.logo}
            color={appMeta.color}
            size={40}
          />
          <div>
            <h1 className="page-title" style={{ marginBottom: 0 }}>{appMeta.name}</h1>
            <p className="page-subtitle">Revenue metrics — edit values manually until RevenueCat sync is live</p>
          </div>
        </div>
        <div className="page-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
            style={{ display: 'none' }}
            onChange={handleLogoUpload}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingLogo}
          >
            {uploadingLogo ? 'Uploading...' : 'Upload Logo'}
          </button>
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
          { key: 'totalRevenue', label: 'RevenueCat Total', color: 'var(--indigo)' },
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
        <div className="stat-card">
          <div className="stat-label">Combined Total Revenue</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--amber)', marginTop: 8 }}>
            {formatMoney(combinedTotal)}
          </div>
          <div className="stat-sub" style={{ marginTop: 4 }}>RevenueCat + Manual Sales</div>
        </div>
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

      <div className="data-section manual-sales-section">
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12 }}>
          Manual Sales
        </div>

        {sortedSales.length > 0 ? (
          <ul className="manual-sales-list">
            {sortedSales.map(entry => (
              <li key={entry.id} className="manual-sales-item">
                <span className="manual-sales-date">{entry.date}</span>
                <span className="manual-sales-amount">{formatMoney(entry.amount)}</span>
                {entry.note && <span className="manual-sales-note">{entry.note}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="manual-sales-empty">No manual sales logged yet.</p>
        )}

        <div className="manual-sales-total">
          Manual Sales Total: <strong>{formatMoney(manualSalesTotal)}</strong>
        </div>

        <div className="manual-sales-form">
          <div className="form-group">
            <label className="form-label">Date</label>
            <input
              className="form-input"
              type="date"
              value={saleDate}
              onChange={e => setSaleDate(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Amount</label>
            <div className="manual-sales-amount-input">
              <span className="manual-sales-currency">$</span>
              <input
                className="form-input"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={saleAmount}
                onChange={e => setSaleAmount(e.target.value)}
              />
            </div>
          </div>
          <div className="form-group manual-sales-note-field">
            <label className="form-label">Note (optional)</label>
            <input
              className="form-input"
              type="text"
              placeholder="e.g. Stripe client payment, Cash sale"
              value={saleNote}
              onChange={e => setSaleNote(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSaveManualSale}
            disabled={savingSale || !saleAmount || parseFloat(saleAmount) <= 0}
          >
            {savingSale ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RevenueDraggableCard({
  app,
  data,
  syncError,
  manualSalesTotal,
  cardSize,
  isDragOver,
  onSelect,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onResizeEnd,
}) {
  const cardRef = useRef(null);
  const combinedTotal = getCombinedTotalRevenue(data, manualSalesTotal);
  const width = cardSize?.width || DEFAULT_CARD_WIDTH;
  const height = cardSize?.height || DEFAULT_CARD_HEIGHT;

  const handleResizeStart = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = width;
    const startH = height;

    const onMove = (ev) => {
      const newW = Math.max(220, startW + ev.clientX - startX);
      const newH = Math.max(160, startH + ev.clientY - startY);
      if (cardRef.current) {
        cardRef.current.style.width = `${newW}px`;
        cardRef.current.style.height = `${newH}px`;
      }
    };

    const onUp = (ev) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const newW = Math.max(220, startW + ev.clientX - startX);
      const newH = Math.max(160, startH + ev.clientY - startY);
      onResizeEnd({ width: newW, height: newH });
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div
      ref={cardRef}
      className={`revenue-card-wrapper${isDragOver ? ' drag-over' : ''}`}
      style={{ width, height }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        className="revenue-card-drag-handle"
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        title="Drag to reorder"
      >
        ⠿
      </div>
      <div
        className="project-card revenue-app-card"
        onClick={onSelect}
        style={{ cursor: 'pointer', height: 'calc(100% - 8px)' }}
        title={syncError || undefined}
      >
        <div className="project-card-accent" style={{ background: `linear-gradient(90deg, ${app.color}, transparent)` }} />
        <div className="project-card-top">
          <div className="project-logo-wrap">
            <AppLogo
              logoUrl={data.logoUrl}
              fallback={app.logo}
              color={app.color}
              size={48}
            />
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
            <div className="card-mini-stat-value" style={{ color: 'var(--green)' }}>{formatMoney(data.mrr)}</div>
            <div className="card-mini-stat-label">MRR</div>
          </div>
          <div className="card-mini-stat">
            <div className="card-mini-stat-value">{data.subscribers || 0}</div>
            <div className="card-mini-stat-label">Subscribers</div>
          </div>
          <div className="card-mini-stat">
            <div className="card-mini-stat-value" style={{ color: 'var(--indigo)' }}>{formatMoney(combinedTotal)}</div>
            <div className="card-mini-stat-label">Total Revenue</div>
          </div>
        </div>
      </div>
      <div
        className="revenue-card-resize-handle"
        onMouseDown={handleResizeStart}
        title="Drag to resize"
      />
    </div>
  );
}

export default function RevenueDashboard() {
  const [revenueData, setRevenueData] = useState({});
  const [manualSalesByApp, setManualSalesByApp] = useState({});
  const [cardLayout, setCardLayout] = useState(getDefaultLayout());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [appErrors, setAppErrors] = useState({});
  const [selectedAppId, setSelectedAppId] = useState(null);
  const [seeded, setSeeded] = useState(false);
  const [dragAppId, setDragAppId] = useState(null);
  const [dragOverAppId, setDragOverAppId] = useState(null);
  const autoSyncStarted = useRef(false);

  const refreshDashboardTotals = useCallback(async () => {
    try {
      await syncDashboardRevenueTotals(db);
    } catch (err) {
      console.error('Dashboard revenue sync failed:', err);
    }
  }, []);

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

  useEffect(() => {
    const unsubs = REVENUE_APPS.map(({ appId }) =>
      onSnapshot(collection(db, 'revenue', appId, 'manualSales'), (snapshot) => {
        const entries = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        setManualSalesByApp(prev => ({ ...prev, [appId]: entries }));
      })
    );
    return () => unsubs.forEach(u => u());
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'revenueCardLayout', LAYOUT_DOC_ID), (snapshot) => {
      if (snapshot.exists()) {
        const saved = snapshot.data();
        setCardLayout({
          order: saved.order?.length ? saved.order : getDefaultLayout().order,
          sizes: saved.sizes || {},
        });
      }
    });
    return () => unsub();
  }, []);

  const saveCardLayout = useCallback(async (updates) => {
    const next = { ...cardLayout, ...updates };
    setCardLayout(next);
    await setDoc(doc(db, 'revenueCardLayout', LAYOUT_DOC_ID), next, { merge: true });
  }, [cardLayout]);

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
      await refreshDashboardTotals();
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
  }, [refreshDashboardTotals]);

  useEffect(() => {
    if (!loading && !autoSyncStarted.current) {
      autoSyncStarted.current = true;
      handleRefresh();
    }
  }, [loading, handleRefresh]);

  useEffect(() => {
    if (!loading) {
      refreshDashboardTotals();
    }
  }, [loading, manualSalesByApp, refreshDashboardTotals]);

  const orderedApps = (cardLayout.order || [])
    .map(appId => REVENUE_APPS.find(a => a.appId === appId))
    .filter(Boolean);
  const missingApps = REVENUE_APPS.filter(a => !cardLayout.order?.includes(a.appId));
  const displayApps = [...orderedApps, ...missingApps];

  const totalRevenue = REVENUE_APPS.reduce((sum, a) => {
    const d = revenueData[a.appId] || {};
    const manual = sumManualSales(manualSalesByApp[a.appId]);
    return sum + getCombinedTotalRevenue(d, manual);
  }, 0);

  const handleSave = async (appId, updated) => {
    await setDoc(doc(db, 'revenue', appId), updated, { merge: true });
    setRevenueData(prev => ({ ...prev, [appId]: updated }));
  };

  const handleManualSaleSaved = useCallback(async () => {
    await refreshDashboardTotals();
  }, [refreshDashboardTotals]);

  const handleReorder = (targetAppId) => {
    if (!dragAppId || dragAppId === targetAppId) return;
    const order = [...(cardLayout.order || getDefaultLayout().order)];
    const fromIdx = order.indexOf(dragAppId);
    const toIdx = order.indexOf(targetAppId);
    if (fromIdx === -1 || toIdx === -1) return;
    order.splice(fromIdx, 1);
    order.splice(toIdx, 0, dragAppId);
    saveCardLayout({ order });
    setDragAppId(null);
    setDragOverAppId(null);
  };

  const handleResizeEnd = (appId, size) => {
    saveCardLayout({
      sizes: { ...cardLayout.sizes, [appId]: size },
    });
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
        manualSales={manualSalesByApp[selectedAppId] || []}
        onBack={() => setSelectedAppId(null)}
        onSave={updated => handleSave(selectedAppId, updated)}
        onManualSaleSaved={handleManualSaleSaved}
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

      <div className="revenue-cards-canvas">
        {displayApps.map(app => {
          const d = revenueData[app.appId] || {};
          const syncError = appErrors[app.appId];
          const manualTotal = sumManualSales(manualSalesByApp[app.appId]);
          return (
            <RevenueDraggableCard
              key={app.appId}
              app={app}
              data={d}
              syncError={syncError}
              manualSalesTotal={manualTotal}
              cardSize={cardLayout.sizes?.[app.appId]}
              isDragOver={dragOverAppId === app.appId}
              onSelect={() => setSelectedAppId(app.appId)}
              onDragStart={(e) => {
                setDragAppId(app.appId);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => {
                setDragAppId(null);
                setDragOverAppId(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverAppId(app.appId);
              }}
              onDragLeave={() => setDragOverAppId(null)}
              onDrop={(e) => {
                e.preventDefault();
                handleReorder(app.appId);
              }}
              onResizeEnd={(size) => handleResizeEnd(app.appId, size)}
            />
          );
        })}
      </div>
    </div>
  );
}
