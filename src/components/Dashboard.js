// src/components/Dashboard.js
import React from 'react';
import { STATUS_CONFIG } from '../data/initialData';

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

function ProjectCard({ project, onClick }) {
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
            {monthlyRev > 0 ? `$${monthlyRev}` : '???'}
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
      </div>
    </div>
  );
}

export default function Dashboard({ projects, pipeline, onSelectProject, onAddProject }) {
  const totalMRR = projects.reduce((s, p) => s + (p.revenue?.monthly || 0), 0);
  const totalRevenue = projects.reduce((s, p) => s + (p.revenue?.total || 0), 0);
  const totalMonthlyExp = projects.reduce((s, p) => s + getMonthlyExpenses(p), 0);
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

  const ownApps = projects.filter(p => p.type === 'own-app');
  const clientProjects = projects.filter(p => p.type !== 'own-app');

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Mission Control</h1>
          <p className="page-subtitle">Dream App Lab ??? All Projects Overview</p>
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

      {/* Stats Row */}
      <div className="stats-grid">
        <div className="stat-card teal">
          <div className="stat-label">Monthly Revenue</div>
          <div className="stat-value" style={{ color: 'var(--teal)' }}>${totalMRR}</div>
          <div className="stat-sub">Across all live apps</div>
        </div>
        <div className="stat-card coral">
          <div className="stat-label">Monthly Expenses</div>
          <div className="stat-value" style={{ color: 'var(--coral)' }}>${totalMonthlyExp.toFixed(0)}</div>
          <div className="stat-sub">APIs, hosting, tools</div>
        </div>
        <div className="stat-card green">
          <div className="stat-label">Net Monthly</div>
          <div className="stat-value" style={{ color: (totalMRR - totalMonthlyExp) >= 0 ? 'var(--green)' : 'var(--coral)' }}>
            ${(totalMRR - totalMonthlyExp).toFixed(0)}
          </div>
          <div className="stat-sub">Revenue minus costs</div>
        </div>
        <div className="stat-card amber">
          <div className="stat-label">Total Revenue</div>
          <div className="stat-value" style={{ color: 'var(--amber)' }}>${totalRevenue.toLocaleString()}</div>
          <div className="stat-sub">All time</div>
        </div>
        <div className="stat-card indigo">
          <div className="stat-label">Active Projects</div>
          <div className="stat-value">{projects.length}</div>
          <div className="stat-sub">{liveCount} live ?? {inDevCount} in dev</div>
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
              <span>APP</span> Your Apps
              <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-secondary)' }}>({ownApps.length})</span>
            </h2>
          </div>
          <div className="projects-grid">
            {ownApps.map(p => (
              <ProjectCard key={p.id} project={p} onClick={onSelectProject} />
            ))}
          </div>
        </>
      )}

      {/* Client Projects */}
      {clientProjects.length > 0 && (
        <>
          <div className="section-header">
            <h2 className="section-title">
              <span>WEB</span> Websites & Web Apps
              <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-secondary)' }}>({clientProjects.length})</span>
            </h2>
          </div>
          <div className="projects-grid">
            {clientProjects.map(p => (
              <ProjectCard key={p.id} project={p} onClick={onSelectProject} />
            ))}
          </div>
        </>
      )}

      {/* Pipeline */}
      <div className="section-header">
        <h2 className="section-title">
          <span>NEW</span> App Pipeline
          <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-secondary)' }}>({(pipeline || []).length} ideas)</span>
        </h2>
      </div>
      <div className="pipeline-grid">
        {(pipeline || []).map(app => (
          <div key={app.id} className="pipeline-chip" style={{ borderColor: `${app.color}40` }}>
            <span>{app.logo}</span>
            <span style={{ color: app.color }}>{app.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
