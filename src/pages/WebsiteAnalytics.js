import React, { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../firebase';
import {
  collection, doc, getDocs, setDoc, updateDoc, query, where,
} from 'firebase/firestore';

// ── Constants ────────────────────────────────────────────────────────────────
const BRAND = '#4CC1F3';
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const SEED_SITES = [
  { id: 'dreamapplab', name: 'Dream App Lab', url: 'https://dreamapplab.com', vercelProject: 'dal-site', type: 'DAL', active: true },
  { id: 'shadyduck', name: 'The Shady Duck', url: 'https://theshadyduck.com', vercelProject: 'theshadyduck-site', type: 'DAL', active: true },
  { id: 'zerbiq', name: 'Zerbiq', url: 'https://zerbiq.com', vercelProject: 'zerbiq-web', type: 'DAL', active: true },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function relativeTime(iso) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function fmtNumber(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  page: { padding: '28px 24px', color: '#e2e8f0', minHeight: '100vh', background: '#060d1a' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 },
  title: { margin: 0, fontSize: 22, fontWeight: 700 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  refreshMeta: { fontSize: 12, color: '#64748b' },
  btn: (color, text) => ({
    background: color, border: 'none', color: text || '#000',
    padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13,
  }),
  tableWrap: { overflowX: 'auto', borderRadius: 10, border: '1px solid #1e293b' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 860 },
  th: { padding: '10px 14px', fontSize: 11, color: '#64748b', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #1e293b', whiteSpace: 'nowrap', background: '#0a1428' },
  td: { padding: '14px 14px', borderBottom: '1px solid #0d1b2e', verticalAlign: 'middle', fontSize: 13 },
  badge: (color, bg) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700, color, background: bg }),
  stateBadge: (s) => {
    const map = { READY: ['#22c55e', 'rgba(34,197,94,0.12)'], ERROR: ['#ef4444', 'rgba(239,68,68,0.12)'], BUILDING: ['#f59e0b', 'rgba(245,158,11,0.12)'] };
    const [c, bg] = map[s] || ['#94a3b8', 'rgba(148,163,184,0.12)'];
    return { display: 'inline-block', padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700, color: c, background: bg };
  },
  dot: (status) => {
    const colors = { up: '#22c55e', down: '#ef4444', paused: '#94a3b8', unknown: '#475569' };
    return { width: 12, height: 12, borderRadius: '50%', background: colors[status] || '#475569', display: 'inline-block', marginRight: 6 };
  },
  rtColor: (ms) => {
    if (ms === null) return '#64748b';
    if (ms < 500) return '#22c55e';
    if (ms < 1500) return '#f59e0b';
    return '#ef4444';
  },
  actionBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: '2px 4px', color: '#94a3b8' },
};

// ── Skeleton row ─────────────────────────────────────────────────────────────
function SkeletonRow() {
  const shimmer = { background: 'linear-gradient(90deg, #1e293b 25%, #334155 50%, #1e293b 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite', borderRadius: 4 };
  return (
    <tr>
      <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
      {[200, 60, 80, 70, 70, 80, 60, 120, 70].map((w, i) => (
        <td key={i} style={s.td}><div style={{ ...shimmer, height: 14, width: w }} /></td>
      ))}
    </tr>
  );
}

// ── Add/Edit Site Modal ───────────────────────────────────────────────────────
function SiteModal({ site, onClose, onSaved }) {
  const [name, setName] = useState(site?.name || '');
  const [url, setUrl] = useState(site?.url || '');
  const [type, setType] = useState(site?.type || 'DAL');
  const [vercelProject, setVercelProject] = useState(site?.vercelProject || '');
  const [active, setActive] = useState(site?.active !== false);
  const [contactQuery, setContactQuery] = useState('');
  const [contacts, setContacts] = useState([]);
  const [filteredContacts, setFilteredContacts] = useState([]);
  const [selectedContact, setSelectedContact] = useState(site?.contactId ? { id: site.contactId, name: site.contactName } : null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getDocs(collection(db, 'contacts')).then((snap) => {
      setContacts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!contactQuery.trim()) { setFilteredContacts([]); return; }
    const q = contactQuery.toLowerCase();
    setFilteredContacts(contacts.filter((c) =>
      (c.name || '').toLowerCase().includes(q) || (c.company || '').toLowerCase().includes(q)
    ).slice(0, 8));
  }, [contactQuery, contacts]);

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    if (!url.trim() || !url.startsWith('https://')) { setError('URL must start with https://'); return; }
    setSaving(true); setError('');
    try {
      const id = site?.id || slugify(name);
      const payload = {
        name: name.trim(), url: url.trim(), type,
        vercelProject: vercelProject.trim() || null,
        active,
        contactId: selectedContact?.id || null,
        contactName: selectedContact?.name || null,
        updatedAt: new Date().toISOString(),
      };
      if (!site) payload.createdAt = new Date().toISOString();
      await setDoc(doc(db, 'monitoredSites', id), payload, { merge: true });
      onSaved();
    } catch (e) {
      setError(e.message); setSaving(false);
    }
  };

  const inputStyle = { width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '9px 12px', fontSize: 13, outline: 'none', fontFamily: 'inherit', marginBottom: 0, boxSizing: 'border-box' };
  const labelStyle = { display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4, marginTop: 14 };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 14, padding: 28, width: 440, maxHeight: '90vh', overflowY: 'auto', color: '#e2e8f0' }}>
        <h3 style={{ margin: '0 0 18px', fontSize: 16 }}>{site ? 'Edit Site' : 'Add Site'}</h3>
        {error && <p style={{ color: '#f87171', fontSize: 13, marginBottom: 10 }}>{error}</p>}

        <label style={labelStyle}>Site Name *</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dream App Lab" style={inputStyle} />

        <label style={labelStyle}>URL *</label>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" style={inputStyle} />

        <label style={labelStyle}>Type</label>
        <select value={type} onChange={(e) => setType(e.target.value)}
          style={{ ...inputStyle, appearance: 'none' }}>
          <option value="DAL">DAL</option>
          <option value="Client">Client</option>
        </select>

        <label style={labelStyle}>Vercel Project Name (optional)</label>
        <input value={vercelProject} onChange={(e) => setVercelProject(e.target.value)} placeholder="my-project-slug" style={inputStyle} />

        {type === 'Client' && (
          <>
            <label style={labelStyle}>Contact</label>
            <div style={{ position: 'relative' }}>
              <input
                value={selectedContact ? `${selectedContact.name}${selectedContact.company ? ` — ${selectedContact.company}` : ''}` : contactQuery}
                onChange={(e) => { setContactQuery(e.target.value); setSelectedContact(null); setShowDropdown(true); }}
                onFocus={() => setShowDropdown(true)}
                placeholder="Search contacts..."
                style={inputStyle}
              />
              {showDropdown && filteredContacts.length > 0 && !selectedContact && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1e293b', border: '1px solid #334155', borderRadius: 8, zIndex: 10, maxHeight: 180, overflowY: 'auto' }}>
                  {filteredContacts.map((c) => (
                    <button key={c.id} onClick={() => { setSelectedContact(c); setContactQuery(''); setShowDropdown(false); }}
                      style={{ display: 'block', width: '100%', background: 'none', border: 'none', color: '#e2e8f0', padding: '8px 12px', textAlign: 'left', cursor: 'pointer', fontSize: 13 }}>
                      {c.name}{c.company ? <span style={{ color: '#94a3b8', marginLeft: 6 }}>— {c.company}</span> : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 16 }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ width: 16, height: 16 }} />
          <span>Active</span>
        </label>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22 }}>
          <button onClick={onClose} style={{ background: '#1e293b', border: 'none', color: '#94a3b8', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ ...s.btn(BRAND), opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving…' : 'Save Site'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Site row ─────────────────────────────────────────────────────────────────
function SiteRow({ data, onEdit, onArchive }) {
  const { id, name, url, type, vercelProject, uptime, visitors, deploy, errors } = data;
  const isDown = uptime?.status === 'down';

  return (
    <tr style={{ borderLeft: isDown ? '3px solid #ef4444' : '3px solid transparent', transition: 'background 0.15s' }}
      onMouseEnter={(e) => e.currentTarget.style.background = '#0a1428'}
      onMouseLeave={(e) => e.currentTarget.style.background = ''}>

      {/* Name + URL */}
      <td style={s.td}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{name}</div>
        <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#64748b', textDecoration: 'none' }}>{url}</a>
      </td>

      {/* Type */}
      <td style={s.td}>
        <span style={s.badge(type === 'DAL' ? '#60a5fa' : '#4ade80', type === 'DAL' ? 'rgba(96,165,250,0.12)' : 'rgba(74,222,128,0.12)')}>
          {type}
        </span>
      </td>

      {/* Uptime */}
      <td style={s.td}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={s.dot(uptime?.status)} />
          <span style={{ fontSize: 12, color: uptime?.status === 'up' ? '#22c55e' : uptime?.status === 'down' ? '#ef4444' : '#94a3b8' }}>
            {uptime?.status === 'up' ? 'Up' : uptime?.status === 'down' ? 'Down' : uptime?.status === 'paused' ? 'Paused' : 'Unknown'}
          </span>
        </div>
        {uptime?.percent30d !== null && uptime?.percent30d !== undefined && (
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{uptime.percent30d.toFixed(2)}%</div>
        )}
      </td>

      {/* Response time */}
      <td style={s.td}>
        {uptime?.responseTimeMs !== null && uptime?.responseTimeMs !== undefined
          ? <span style={{ color: s.rtColor(uptime.responseTimeMs), fontWeight: 600 }}>{uptime.responseTimeMs} ms</span>
          : <span style={{ color: '#475569' }}>—</span>}
      </td>

      {/* Visitors 30d */}
      <td style={s.td}>
        {visitors?.analyticsEnabled
          ? <span style={{ color: '#e2e8f0' }}>{fmtNumber(visitors.last30d)}</span>
          : visitors?.analyticsEnabled === false && vercelProject
            ? <a href={`https://vercel.com/dream-app-lab/${vercelProject}/analytics`} target="_blank" rel="noreferrer"
                style={{ color: '#f97316', fontSize: 11, textDecoration: 'none' }}>Enable Analytics</a>
            : <span style={{ color: '#475569' }}>—</span>}
      </td>

      {/* Page views 30d */}
      <td style={s.td}>
        {visitors?.analyticsEnabled
          ? <span style={{ color: '#e2e8f0' }}>{fmtNumber(visitors.pageViews30d)}</span>
          : <span style={{ color: '#475569' }}>—</span>}
      </td>

      {/* Errors 7d */}
      <td style={s.td}>
        {errors?.last7d === null || errors?.last7d === undefined
          ? <span style={{ color: '#475569' }}>—</span>
          : errors.last7d > 0
            ? <span style={s.badge('#fff', '#ef4444')}>{errors.last7d}</span>
            : <span style={{ color: '#22c55e', fontWeight: 600 }}>0</span>}
      </td>

      {/* Last Deploy */}
      <td style={s.td}>
        {deploy?.lastDeployDate
          ? <>
              <div style={{ fontSize: 12, color: '#cbd5e1' }}>{relativeTime(deploy.lastDeployDate)}</div>
              {deploy.state && <span style={s.stateBadge(deploy.state)}>{deploy.state}</span>}
            </>
          : <span style={{ color: '#475569' }}>—</span>}
      </td>

      {/* Actions */}
      <td style={s.td}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <a href={url} target="_blank" rel="noreferrer" title="Open site" style={{ ...s.actionBtn, textDecoration: 'none', display: 'inline-block' }}>🔗</a>
          <button onClick={() => onEdit(data)} title="Edit" style={s.actionBtn}>✏️</button>
          <button onClick={() => onArchive(id)} title="Archive" style={s.actionBtn}>🗑️</button>
        </div>
      </td>
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function WebsiteAnalytics() {
  const [sites, setSites] = useState([]);
  const [analyticsData, setAnalyticsData] = useState({});
  const [loading, setLoading] = useState(true);
  const [apiLoading, setApiLoading] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingSite, setEditingSite] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState('');
  const timerRef = useRef(null);

  // ── Seed + load Firestore sites ────────────────────────────────────────────
  const loadSites = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, 'monitoredSites'));
      if (snap.empty) {
        // Seed initial sites
        await Promise.all(SEED_SITES.map((site) =>
          setDoc(doc(db, 'monitoredSites', site.id), { ...site, createdAt: new Date().toISOString() })
        ));
        setSites(SEED_SITES);
      } else {
        setSites(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
    } catch (e) {
      setError('Failed to load sites: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Fetch analytics from API ───────────────────────────────────────────────
  const fetchAnalytics = useCallback(async () => {
    setApiLoading(true);
    setError('');
    try {
      const res = await fetch('/api/site-analytics');
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'API error');
      const map = {};
      (data.sites || []).forEach((s) => { map[s.id] = s; });
      setAnalyticsData(map);
      setLastRefreshed(new Date());
    } catch (e) {
      console.error('Analytics fetch error:', e.message);
      setError('Failed to fetch analytics: ' + e.message);
    } finally {
      setApiLoading(false);
    }
  }, []);

  // ── Init ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    loadSites().then(() => fetchAnalytics());
  }, [loadSites, fetchAnalytics]);

  // ── Auto-refresh every 5 min ───────────────────────────────────────────────
  useEffect(() => {
    timerRef.current = setInterval(() => fetchAnalytics(), REFRESH_INTERVAL_MS);
    return () => clearInterval(timerRef.current);
  }, [fetchAnalytics]);

  // ── Archive ────────────────────────────────────────────────────────────────
  const handleArchive = async (id) => {
    if (!window.confirm('Archive this site?')) return;
    try {
      await updateDoc(doc(db, 'monitoredSites', id), { active: false });
      setSites((prev) => prev.map((s) => s.id === id ? { ...s, active: false } : s));
    } catch (e) { alert('Archive failed: ' + e.message); }
  };

  // ── Derived data ───────────────────────────────────────────────────────────
  const displaySites = sites
    .filter((s) => showArchived || s.active !== false)
    .sort((a, b) => a.name.localeCompare(b.name));

  const mergedRows = displaySites.map((site) => ({
    ...site,
    ...(analyticsData[site.id] || {}),
  }));

  // ── Refresh ────────────────────────────────────────────────────────────────
  const handleRefresh = () => {
    // Bust cache for all active sites then re-fetch
    const bust = sites.filter((s) => s.active !== false).map((s) =>
      fetch(`/api/site-analytics?siteId=${s.id}&refresh=true`).catch(() => null)
    );
    Promise.all(bust).finally(() => fetchAnalytics());
  };

  if (loading) {
    return (
      <div style={{ ...s.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#94a3b8' }}>Loading sites…</div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <h1 style={s.title}>📊 Site Analytics</h1>
        <div style={s.headerRight}>
          {lastRefreshed && (
            <span style={s.refreshMeta}>
              Updated {relativeTime(lastRefreshed.toISOString())}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={apiLoading}
            title="Refresh all"
            style={{ ...s.btn('#1e293b', '#94a3b8'), opacity: apiLoading ? 0.6 : 1, fontSize: 12 }}
          >
            {apiLoading ? '⟳ Refreshing…' : '⟳ Refresh'}
          </button>
          <button
            onClick={() => setShowArchived((v) => !v)}
            style={{ ...s.btn('#1e293b', '#94a3b8'), fontSize: 12 }}
          >
            {showArchived ? 'Hide Archived' : 'Show Archived'}
          </button>
          <button onClick={() => { setEditingSite(null); setShowModal(true); }} style={s.btn(BRAND)}>
            + Add Site
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#fca5a5' }}>
          {error}
        </div>
      )}

      {/* Table */}
      {displaySites.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '64px 24px', color: '#64748b' }}>
          <p style={{ fontSize: 16, marginBottom: 8 }}>No sites added yet.</p>
          <p style={{ fontSize: 13 }}>Click <strong>+ Add Site</strong> to get started.</p>
        </div>
      ) : (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                {['Site', 'Type', 'Uptime', 'Response', 'Visitors (30d)', 'Page Views (30d)', 'Errors (7d)', 'Last Deploy', 'Actions'].map((h) => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mergedRows.map((row) =>
                apiLoading && !analyticsData[row.id]
                  ? <SkeletonRow key={row.id} />
                  : <SiteRow key={row.id} data={row} onEdit={(d) => { setEditingSite(d); setShowModal(true); }} onArchive={handleArchive} />
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit modal */}
      {showModal && (
        <SiteModal
          site={editingSite}
          onClose={() => { setShowModal(false); setEditingSite(null); }}
          onSaved={() => {
            setShowModal(false);
            setEditingSite(null);
            loadSites().then(() => fetchAnalytics());
          }}
        />
      )}
    </div>
  );
}
