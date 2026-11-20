// src/components/Dashboard.js
import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../firebase';
import { collection, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { STATUS_CONFIG } from '../data/initialData';
import AddPipelineModal from './AddPipelineModal';
import { sumClientProjectRevenue } from '../utils/revenueTotals';
import { auditedDeleteDoc } from '../lib/audit';
import { apiFetch } from '../lib/apiClient';

function getProgress(project) {
  const allTasks = [
    ...(project.milestones || []),
    ...(project.edits || [])
  ];
  if (!allTasks.length) return { done: 0, total: 0, pct: 0 };
  const done = allTasks.filter(t => t.completed).length;
  return { done, total: allTasks.length, pct: Math.round((done / allTasks.length) * 100) };
}

function getMonthlyExpenses(project) {
  return (project.expenses || []).reduce((sum, e) => {
    const amt = e.period === 'yearly' ? e.amount / 12 : e.amount;
    return sum + amt;
  }, 0);
}

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.ideation;
  return (
    <span className="status-badge" style={{ background: cfg.bg, color: cfg.color }}>
      <span
        className={`status-dot ${status === 'live' ? 'pulse' : ''}`}
        style={{ background: cfg.color }}
      />
      {cfg.label}
    </span>
  );
}

function ProjectCard({ project, onClick, projectsUnread = {} }) {
  const prog = getProgress(project);
  const monthlyRev = project.revenue?.monthly || 0;
  const monthlyExp = getMonthlyExpenses(project);

  return (
    <div className="project-card" onClick={() => onClick(project)}>
      <div className="project-card-accent" style={{ background: `linear-gradient(90deg, ${project.color}, transparent)` }} />

      <div className="project-card-top">
        <div className="project-logo-wrap">
          <div className="project-logo" style={{ background: `${project.color}18`, border: `1px solid ${project.color}30` }}>
            {project.logo}
          </div>
          <div>
            <div className="project-name">{project.name}</div>
            <div className="project-tagline">{project.tagline}</div>
          </div>
        </div>
        <StatusBadge status={project.status} />
      </div>

      <div className="progress-section">
        <div className="progress-header">
          <span>Progress</span>
          <span style={{ fontFamily: 'var(--font-mono)', color: project.color }}>
            {prog.done}/{prog.total} tasks
          </span>
        </div>
        <div className="progress-track">
          <div
            className="progress-fill"
            style={{ width: `${prog.pct}%`, background: `linear-gradient(90deg, ${project.color}, ${project.color}99)` }}
          />
        </div>
      </div>

      <div className="card-mini-stats">
        <div className="card-mini-stat">
          <div className="card-mini-stat-value" style={{ color: 'var(--green)' }}>
            {monthlyRev > 0 ? `$${monthlyRev}` : '—'}
          </div>
          <div className="card-mini-stat-label">MRR</div>
        </div>
        <div className="card-mini-stat">
          <div className="card-mini-stat-value" style={{ color: 'var(--coral)' }}>
            ${monthlyExp.toFixed(0)}
          </div>
          <div className="card-mini-stat-label">Monthly Cost</div>
        </div>
        <div className="card-mini-stat">
          <div className="card-mini-stat-value" style={{ color: 'var(--amber)' }}>
            {(project.milestones || []).filter(m => !m.completed).length}
          </div>
          <div className="card-mini-stat-label">Open Milestones</div>
        </div>
        <div className="card-mini-stat">
          <div className="card-mini-stat-value">
            {(project.edits || []).filter(e => !e.completed).length}
          </div>
          <div className="card-mini-stat-label">Open Edits</div>
        </div>
        {(projectsUnread[project.id] || 0) > 0 && (
          <div className="card-mini-stat">
            <div className="card-mini-stat-value" style={{ color: 'var(--coral)' }}>
              {projectsUnread[project.id]}
            </div>
            <div className="card-mini-stat-label">New Messages</div>
          </div>
        )}
      </div>
    </div>
  );
}

function currentMonthRange() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const lastDay = String(new Date(year, now.getMonth() + 1, 0).getDate()).padStart(2, '0');
  return {
    from: `${year}-${month}-01`,
    to: `${year}-${month}-${lastDay}`,
  };
}

function formatDashboardMoney(amount) {
  const n = Number(amount) || 0;
  return n.toLocaleString('en-US', {
    maximumFractionDigits: n % 1 === 0 ? 0 : 2,
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
  });
}

const Dashboard = React.memo(function Dashboard({ projects, pipelineItems, onSelectProject, onAddProject, onShowRevenue, projectsUnread = {} }) {
  const [dashboardSummary, setDashboardSummary] = useState(null);
  const [showAddPipelineModal, setShowAddPipelineModal] = useState(false);
  const [hoveredPipelineId, setHoveredPipelineId] = useState(null);
  const [movingPipelineId, setMovingPipelineId] = useState(null);
  const [monthlyExpensesTotal, setMonthlyExpensesTotal] = useState(0);
  const [clientMonthNet, setClientMonthNet] = useState(0);
  // Sources that failed to load. Figures that depend on them render as "—"
  // instead of a misleading $0, and a banner says what failed.
  const [loadErrors, setLoadErrors] = useState({});
  const reportLoadError = useCallback((source, err) => {
    console.error(`[Dashboard] ${source} failed to load:`, err);
    setLoadErrors((prev) => ({ ...prev, [source]: err?.message || String(err) }));
  }, []);
  const clearLoadError = useCallback((source) => {
    setLoadErrors((prev) => {
      if (!(source in prev)) return prev;
      const next = { ...prev };
      delete next[source];
      return next;
    });
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'dashboard', 'summary'), (snapshot) => {
      setDashboardSummary(snapshot.exists() ? snapshot.data() : null);
      clearLoadError('App revenue summary');
    }, (err) => reportLoadError('App revenue summary', err));
    return () => unsub();
  }, [reportLoadError, clearLoadError]);

  useEffect(() => {
    // DAL's spending this month from the Books ledger (cached monthly totals:
    // expense categories only — transfers, owner draws and amounts paid for
    // Zerbiq are not expenses).
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    let monthDoc = null;
    let cats = null;
    const publish = () => {
      if (!cats) return;
      const totals = (monthDoc && monthDoc.cat) || {};
      const spend = Object.entries(totals).reduce((sum, [catId, cents]) => (
        cats[catId] === 'expense' ? sum - cents : sum
      ), 0);
      setMonthlyExpensesTotal(spend / 100);
      clearLoadError('Expenses');
    };
    const u1 = onSnapshot(
      query(collection(db, 'ledgerMonthly'), where('companyId', '==', 'dal'), where('month', '==', month)),
      (snap) => { monthDoc = snap.empty ? null : snap.docs[0].data(); publish(); },
      (err) => reportLoadError('Expenses', err)
    );
    const u2 = onSnapshot(
      query(collection(db, 'ledgerCategories'), where('companyId', '==', 'dal')),
      (snap) => { cats = Object.fromEntries(snap.docs.map((d) => [d.id, d.data().kind])); publish(); },
      (err) => reportLoadError('Expenses', err)
    );
    return () => { u1(); u2(); };
  }, [reportLoadError, clearLoadError]);

  useEffect(() => {
    const { from, to } = currentMonthRange();
    const params = new URLSearchParams({ from, to });
    let cancelled = false;
    apiFetch(`/api/revenue-entries?${params.toString()}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to load revenue entries');
        return data;
      })
      .then((data) => {
        if (!cancelled) {
          setClientMonthNet(sumClientProjectRevenue(data.entries || []).net);
          clearLoadError('Client revenue');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setClientMonthNet(0);
          reportLoadError('Client revenue', err);
        }
      });
    return () => { cancelled = true; };
  }, [reportLoadError, clearLoadError]);

  const projectsMRR = projects.reduce((s, p) => s + (p.revenue?.monthly || 0), 0);
  const projectsRevenue = projects.reduce((s, p) => s + (p.revenue?.total || 0), 0);
  const appMonthlyRevenue = dashboardSummary?.monthlyRevenue ?? projectsMRR;
  const totalMRR = (Number(appMonthlyRevenue) || 0) + (Number(clientMonthNet) || 0);
  const totalRevenue = dashboardSummary?.totalRevenue ?? projectsRevenue;
  const totalMonthlyExp = monthlyExpensesTotal;
  const revenueFailed = Boolean(loadErrors['App revenue summary'] || loadErrors['Client revenue']);
  const expensesFailed = Boolean(loadErrors['Expenses']);
  const liveCount = projects.filter(p => p.status === 'live').length;
  const inDevCount = projects.filter(p => p.status === 'in-development').length;
  const openEdits = projects.reduce((s, p) => s + (p.edits || []).filter(e => !e.completed).length, 0);
  const openMilestones = projects.reduce((s, p) => s + (p.milestones || []).filter(m => !m.completed).length, 0);

  const totalAllTasks = projects.reduce((s, p) => {
    const all = [...(p.milestones || []), ...(p.edits || [])];
    return s + all.length;
  }, 0);
  const completedAllTasks = projects.reduce((s, p) => {
    const all = [...(p.milestones || []), ...(p.edits || [])];
    return s + all.filter(t => t.completed).length;
  }, 0);

  const byName = (a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
  const ownApps = projects.filter(p => p.type === 'own-app').slice().sort(byName);
  const clientProjects = projects.filter(p => p.type !== 'own-app').slice().sort(byName);

  const handleMoveToProject = async (item) => {
    setMovingPipelineId(item.id);
    try {
      const newProject = {
        id: item.id,
        name: item.name,
        logo: item.logo,
        color: item.color,
        type: 'own-app',
        platform: 'mobile',
        status: 'ideation',
        tagline: '',
        bundleId: '',
        launchDate: null,
        pricing: '',
        revenue: { monthly: 0, total: 0, model: 'paid' },
        expenses: [],
        techStack: [],
        milestones: [],
        edits: [],
      };
      await setDoc(doc(db, 'projects', item.id), newProject, { merge: true });
      await auditedDeleteDoc(doc(db, 'pipeline', item.id));
    } finally {
      setMovingPipelineId(null);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Mission Control</h1>
          <p className="page-subtitle">Dream App Lab — All Projects Overview</p>
        </div>
        <div className="page-actions">
          <div className="live-indicator">
            <span className="live-dot" />
            {liveCount} Live
          </div>
          <button className="btn btn-primary" onClick={onAddProject}>
            + New Project
          </button>
        </div>
      </div>

      {Object.keys(loadErrors).length > 0 && (
        <div className="dashboard-load-error" role="alert">
          <strong>Some figures couldn’t load, so they show “—” instead of a number.</strong>
          <ul>
            {Object.entries(loadErrors).map(([source, message]) => (
              <li key={source}>{source}: {message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Stats Row */}
      <div className="stats-grid">
        <div className="stat-card teal">
          <div className="stat-label">Monthly Revenue</div>
          <div className="stat-value" style={{ color: 'var(--teal)' }}>{revenueFailed ? '—' : `$${formatDashboardMoney(totalMRR)}`}</div>
          <div className="stat-sub">Across all live apps</div>
        </div>
        <div className="stat-card coral">
          <div className="stat-label">Monthly Expenses</div>
          <div className="stat-value" style={{ color: 'var(--coral)' }}>{expensesFailed ? '—' : `$${totalMonthlyExp.toFixed(0)}`}</div>
          <div className="stat-sub">This calendar month</div>
        </div>
        <div className="stat-card green">
          <div className="stat-label">Net Monthly</div>
          <div className="stat-value" style={{ color: (totalMRR - totalMonthlyExp) >= 0 ? 'var(--green)' : 'var(--coral)' }}>
            {revenueFailed || expensesFailed ? '—' : `$${(totalMRR - totalMonthlyExp).toFixed(0)}`}
          </div>
          <div className="stat-sub">Revenue minus costs</div>
        </div>
        <div
          className="stat-card amber"
          onClick={onShowRevenue}
          onKeyDown={(e) => e.key === 'Enter' && onShowRevenue?.()}
          role="button"
          tabIndex={0}
          style={{ cursor: onShowRevenue ? 'pointer' : undefined }}
        >
          <div className="stat-label">Total Revenue</div>
          <div className="stat-value" style={{ color: 'var(--amber)' }}>{loadErrors['App revenue summary'] ? '—' : `$${Number(totalRevenue || 0).toLocaleString()}`}</div>
          <div className="stat-sub">All time</div>
        </div>
        <div className="stat-card indigo">
          <div className="stat-label">Active Projects</div>
          <div className="stat-value">{projects.length}</div>
          <div className="stat-sub">{liveCount} live · {inDevCount} in dev</div>
        </div>
        <div className="stat-card electric">
          <div className="stat-label">Overall Progress</div>
          <div className="stat-value">{totalAllTasks > 0 ? Math.round((completedAllTasks / totalAllTasks) * 100) : 0}%</div>
          <div className="stat-sub">{completedAllTasks}/{totalAllTasks} tasks done</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Open Edits</div>
          <div className="stat-value">{openEdits}</div>
          <div className="stat-sub">Across all projects</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Open Milestones</div>
          <div className="stat-value">{openMilestones}</div>
          <div className="stat-sub">Pending completion</div>
        </div>
      </div>

      {/* Own Apps */}
      {ownApps.length > 0 && (
        <>
          <div className="section-header">
            <h2 className="section-title">
              <span>📱</span> Your Apps
              <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-secondary)' }}>({ownApps.length})</span>
            </h2>
          </div>
          <div className="projects-grid">
            {ownApps.map(p => (
              <ProjectCard key={p.id} project={p} onClick={onSelectProject} projectsUnread={projectsUnread} />
            ))}
          </div>
        </>
      )}

      {/* Client Projects */}
      {clientProjects.length > 0 && (
        <>
          <div className="section-header">
            <h2 className="section-title">
              <span>🌐</span> Websites & Web Apps
              <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-secondary)' }}>({clientProjects.length})</span>
            </h2>
          </div>
          <div className="projects-grid">
            {clientProjects.map(p => (
              <ProjectCard key={p.id} project={p} onClick={onSelectProject} projectsUnread={projectsUnread} />
            ))}
          </div>
        </>
      )}

      {/* Pipeline */}
      <div className="section-header">
        <h2 className="section-title">
          <span>🚀</span> App Pipeline
          <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-secondary)' }}>({(pipelineItems || []).length} ideas)</span>
        </h2>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAddPipelineModal(true)}>
          + Add Idea
        </button>
      </div>
      <div className="pipeline-grid">
        {(pipelineItems || []).map(app => (
          <div
            key={app.id}
            className="pipeline-chip"
            style={{ borderColor: `${app.color}40`, position: 'relative' }}
            onMouseEnter={() => setHoveredPipelineId(app.id)}
            onMouseLeave={() => setHoveredPipelineId(null)}
          >
            <span>{app.logo}</span>
            <span style={{ color: app.color }}>{app.name}</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              title="Move to Projects"
              disabled={movingPipelineId === app.id}
              onClick={() => handleMoveToProject(app)}
              style={{
                position: 'absolute',
                right: 8,
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: 11,
                padding: '4px 8px',
                opacity: hoveredPipelineId === app.id || movingPipelineId === app.id ? 1 : 0,
                transition: 'opacity 0.15s',
              }}
            >
              {movingPipelineId === app.id ? 'Moving...' : '→ Move to Projects'}
            </button>
          </div>
        ))}
      </div>

      {showAddPipelineModal && (
        <AddPipelineModal onClose={() => setShowAddPipelineModal(false)} />
      )}
    </div>
  );
});

export default Dashboard;
