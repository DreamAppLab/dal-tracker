import React, { useCallback, useEffect, useMemo, useState } from 'react';

const ADMIN_DATA_URL =
  'https://us-central1-familythread-prod.cloudfunctions.net/getAdminData';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: 'Users' },
  { id: 'families', label: 'Families' },
  { id: 'attrition', label: 'Attrition' },
];

const USER_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'thread', label: 'Thread' },
  { id: 'tapestry', label: 'Tapestry' },
  { id: 'no-email', label: 'No Email' },
  { id: 'has-trial', label: 'Has Trial' },
];

const FAMILY_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'grace', label: 'Grace Period' },
  { id: 'tapestry', label: 'Tapestry' },
  { id: 'thread', label: 'Thread' },
];

const MS_30_DAYS = 30 * 24 * 60 * 60 * 1000;

function toDate(value) {
  if (value == null || value === '') return null;
  if (typeof value?.toDate === 'function') {
    try {
      return value.toDate();
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(value, missingLabel = '—') {
  const d = toDate(value);
  if (!d) return missingLabel;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function dateSortValue(value) {
  const d = toDate(value);
  return d ? d.getTime() : 0;
}

function PlanBadge({ plan }) {
  const normalized = (plan || '').toLowerCase();
  const label = normalized || 'unknown';
  const className =
    normalized === 'tapestry'
      ? 'ft-badge ft-badge-tapestry'
      : normalized === 'thread'
        ? 'ft-badge ft-badge-thread'
        : 'ft-badge ft-badge-unknown';
  return <span className={className}>{label}</span>;
}

function StatusBadge({ status }) {
  const normalized = status == null || status === '' ? 'unknown' : String(status).toLowerCase();
  const className =
    normalized === 'active'
      ? 'ft-badge ft-badge-active'
      : normalized === 'grace'
        ? 'ft-badge ft-badge-grace'
        : 'ft-badge ft-badge-unknown';
  return <span className={className}>{normalized}</span>;
}

function EmptyState({ message }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">📭</div>
      <div className="empty-state-text">{message}</div>
    </div>
  );
}

function LoadingBlock({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
    </div>
  );
}

function SearchInput({ value, onChange, placeholder }) {
  return (
    <input
      className="form-input ft-search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

function FilterButtons({ filters, active, onChange }) {
  return (
    <div className="todo-filters" style={{ marginBottom: 0 }}>
      {filters.map((f) => (
        <button
          key={f.id}
          type="button"
          className={`todo-filter-btn ${active === f.id ? 'active' : ''}`}
          onClick={() => onChange(f.id)}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

function DetailRow({ label, children }) {
  return (
    <div className="ft-detail-row">
      <span className="ft-detail-label">{label}</span>
      <span className="ft-detail-value">{children}</span>
    </div>
  );
}

function OverviewTab({ users, families }) {
  const planBreakdown = useMemo(() => {
    let thread = 0;
    let tapestry = 0;
    let other = 0;
    users.forEach((u) => {
      const plan = (u.plan || '').toLowerCase();
      if (plan === 'thread') thread += 1;
      else if (plan === 'tapestry') tapestry += 1;
      else other += 1;
    });
    return { thread, tapestry, other };
  }, [users]);

  const statusBreakdown = useMemo(() => {
    let active = 0;
    let grace = 0;
    let missing = 0;
    families.forEach((f) => {
      if (f.status == null || f.status === '') missing += 1;
      else if (String(f.status).toLowerCase() === 'active') active += 1;
      else if (String(f.status).toLowerCase() === 'grace') grace += 1;
      else missing += 1;
    });
    return { active, grace, missing };
  }, [families]);

  const atRiskCount = families.filter((f) => f.gracePeriodEndsAt != null).length;
  const missingEmailCount = users.filter((u) => !u.email).length;

  return (
    <div className="data-section">
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card teal">
          <div className="stat-label">Total Users</div>
          <div className="stat-value" style={{ color: 'var(--teal)' }}>{users.length}</div>
          <div className="stat-sub">docs in users</div>
        </div>
        <div className="stat-card indigo">
          <div className="stat-label">Total Families</div>
          <div className="stat-value" style={{ color: 'var(--indigo)' }}>{families.length}</div>
          <div className="stat-sub">docs in families</div>
        </div>
        <div className="stat-card amber">
          <div className="stat-label">At-Risk Families</div>
          <div className="stat-value" style={{ color: 'var(--amber)' }}>{atRiskCount}</div>
          <div className="stat-sub">gracePeriodEndsAt set</div>
        </div>
        <div className="stat-card coral">
          <div className="stat-label">Missing Email</div>
          <div className="stat-value" style={{ color: 'var(--coral)' }}>{missingEmailCount}</div>
          <div className="stat-sub">data quality flag</div>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card green">
          <div className="stat-label">Plan Breakdown (Users)</div>
          <div className="stat-value" style={{ fontSize: 18 }}>
            Thread {planBreakdown.thread} · Tapestry {planBreakdown.tapestry}
          </div>
          <div className="stat-sub">
            {planBreakdown.other > 0 ? `${planBreakdown.other} other/missing` : 'thread vs tapestry'}
          </div>
        </div>
        <div className="stat-card electric">
          <div className="stat-label">Family Status</div>
          <div className="stat-value" style={{ fontSize: 18 }}>
            Active {statusBreakdown.active} · Grace {statusBreakdown.grace} · Null {statusBreakdown.missing}
          </div>
          <div className="stat-sub">active vs grace vs null/missing</div>
        </div>
      </div>
    </div>
  );
}

function UsersTab({ users }) {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('displayName');
  const [sortDir, setSortDir] = useState('asc');
  const [expandedId, setExpandedId] = useState(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      const plan = (u.plan || '').toLowerCase();
      if (filter === 'thread' && plan !== 'thread') return false;
      if (filter === 'tapestry' && plan !== 'tapestry') return false;
      if (filter === 'no-email' && u.email) return false;
      if (filter === 'has-trial' && u.trialEndsAt == null) return false;
      if (!q) return true;
      const haystack = [
        u.displayName,
        u.email,
        u.plan,
        u.id,
        u.revenueCatId,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [users, filter, search]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      let av;
      let bv;
      switch (sortKey) {
        case 'email':
          av = (a.email || '').toLowerCase();
          bv = (b.email || '').toLowerCase();
          break;
        case 'plan':
          av = (a.plan || '').toLowerCase();
          bv = (b.plan || '').toLowerCase();
          break;
        case 'familyCount':
          av = Array.isArray(a.familyIds) ? a.familyIds.length : 0;
          bv = Array.isArray(b.familyIds) ? b.familyIds.length : 0;
          break;
        case 'createdAt':
          av = dateSortValue(a.createdAt);
          bv = dateSortValue(b.createdAt);
          break;
        case 'trialEndsAt':
          av = dateSortValue(a.trialEndsAt);
          bv = dateSortValue(b.trialEndsAt);
          break;
        case 'pushToken':
          av = a.pushToken ? 1 : 0;
          bv = b.pushToken ? 1 : 0;
          break;
        default:
          av = (a.displayName || '').toLowerCase();
          bv = (b.displayName || '').toLowerCase();
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortMarker = (key) => (sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');

  return (
    <div className="data-section">
      <div className="ft-toolbar">
        <FilterButtons filters={USER_FILTERS} active={filter} onChange={setFilter} />
        <SearchInput value={search} onChange={setSearch} placeholder="Search users…" />
      </div>

      {sorted.length === 0 ? (
        <EmptyState message="No users match this filter." />
      ) : (
        <div className="subscriptions-table-wrap">
          <table className="subscriptions-table ft-table">
            <thead>
              <tr>
                <th onClick={() => toggleSort('displayName')} className="ft-sortable">
                  displayName{sortMarker('displayName')}
                </th>
                <th onClick={() => toggleSort('email')} className="ft-sortable">
                  email{sortMarker('email')}
                </th>
                <th onClick={() => toggleSort('plan')} className="ft-sortable">
                  plan{sortMarker('plan')}
                </th>
                <th onClick={() => toggleSort('familyCount')} className="ft-sortable">
                  families{sortMarker('familyCount')}
                </th>
                <th onClick={() => toggleSort('createdAt')} className="ft-sortable">
                  createdAt{sortMarker('createdAt')}
                </th>
                <th onClick={() => toggleSort('trialEndsAt')} className="ft-sortable">
                  trialEndsAt{sortMarker('trialEndsAt')}
                </th>
                <th onClick={() => toggleSort('pushToken')} className="ft-sortable">
                  pushToken{sortMarker('pushToken')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((u) => {
                const familyCount = Array.isArray(u.familyIds) ? u.familyIds.length : 0;
                const open = expandedId === u.id;
                return (
                  <React.Fragment key={u.id}>
                    <tr
                      className={`ft-row ${open ? 'ft-row-open' : ''}`}
                      onClick={() => setExpandedId(open ? null : u.id)}
                    >
                      <td>{u.displayName || '—'}</td>
                      <td>{u.email || '—'}</td>
                      <td><PlanBadge plan={u.plan} /></td>
                      <td>{familyCount}</td>
                      <td>{formatDate(u.createdAt)}</td>
                      <td>{formatDate(u.trialEndsAt)}</td>
                      <td>{u.pushToken ? '✓' : '✗'}</td>
                    </tr>
                    {open && (
                      <tr className="ft-expand-row">
                        <td colSpan={7}>
                          <div className="ft-expand-panel">
                            <DetailRow label="User ID">{u.id}</DetailRow>
                            <DetailRow label="activeFamily">{u.activeFamily || '—'}</DetailRow>
                            <DetailRow label="familyIds">
                              {Array.isArray(u.familyIds) && u.familyIds.length > 0
                                ? u.familyIds.join(', ')
                                : '—'}
                            </DetailRow>
                            <DetailRow label="revenueCatId">{u.revenueCatId || '—'}</DetailRow>
                            <DetailRow label="theme">{u.theme || '—'}</DetailRow>
                            <DetailRow label="language">{u.language || '—'}</DetailRow>
                            <DetailRow label="photoURL">{u.photoURL || u.avatarUrl || '—'}</DetailRow>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FamiliesTab({ families }) {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return families.filter((f) => {
      const plan = (f.plan || '').toLowerCase();
      const status = f.status == null || f.status === '' ? '' : String(f.status).toLowerCase();
      if (filter === 'active' && status !== 'active') return false;
      if (filter === 'grace' && status !== 'grace') return false;
      if (filter === 'tapestry' && plan !== 'tapestry') return false;
      if (filter === 'thread' && plan !== 'thread') return false;
      if (!q) return true;
      const haystack = [f.name, f.plan, f.status, f.id, f.inviteCode, f.adminUserId]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [families, filter, search]);

  return (
    <div className="data-section">
      <div className="ft-toolbar">
        <FilterButtons filters={FAMILY_FILTERS} active={filter} onChange={setFilter} />
        <SearchInput value={search} onChange={setSearch} placeholder="Search families…" />
      </div>

      {filtered.length === 0 ? (
        <EmptyState message="No families match this filter." />
      ) : (
        <div className="subscriptions-table-wrap">
          <table className="subscriptions-table ft-table">
            <thead>
              <tr>
                <th>name</th>
                <th>plan</th>
                <th>status</th>
                <th>memberCount</th>
                <th>lastDigestSentAt</th>
                <th>gracePeriodEndsAt</th>
                <th>createdAt</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((f) => {
                const open = expandedId === f.id;
                const settings = f.settings && typeof f.settings === 'object' ? f.settings : {};
                return (
                  <React.Fragment key={f.id}>
                    <tr
                      className={`ft-row ${open ? 'ft-row-open' : ''}`}
                      onClick={() => setExpandedId(open ? null : f.id)}
                    >
                      <td>{f.name || '—'}</td>
                      <td><PlanBadge plan={f.plan} /></td>
                      <td><StatusBadge status={f.status} /></td>
                      <td>{f.memberCount ?? (Array.isArray(f.memberUserIds) ? f.memberUserIds.length : '—')}</td>
                      <td>{formatDate(f.lastDigestSentAt, 'Never')}</td>
                      <td>{formatDate(f.gracePeriodEndsAt)}</td>
                      <td>{formatDate(f.createdAt)}</td>
                    </tr>
                    {open && (
                      <tr className="ft-expand-row">
                        <td colSpan={7}>
                          <div className="ft-expand-panel">
                            <DetailRow label="Family ID">{f.id}</DetailRow>
                            <DetailRow label="adminUserId">{f.adminUserId || '—'}</DetailRow>
                            <DetailRow label="inviteCode">{f.inviteCode || '—'}</DetailRow>
                            <DetailRow label="language">{f.language || '—'}</DetailRow>
                            <DetailRow label="promptFrequency">{f.promptFrequency || '—'}</DetailRow>
                            <DetailRow label="digestStartDate">{formatDate(f.digestStartDate)}</DetailRow>
                            <DetailRow label="settings.digestDay">{settings.digestDay ?? '—'}</DetailRow>
                            <DetailRow label="settings.digestTime">{settings.digestTime ?? '—'}</DetailRow>
                            <DetailRow label="settings.frequency">{settings.frequency ?? '—'}</DetailRow>
                            <DetailRow label="settings.visibilityMode">{settings.visibilityMode ?? '—'}</DetailRow>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AttritionTab({ users, families }) {
  const graceFamilies = useMemo(() => {
    return families
      .filter((f) => f.gracePeriodEndsAt != null)
      .sort((a, b) => dateSortValue(a.gracePeriodEndsAt) - dateSortValue(b.gracePeriodEndsAt));
  }, [families]);

  const trialUsers = useMemo(() => {
    return users
      .filter((u) => u.trialEndsAt != null)
      .sort((a, b) => dateSortValue(a.trialEndsAt) - dateSortValue(b.trialEndsAt));
  }, [users]);

  const staleDigests = useMemo(() => {
    const cutoff = Date.now() - MS_30_DAYS;
    return families
      .filter((f) => {
        const d = toDate(f.lastDigestSentAt);
        if (!d) return true;
        return d.getTime() < cutoff;
      })
      .sort((a, b) => dateSortValue(a.lastDigestSentAt) - dateSortValue(b.lastDigestSentAt));
  }, [families]);

  const noFamilyUsers = useMemo(() => {
    return users.filter((u) => !Array.isArray(u.familyIds) || u.familyIds.length === 0);
  }, [users]);

  return (
    <div className="data-section ft-attrition">
      <section className="ft-attrition-section">
        <div className="data-section-header">
          <h2 className="data-section-title">Grace Period Families</h2>
          <span className="tab-count">{graceFamilies.length}</span>
        </div>
        {graceFamilies.length === 0 ? (
          <EmptyState message="No families currently in grace period." />
        ) : (
          <div className="subscriptions-table-wrap">
            <table className="subscriptions-table ft-table">
              <thead>
                <tr>
                  <th>name</th>
                  <th>plan</th>
                  <th>gracePeriodEndsAt</th>
                  <th>memberCount</th>
                </tr>
              </thead>
              <tbody>
                {graceFamilies.map((f) => (
                  <tr key={f.id}>
                    <td>{f.name || '—'}</td>
                    <td><PlanBadge plan={f.plan} /></td>
                    <td>{formatDate(f.gracePeriodEndsAt)}</td>
                    <td>{f.memberCount ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="ft-attrition-section">
        <div className="data-section-header">
          <h2 className="data-section-title">Trial Users</h2>
          <span className="tab-count">{trialUsers.length}</span>
        </div>
        {trialUsers.length === 0 ? (
          <EmptyState message="No users with an active trial end date." />
        ) : (
          <div className="subscriptions-table-wrap">
            <table className="subscriptions-table ft-table">
              <thead>
                <tr>
                  <th>displayName</th>
                  <th>email</th>
                  <th>plan</th>
                  <th>trialEndsAt</th>
                </tr>
              </thead>
              <tbody>
                {trialUsers.map((u) => (
                  <tr key={u.id}>
                    <td>{u.displayName || '—'}</td>
                    <td>{u.email || '—'}</td>
                    <td><PlanBadge plan={u.plan} /></td>
                    <td>{formatDate(u.trialEndsAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="ft-attrition-section">
        <div className="data-section-header">
          <h2 className="data-section-title">No Digest in 30+ Days</h2>
          <span className="tab-count">{staleDigests.length}</span>
        </div>
        {staleDigests.length === 0 ? (
          <EmptyState message="All families have a recent digest." />
        ) : (
          <div className="subscriptions-table-wrap">
            <table className="subscriptions-table ft-table">
              <thead>
                <tr>
                  <th>name</th>
                  <th>memberCount</th>
                  <th>lastDigestSentAt</th>
                </tr>
              </thead>
              <tbody>
                {staleDigests.map((f) => (
                  <tr key={f.id}>
                    <td>{f.name || '—'}</td>
                    <td>{f.memberCount ?? '—'}</td>
                    <td>{formatDate(f.lastDigestSentAt, 'Never')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="ft-attrition-section">
        <div className="data-section-header">
          <h2 className="data-section-title">Users With No Family</h2>
          <span className="tab-count">{noFamilyUsers.length}</span>
        </div>
        {noFamilyUsers.length === 0 ? (
          <EmptyState message="Every user belongs to at least one family." />
        ) : (
          <div className="subscriptions-table-wrap">
            <table className="subscriptions-table ft-table">
              <thead>
                <tr>
                  <th>displayName</th>
                  <th>email</th>
                  <th>createdAt</th>
                </tr>
              </thead>
              <tbody>
                {noFamilyUsers.map((u) => (
                  <tr key={u.id}>
                    <td>{u.displayName || '—'}</td>
                    <td>{u.email || '—'}</td>
                    <td>{formatDate(u.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

async function fetchAdminData() {
  const secret = process.env.REACT_APP_FT_ADMIN_SECRET;
  if (!secret) {
    throw new Error(
      'Missing REACT_APP_FT_ADMIN_SECRET. Add it to your env and restart the dev server.'
    );
  }

  const response = await fetch(ADMIN_DATA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': secret,
    },
  });

  if (!response.ok) {
    let detail = '';
    try {
      detail = await response.text();
    } catch {
      detail = '';
    }
    throw new Error(
      detail
        ? `Admin data request failed (${response.status}): ${detail}`
        : `Admin data request failed (${response.status})`
    );
  }

  return response.json();
}

export function FamilyThreadAdminTab() {
  const [tab, setTab] = useState('overview');
  const [users, setUsers] = useState([]);
  const [families, setFamilies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fetchedAt, setFetchedAt] = useState(null);

  const loadAdminData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchAdminData();
      setUsers(Array.isArray(data?.users) ? data.users : []);
      setFamilies(Array.isArray(data?.families) ? data.families : []);
      setFetchedAt(data?.timestamp || new Date().toISOString());
    } catch (err) {
      setError(err?.message || 'Failed to load FamilyThread admin data.');
      setUsers([]);
      setFamilies([]);
      setFetchedAt(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData]);

  return (
    <div className="ft-admin-tab">
      <div
        className="data-section"
        style={{ paddingBottom: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
      >
        <p className="page-subtitle" style={{ margin: 0 }}>
          Read-only familythread-prod data
          {fetchedAt ? ` · Updated ${formatDate(fetchedAt)}` : ''}
        </p>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={loadAdminData}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="tabs-bar">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab-btn ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'users' && !loading && <span className="tab-count">{users.length}</span>}
            {t.id === 'families' && !loading && <span className="tab-count">{families.length}</span>}
          </button>
        ))}
      </div>

      {error && (
        <div className="data-section">
          <div className="ft-error">{error}</div>
        </div>
      )}

      {!error && loading && <LoadingBlock label="Loading FamilyThread data…" />}

      {!error && !loading && tab === 'overview' && (
        <OverviewTab users={users} families={families} />
      )}
      {!error && !loading && tab === 'users' && <UsersTab users={users} />}
      {!error && !loading && tab === 'families' && <FamiliesTab families={families} />}
      {!error && !loading && tab === 'attrition' && (
        <AttritionTab users={users} families={families} />
      )}
    </div>
  );
}

export default function FamilyThreadAdmin() {
  return (
    <div className="page ft-admin-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">FamilyThread Admin</h1>
          <p className="page-subtitle">
            Read-only view of familythread-prod users, families, and attrition risk
          </p>
        </div>
        <div className="live-indicator">
          <span className="live-dot" />
          Read-only
        </div>
      </div>
      <FamilyThreadAdminTab />
    </div>
  );
}
