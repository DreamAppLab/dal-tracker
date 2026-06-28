// src/components/ProjectDetail.js
import React, { useState } from 'react';
import { STATUS_CONFIG, PRIORITY_CONFIG } from '../data/initialData';
import MilestoneModal from './MilestoneModal';
import EditModal from './EditModal';
import ExpenseModal from './ExpenseModal';
import TechStackModal from './TechStackModal';
import PaymentModal from './PaymentModal';
import AppChecklist from './AppChecklist';
import ProjectVault from '../ProjectVault';

function getProgress(project) {
  const allTasks = [...(project.milestones || []), ...(project.edits || [])];
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

function getOutstandingEditCosts(project) {
  return (project.edits || []).filter(e => e.amount > 0 && !e.completed).reduce((sum, e) => sum + (e.amount || 0), 0);
}

function getOutstandingMilestoneCosts(project) {
  return (project.milestones || []).filter(m => m.amount > 0 && !m.completed).reduce((sum, m) => sum + (m.amount || 0), 0);
}

function getTotalPaidOut(project) {
  return (project.payments || []).filter(p => p.type === 'out').reduce((sum, p) => sum + p.amount, 0);
}

function getTotalPaidIn(project) {
  return (project.payments || []).filter(p => p.type === 'in').reduce((sum, p) => sum + p.amount, 0);
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function generateEditsPDF(project, filter) {
  const edits = getFilteredEdits(project.edits || [], filter);
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  const sorted = [...edits].sort((a, b) => (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1));
  const totalCost = sorted.filter(e => e.amount > 0).reduce((s, e) => s + e.amount, 0);

  const rows = sorted.map((e, i) => `
    <tr style="background:${i % 2 === 0 ? '#f8f9fa' : '#ffffff'}">
      <td style="padding:10px;border:1px solid #dee2e6;font-size:13px">${e.page}</td>
      <td style="padding:10px;border:1px solid #dee2e6;font-size:13px">${e.location}</td>
      <td style="padding:10px;border:1px solid #dee2e6;font-size:13px;font-weight:600">${e.item}</td>
      <td style="padding:10px;border:1px solid #dee2e6;font-size:13px">
        <span style="background:${e.priority === 'high' ? '#fee2e2' : e.priority === 'medium' ? '#fef9c3' : '#dbeafe'};
          color:${e.priority === 'high' ? '#dc2626' : e.priority === 'medium' ? '#d97706' : '#2563eb'};
          padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">${e.priority.toUpperCase()}</span>
      </td>
      <td style="padding:10px;border:1px solid #dee2e6;font-size:13px">${e.notes || '—'}</td>
      <td style="padding:10px;border:1px solid #dee2e6;font-size:13px;text-align:center;color:${e.amount > 0 ? '#d97706' : '#666'};font-weight:${e.amount > 0 ? '700' : '400'}">${e.amount > 0 ? '$' + e.amount.toFixed(2) : '—'}</td>
      <td style="padding:10px;border:1px solid #dee2e6;font-size:13px">${formatDate(e.createdAt)}</td>
      <td style="padding:10px;border:1px solid #dee2e6;font-size:13px;text-align:center">${e.sentToDev ? 'Yes' + (e.sentToDevAt ? ' (' + formatDate(e.sentToDevAt) + ')' : '') : 'No'}</td>
      <td style="padding:10px;border:1px solid #dee2e6;font-size:13px;text-align:center">${e.completed ? 'Done' : 'Open'}</td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html><html><head><title>${project.name} - Edits Needed</title>
    <style>body{font-family:Arial,sans-serif;margin:40px;color:#1a1a1a}h1{font-size:22px;margin-bottom:4px}.meta{color:#666;font-size:13px;margin-bottom:24px}.total{margin-top:16px;padding:12px 16px;background:#fef9c3;border-radius:8px;font-weight:700;font-size:14px;color:#d97706}table{width:100%;border-collapse:collapse}th{background:#1a2234;color:white;padding:10px;text-align:left;font-size:12px;border:1px solid #dee2e6}</style>
    </head><body>
    <h1>${project.name} — Edits Needed</h1>
    <div class="meta">Generated: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} | Filter: ${filter} | ${sorted.length} item(s)</div>
    <table><thead><tr><th>Page</th><th>Location</th><th>Item</th><th>Priority</th><th>Notes</th><th>Cost</th><th>Date Added</th><th>Sent to Dev</th><th>Status</th></tr></thead>
    <tbody>${rows}</tbody></table>
    ${totalCost > 0 ? `<div class="total">Total Outstanding Dev Costs: $${totalCost.toFixed(2)}</div>` : ''}
    </body></html>`;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
  win.print();
}

function getFilteredEdits(edits, filter) {
  switch (filter) {
    case 'open': return edits.filter(e => !e.completed);
    case 'completed': return edits.filter(e => e.completed);
    case 'sent': return edits.filter(e => e.sentToDev);
    case 'not-sent': return edits.filter(e => !e.sentToDev && !e.completed);
    case 'has-cost': return edits.filter(e => e.amount > 0 && !e.completed);
    default: return edits;
  }
}

const BASE_TABS = [
  { key: "overview", label: "Overview" },
  { key: "milestones", label: "Milestones" },
  { key: "edits", label: "Edits Needed" },
  { key: "stack", label: "Tech Stack" },
  { key: "financials", label: "Financials" },
  { key: "vault", label: "🔑 Vault" }
];

function isAppProject(project) {
  if (!project.type) return false;
  return project.type === 'own-app' || project.type === 'client-app';
}

export default function ProjectDetail({ project, onUpdate, onDelete, onBack }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [showMilestoneModal, setShowMilestoneModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showStackModal, setShowStackModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentType, setPaymentType] = useState('out');
  const [editingItem, setEditingItem] = useState(null);
  const [editsFilter, setEditsFilter] = useState('all');

  const isApp = isAppProject(project);
  const TABS = isApp
    ? [...BASE_TABS, { key: 'checklist', label: '📋 Pub Checklist' }]
    : BASE_TABS;
  const prog = getProgress(project);
  const monthlyExp = getMonthlyExpenses(project);
  const outstandingEditCosts = getOutstandingEditCosts(project);
  const outstandingMilestoneCosts = getOutstandingMilestoneCosts(project);
  const totalOutstanding = outstandingEditCosts + outstandingMilestoneCosts;
  const totalPaidOut = getTotalPaidOut(project);
  const totalPaidIn = getTotalPaidIn(project);
  const sc = STATUS_CONFIG[project.status] || STATUS_CONFIG.ideation;

  const toggleMilestone = (id) => {
    const milestone = project.milestones.find(m => m.id === id);
    const isCompleting = milestone && !milestone.completed;
    const updatedMilestones = project.milestones.map(m => m.id === id ? { ...m, completed: !m.completed } : m);
    
    // Auto-log payment out if milestone has an amount and is being marked complete
    if (isCompleting && milestone.amount > 0) {
      const autoPayment = {
        id: `pay${Date.now()}`,
        type: 'out',
        description: `Milestone completed: ${milestone.title}`,
        recipient: 'Developer',
        amount: milestone.amount,
        date: new Date().toISOString().split('T')[0],
        method: '',
        notes: 'Auto-logged when milestone marked complete'
      };
      onUpdate({ ...project, milestones: updatedMilestones, payments: [...(project.payments || []), autoPayment] });
    } else {
      onUpdate({ ...project, milestones: updatedMilestones });
    }
  };

  const toggleEdit = (id) => {
    onUpdate({ ...project, edits: project.edits.map(e => e.id === id ? { ...e, completed: !e.completed } : e) });
  };

  const toggleSentToDev = (id) => {
    onUpdate({ ...project, edits: project.edits.map(e => e.id === id ? { ...e, sentToDev: !e.sentToDev, sentToDevAt: !e.sentToDev ? new Date().toISOString() : null } : e) });
  };

  const deleteMilestone = (id) => onUpdate({ ...project, milestones: project.milestones.filter(m => m.id !== id) });
  const deleteEdit = (id) => onUpdate({ ...project, edits: project.edits.filter(e => e.id !== id) });
  const deleteExpense = (id) => onUpdate({ ...project, expenses: project.expenses.filter(e => e.id !== id) });
  const deletePayment = (id) => onUpdate({ ...project, payments: (project.payments || []).filter(p => p.id !== id) });

  const deleteTechStack = (idx) => {
    const stack = [...(project.techStack || [])];
    stack.splice(idx, 1);
    onUpdate({ ...project, techStack: stack });
  };

  const handleSaveMilestone = (milestone) => {
    if (milestone.id && project.milestones.find(m => m.id === milestone.id)) {
      onUpdate({ ...project, milestones: project.milestones.map(m => m.id === milestone.id ? milestone : m) });
    } else {
      onUpdate({ ...project, milestones: [...(project.milestones || []), { ...milestone, id: `m${Date.now()}` }] });
    }
    setShowMilestoneModal(false);
    setEditingItem(null);
  };

  const handleSaveEdit = (edit) => {
    const withDate = { ...edit, createdAt: edit.createdAt || new Date().toISOString() };
    if (edit.id && project.edits.find(e => e.id === edit.id)) {
      onUpdate({ ...project, edits: project.edits.map(e => e.id === edit.id ? withDate : e) });
    } else {
      onUpdate({ ...project, edits: [...(project.edits || []), { ...withDate, id: `ed${Date.now()}` }] });
    }
    setShowEditModal(false);
    setEditingItem(null);
  };

  const handleSaveExpense = (expense) => {
    if (expense.id && project.expenses.find(e => e.id === expense.id)) {
      onUpdate({ ...project, expenses: project.expenses.map(e => e.id === expense.id ? expense : e) });
    } else {
      onUpdate({ ...project, expenses: [...(project.expenses || []), { ...expense, id: `e${Date.now()}` }] });
    }
    setShowExpenseModal(false);
    setEditingItem(null);
  };

  const handleSavePayment = (payment) => {
    onUpdate({ ...project, payments: [...(project.payments || []), { ...payment, id: `pay${Date.now()}` }] });
    setShowPaymentModal(false);
  };

  const handleSaveStack = (entry) => {
    onUpdate({ ...project, techStack: [...(project.techStack || []), entry] });
    setShowStackModal(false);
  };

  const handleUpdateRevenue = (field, value) => {
    onUpdate({ ...project, revenue: { ...project.revenue, [field]: value } });
  };

  const filteredEdits = getFilteredEdits(project.edits || [], editsFilter);
  const sortedEdits = [...filteredEdits].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return (order[a.priority] ?? 1) - (order[b.priority] ?? 1);
  });

  const openCount = (project.edits || []).filter(e => !e.completed).length;
  const sentCount = (project.edits || []).filter(e => e.sentToDev).length;
  const completedCount = (project.edits || []).filter(e => e.completed).length;
  const hasCostCount = (project.edits || []).filter(e => e.amount > 0 && !e.completed).length;

  const paymentsOut = (project.payments || []).filter(p => p.type === 'out').sort((a, b) => new Date(b.date) - new Date(a.date));
  const paymentsIn = (project.payments || []).filter(p => p.type === 'in').sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <div>
      <div className="detail-header">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>Back</button>
        <div className="detail-logo" style={{ background: `${project.color}18`, border: `1px solid ${project.color}30` }}>{project.logo}</div>
        <div style={{ flex: 1 }}>
          <div className="detail-title">{project.name}</div>
          <div className="detail-meta">
            <span className="status-badge" style={{ background: sc.bg, color: sc.color }}>
              <span className="status-dot" style={{ background: sc.color }} /> {sc.label}
            </span>
            <span className="platform-chip">{project.platform}</span>
            <span className="detail-meta-item">{project.tagline}</span>
            {project.bundleId && <span className="detail-meta-item" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{project.bundleId}</span>}
          </div>
        </div>
        <div className="detail-header-actions">
          <button className="btn btn-danger btn-sm" onClick={() => { if (window.confirm('Delete this project?')) onDelete(project.id); }}>Delete</button>
        </div>
      </div>

      <div className="tabs-bar">
        {TABS.map(t => {
          let count = null;
          if (t.key === 'milestones') count = (project.milestones || []).filter(m => !m.completed).length;
          if (t.key === 'edits') count = openCount;
          if (t.key === 'stack') count = (project.techStack || []).length;
          if (t.key === 'financials') count = (project.expenses || []).length + (project.payments || []).length;
          if (t.key === 'vault') count = (project.vault || []).length;
          return (
            <button key={t.key} className={`tab-btn ${activeTab === t.key ? 'active' : ''}`} onClick={() => setActiveTab(t.key)}>
              {t.label}
              {count !== null && count > 0 && <span className="tab-count">{count}</span>}
            </button>
          );
        })}
      </div>

      {activeTab === 'overview' && (
        <div className="data-section">
          <div className="stats-grid" style={{ marginBottom: 24 }}>
            <div className="stat-card teal">
              <div className="stat-label">Overall Progress</div>
              <div className="stat-value" style={{ color: project.color }}>{prog.pct}%</div>
              <div className="stat-sub">{prog.done} of {prog.total} tasks</div>
            </div>
            <div className="stat-card green">
              <div className="stat-label">Total Paid In</div>
              <div className="stat-value" style={{ color: 'var(--green)' }}>${totalPaidIn.toFixed(0)}</div>
              <div className="stat-sub">{paymentsIn.length} payment{paymentsIn.length !== 1 ? 's' : ''} received</div>
            </div>
            <div className="stat-card coral">
              <div className="stat-label">Total Paid Out</div>
              <div className="stat-value" style={{ color: 'var(--coral)' }}>${totalPaidOut.toFixed(0)}</div>
              <div className="stat-sub">{paymentsOut.length} payment{paymentsOut.length !== 1 ? 's' : ''} made</div>
            </div>
            <div className="stat-card amber">
              <div className="stat-label">Total Outstanding</div>
              <div className="stat-value" style={{ color: totalOutstanding > 0 ? 'var(--amber)' : 'var(--text-secondary)' }}>${totalOutstanding.toFixed(0)}</div>
              <div className="stat-sub">Edits + milestones unpaid</div>
            </div>
            <div className="stat-card indigo">
              <div className="stat-label">Monthly Operating</div>
              <div className="stat-value" style={{ color: 'var(--coral)' }}>${monthlyExp.toFixed(0)}</div>
              <div className="stat-sub">Recurring costs/mo</div>
            </div>
            <div className="stat-card electric">
              <div className="stat-label">Open Edits</div>
              <div className="stat-value">{openCount}</div>
              <div className="stat-sub">{sentCount} sent to dev</div>
            </div>
          </div>
          <div className="progress-section" style={{ marginBottom: 24 }}>
            <div className="progress-header">
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>Project Progress</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: project.color }}>{prog.pct}%</span>
            </div>
            <div className="progress-track" style={{ height: 10 }}>
              <div className="progress-fill" style={{ width: `${prog.pct}%`, background: `linear-gradient(90deg, ${project.color}, ${project.color}88)` }} />
            </div>
          </div>
          <div className="data-section-header">
            <h3 className="data-section-title">Recent Milestones</h3>
            <button className="btn btn-secondary btn-sm" onClick={() => setActiveTab('milestones')}>View All</button>
          </div>
          <div className="item-list">
            {(project.milestones || []).slice(-3).reverse().map(m => (
              <div key={m.id} className={`item-row ${m.completed ? 'completed' : ''}`}>
                <div className="check-btn checked" style={{ background: m.completed ? project.color : undefined, borderColor: project.color }}>{m.completed ? '✓' : ''}</div>
                <div className="item-main">
                  <div className="item-title">{m.title}</div>
                  <div className="item-desc">{m.description}</div>
                </div>
                {m.amount > 0 && <div className="item-amount">${m.amount.toLocaleString()}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'milestones' && (
        <div className="data-section">
          <div className="data-section-header">
            <h3 className="data-section-title">Milestones</h3>
            <button className="btn btn-primary btn-sm" onClick={() => { setEditingItem(null); setShowMilestoneModal(true); }}>+ Add Milestone</button>
          </div>
          {(project.milestones || []).length === 0 ? (
            <div className="empty-state"><div className="empty-state-icon"></div><div className="empty-state-text">No milestones yet.</div></div>
          ) : (
            <div className="item-list">
              {(project.milestones || []).map(m => (
                <div key={m.id} className={`item-row ${m.completed ? 'completed' : ''}`}>
                  <button className={`check-btn ${m.completed ? 'checked' : ''}`} style={m.completed ? { background: project.color, borderColor: project.color } : { borderColor: project.color }} onClick={() => toggleMilestone(m.id)}>{m.completed ? '✓' : ''}</button>
                  <div className="item-main">
                    <div className="item-title">{m.title}{m.dueDate && <span className="tag" style={{ background: 'var(--bg-surface)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>{m.dueDate}</span>}</div>
                    <div className="item-desc">{m.description}</div>
                  </div>
                  {m.amount > 0 && <div className="item-amount">${m.amount.toLocaleString()}</div>}
                  <div className="item-actions">
                    <button className="icon-btn" onClick={() => { setEditingItem(m); setShowMilestoneModal(true); }}>Edit</button>
                    <button className="icon-btn danger" onClick={() => deleteMilestone(m.id)}>Del</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'edits' && (
        <div className="data-section">
          <div className="data-section-header">
            <h3 className="data-section-title">Edits Needed</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => generateEditsPDF(project, editsFilter)}>Export PDF</button>
              <button className="btn btn-primary btn-sm" onClick={() => { setEditingItem(null); setShowEditModal(true); }}>+ Add Edit</button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            {[
              { key: 'all', label: `All (${(project.edits || []).length})` },
              { key: 'open', label: `Open (${openCount})` },
              { key: 'not-sent', label: `Not Sent (${(project.edits || []).filter(e => !e.sentToDev && !e.completed).length})` },
              { key: 'sent', label: `Sent to Dev (${sentCount})` },
              { key: 'has-cost', label: `Has Cost (${hasCostCount})` },
              { key: 'completed', label: `Completed (${completedCount})` }
            ].map(f => (
              <button key={f.key} onClick={() => setEditsFilter(f.key)}
                style={{ padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid', background: editsFilter === f.key ? project.color : 'var(--bg-card)', color: editsFilter === f.key ? 'var(--bg-base)' : 'var(--text-secondary)', borderColor: editsFilter === f.key ? project.color : 'var(--border)' }}
              >{f.label}</button>
            ))}
          </div>
          {outstandingEditCosts > 0 && (
            <div style={{ padding: '12px 16px', background: 'var(--amber-dim)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--amber)', fontWeight: 600 }}>Outstanding Dev Costs</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--amber)', fontSize: 18, fontWeight: 700 }}>${outstandingEditCosts.toFixed(2)}</span>
            </div>
          )}
          {sortedEdits.length === 0 ? (
            <div className="empty-state"><div className="empty-state-icon"></div><div className="empty-state-text">No edits in this filter.</div></div>
          ) : (
            <div className="item-list">
              {sortedEdits.map(e => {
                const pc = PRIORITY_CONFIG[e.priority] || PRIORITY_CONFIG.medium;
                return (
                  <div key={e.id} className={`item-row ${e.completed ? 'completed' : ''}`}>
                    <button className={`check-btn ${e.completed ? 'checked' : ''}`} style={e.completed ? { background: project.color, borderColor: project.color } : { borderColor: project.color }} onClick={() => toggleEdit(e.id)}>{e.completed ? '✓' : ''}</button>
                    <div className="item-main">
                      <div className="item-title">
                        {e.item}
                        <span className="tag" style={{ background: `${pc.color}18`, color: pc.color }}>{pc.label}</span>
                        {e.amount > 0 && !e.completed && <span className="tag" style={{ background: 'var(--amber-dim)', color: 'var(--amber)' }}>${e.amount.toFixed(2)}</span>}
                        {e.sentToDev && <span className="tag" style={{ background: 'rgba(34,197,94,0.15)', color: 'var(--green)' }}>Sent to Dev</span>}
                      </div>
                      <div className="item-tags">
                        <span className="tag" style={{ background: 'var(--indigo-dim)', color: 'var(--indigo)' }}>{e.page}</span>
                        <span className="tag" style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}> {e.location}</span>
                        {e.createdAt && <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>Added {formatDate(e.createdAt)}</span>}
                        {e.sentToDevAt && <span style={{ fontSize: 10, color: 'var(--green)', marginLeft: 4 }}>Sent {formatDate(e.sentToDevAt)}</span>}
                      </div>
                      {e.notes && <div className="item-desc" style={{ marginTop: 6 }}>Note: {e.notes}</div>}
                    </div>
                    <div className="item-actions">
                      <button className="icon-btn" title={e.sentToDev ? 'Unmark sent' : 'Mark sent to dev'} onClick={() => toggleSentToDev(e.id)} style={e.sentToDev ? { color: 'var(--green)', borderColor: 'var(--green)' } : {}}>{e.sentToDev ? 'Sent' : 'Send'}</button>
                      <button className="icon-btn" onClick={() => { setEditingItem(e); setShowEditModal(true); }}>Edit</button>
                      <button className="icon-btn danger" onClick={() => deleteEdit(e.id)}>Del</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'stack' && (
        <div className="data-section">
          <div className="data-section-header">
            <h3 className="data-section-title">Tech Stack</h3>
            <button className="btn btn-primary btn-sm" onClick={() => setShowStackModal(true)}>+ Add Layer</button>
          </div>
          {(project.techStack || []).length === 0 ? (
            <div className="empty-state"><div className="empty-state-icon"></div><div className="empty-state-text">No tech stack defined yet.</div></div>
          ) : (
            <table className="stack-table">
              <thead><tr><th>Layer</th><th>Technology</th><th style={{ width: 40 }}></th></tr></thead>
              <tbody>
                {(project.techStack || []).map((s, i) => (
                  <tr key={i}>
                    <td><span className="layer-badge">{s.layer}</span></td>
                    <td><span className="tech-value">{s.tech}</span></td>
                    <td><button className="icon-btn danger" onClick={() => deleteTechStack(i)}>Del</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'financials' && (
        <div className="data-section">

          {/* Top P&L summary */}
          <div className="stats-grid" style={{ marginBottom: 24 }}>
            <div className="stat-card green">
              <div className="stat-label">Total Paid In</div>
              <div className="stat-value" style={{ color: 'var(--green)' }}>${totalPaidIn.toFixed(2)}</div>
              <div className="stat-sub">From clients / revenue</div>
            </div>
            <div className="stat-card coral">
              <div className="stat-label">Total Paid Out</div>
              <div className="stat-value" style={{ color: 'var(--coral)' }}>${totalPaidOut.toFixed(2)}</div>
              <div className="stat-sub">To developer / vendors</div>
            </div>
            <div className="stat-card amber">
              <div className="stat-label">Total Outstanding</div>
              <div className="stat-value" style={{ color: totalOutstanding > 0 ? 'var(--amber)' : 'var(--text-secondary)' }}>${totalOutstanding.toFixed(2)}</div>
              <div className="stat-sub">Edits ${outstandingEditCosts.toFixed(0)} + Milestones ${outstandingMilestoneCosts.toFixed(0)}</div>
            </div>
            <div className="stat-card teal">
              <div className="stat-label">Balance Owed to Dev</div>
              <div className="stat-value" style={{ color: (totalOutstanding - totalPaidOut) > 0 ? 'var(--coral)' : 'var(--green)' }}>
                ${Math.max(0, totalOutstanding - totalPaidOut).toFixed(2)}
              </div>
              <div className="stat-sub">Outstanding minus paid out</div>
            </div>
          </div>

          {/* Revenue inputs */}
          <div className="finance-grid" style={{ marginBottom: 20 }}>
            <div className="finance-card">
              <div className="finance-card-title">Monthly Revenue (MRR)</div>
              <div className="finance-big-num green">${project.revenue?.monthly || 0}</div>
              <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <div>
                  <label className="form-label" style={{ marginBottom: 4 }}>Monthly MRR ($)</label>
                  <input className="form-input" type="number" value={project.revenue?.monthly || 0} onChange={e => handleUpdateRevenue('monthly', parseFloat(e.target.value) || 0)} style={{ width: 140 }} />
                </div>
                <div>
                  <label className="form-label" style={{ marginBottom: 4 }}>Total Revenue ($)</label>
                  <input className="form-input" type="number" value={project.revenue?.total || 0} onChange={e => handleUpdateRevenue('total', parseFloat(e.target.value) || 0)} style={{ width: 140 }} />
                </div>
              </div>
            </div>
            <div className="finance-card">
              <div className="finance-card-title">Monthly Operating Expenses</div>
              <div className="finance-big-num coral">${monthlyExp.toFixed(2)}</div>
              <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--bg-card)', borderRadius: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Net Monthly: </span>
                <span style={{ fontFamily: 'var(--font-mono)', color: (project.revenue?.monthly || 0) - monthlyExp >= 0 ? 'var(--green)' : 'var(--coral)', fontWeight: 700 }}>
                  ${((project.revenue?.monthly || 0) - monthlyExp).toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* Outstanding edit costs */}
          {outstandingEditCosts > 0 && (
            <div style={{ padding: '16px 20px', background: 'var(--amber-dim)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 10, marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Outstanding Edit Charges</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: 'var(--amber)', marginBottom: 12 }}>${outstandingEditCosts.toFixed(2)}</div>
              <div className="expense-list">
                {(project.edits || []).filter(e => e.amount > 0 && !e.completed).map(e => (
                  <div key={e.id} className="expense-row" style={{ background: 'var(--bg-card)' }}>
                    <div>
                      <div className="expense-name">{e.item}</div>
                      <div className="expense-meta">{e.page} — {e.location} {e.sentToDev ? '· Sent to Dev' : '· Not yet sent'}</div>
                    </div>
                    <div className="expense-amount">${e.amount.toFixed(2)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Outstanding milestone costs */}
          {outstandingMilestoneCosts > 0 && (
            <div style={{ padding: '16px 20px', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 10, marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Outstanding Milestone Costs</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: 'var(--indigo)', marginBottom: 12 }}>${outstandingMilestoneCosts.toFixed(2)}</div>
              <div className="expense-list">
                {(project.milestones || []).filter(m => m.amount > 0 && !m.completed).map(m => (
                  <div key={m.id} className="expense-row" style={{ background: 'var(--bg-card)' }}>
                    <div>
                      <div className="expense-name">{m.title}</div>
                      <div className="expense-meta">{m.dueDate ? 'Due: ' + m.dueDate : 'No due date'}</div>
                    </div>
                    <div className="expense-amount" style={{ color: 'var(--indigo)' }}>${m.amount.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Payments OUT */}
          <div className="data-section-header" style={{ marginTop: 8 }}>
            <h3 className="data-section-title" style={{ color: 'var(--coral)' }}>Payments Out — To Developer / Vendors</h3>
            <button className="btn btn-primary btn-sm" onClick={() => { setPaymentType('out'); setShowPaymentModal(true); }}>+ Log Payment Out</button>
          </div>
          {paymentsOut.length === 0 ? (
            <div className="empty-state" style={{ padding: '20px' }}><div className="empty-state-text">No outgoing payments logged yet.</div></div>
          ) : (
            <div className="expense-list" style={{ marginBottom: 24 }}>
              {paymentsOut.map(p => (
                <div key={p.id} className="expense-row">
                  <div>
                    <div className="expense-name">{p.description}</div>
                    <div className="expense-meta">
                      {p.recipient && <span style={{ marginRight: 8 }}>To: {p.recipient}</span>}
                      {formatDate(p.date)}
                      {p.method && <span style={{ marginLeft: 8, padding: '1px 6px', background: 'var(--bg-card)', borderRadius: 4, fontSize: 10 }}>{p.method}</span>}
                    </div>
                    {p.notes && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{p.notes}</div>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="expense-amount" style={{ color: 'var(--coral)' }}>${p.amount.toFixed(2)}</div>
                    <button className="icon-btn danger" onClick={() => deletePayment(p.id)}>Del</button>
                  </div>
                </div>
              ))}
              <div className="expense-row" style={{ background: 'rgba(255,91,91,0.08)', borderColor: 'rgba(255,91,91,0.2)' }}>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Total Paid Out</div>
                <div className="expense-amount" style={{ color: 'var(--coral)', fontSize: 16 }}>${totalPaidOut.toFixed(2)}</div>
              </div>
              {totalOutstanding > 0 && (
                <div className="expense-row" style={{ background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.2)' }}>
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Remaining Balance Owed</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>${totalOutstanding.toFixed(2)} outstanding minus ${totalPaidOut.toFixed(2)} paid</div>
                  </div>
                  <div className="expense-amount" style={{ color: Math.max(0, totalOutstanding - totalPaidOut) > 0 ? 'var(--amber)' : 'var(--green)', fontSize: 16 }}>
                    ${Math.max(0, totalOutstanding - totalPaidOut).toFixed(2)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Payments IN */}
          <div className="data-section-header">
            <h3 className="data-section-title" style={{ color: 'var(--green)' }}>Payments In — From Clients / Revenue</h3>
            <button className="btn btn-primary btn-sm" onClick={() => { setPaymentType('in'); setShowPaymentModal(true); }}>+ Log Payment In</button>
          </div>
          {paymentsIn.length === 0 ? (
            <div className="empty-state" style={{ padding: '20px' }}><div className="empty-state-text">No incoming payments logged yet.</div></div>
          ) : (
            <div className="expense-list" style={{ marginBottom: 24 }}>
              {paymentsIn.map(p => (
                <div key={p.id} className="expense-row">
                  <div>
                    <div className="expense-name">{p.description}</div>
                    <div className="expense-meta">
                      {p.recipient && <span style={{ marginRight: 8 }}>From: {p.recipient}</span>}
                      {formatDate(p.date)}
                      {p.method && <span style={{ marginLeft: 8, padding: '1px 6px', background: 'var(--bg-card)', borderRadius: 4, fontSize: 10 }}>{p.method}</span>}
                    </div>
                    {p.notes && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{p.notes}</div>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="expense-amount" style={{ color: 'var(--green)' }}>${p.amount.toFixed(2)}</div>
                    <button className="icon-btn danger" onClick={() => deletePayment(p.id)}>Del</button>
                  </div>
                </div>
              ))}
              <div className="expense-row" style={{ background: 'rgba(34,197,94,0.08)', borderColor: 'rgba(34,197,94,0.2)' }}>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Total Paid In</div>
                <div className="expense-amount" style={{ color: 'var(--green)', fontSize: 16 }}>${totalPaidIn.toFixed(2)}</div>
              </div>
            </div>
          )}

          {/* Operating Expenses */}
          <div className="data-section-header">
            <h3 className="data-section-title">Operating Expenses (Recurring)</h3>
            <button className="btn btn-primary btn-sm" onClick={() => { setEditingItem(null); setShowExpenseModal(true); }}>+ Add Expense</button>
          </div>
          {(project.expenses || []).length === 0 ? (
            <div className="empty-state"><div className="empty-state-icon"></div><div className="empty-state-text">No recurring expenses yet.</div></div>
          ) : (
            <div className="expense-list">
              {(project.expenses || []).map(e => {
                const monthlyAmt = e.period === 'yearly' ? e.amount / 12 : e.amount;
                return (
                  <div key={e.id} className="expense-row">
                    <div>
                      <div className="expense-name">{e.name}</div>
                      <div className="expense-meta">
                        <span className="tag" style={{ background: 'var(--indigo-dim)', color: 'var(--indigo)', marginRight: 6 }}>{e.category}</span>
                        {e.period === 'yearly' ? `$${e.amount}/yr` : `$${e.amount}/mo`}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="expense-amount">${monthlyAmt.toFixed(2)}<span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>/mo</span></div>
                      <button className="icon-btn" onClick={() => { setEditingItem(e); setShowExpenseModal(true); }}>Edit</button>
                      <button className="icon-btn danger" onClick={() => deleteExpense(e.id)}>Del</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'checklist' && isApp && (
        <AppChecklist project={project} />
      )}

      {activeTab === 'vault' && (
        <ProjectVault project={project} onUpdate={onUpdate} />
      )}

      {showMilestoneModal && <MilestoneModal milestone={editingItem} onSave={handleSaveMilestone} onClose={() => { setShowMilestoneModal(false); setEditingItem(null); }} />}
      {showEditModal && <EditModal edit={editingItem} onSave={handleSaveEdit} onClose={() => { setShowEditModal(false); setEditingItem(null); }} />}
      {showExpenseModal && <ExpenseModal expense={editingItem} onSave={handleSaveExpense} onClose={() => { setShowExpenseModal(false); setEditingItem(null); }} />}
      {showStackModal && <TechStackModal onSave={handleSaveStack} onClose={() => setShowStackModal(false)} />}
      {showPaymentModal && <PaymentModal type={paymentType} onSave={handleSavePayment} onClose={() => setShowPaymentModal(false)} />}
    </div>
  );
}
