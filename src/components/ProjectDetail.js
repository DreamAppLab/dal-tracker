// src/components/ProjectDetail.js
import React, { useState } from 'react';
import { STATUS_CONFIG, PRIORITY_CONFIG } from '../data/initialData';
import MilestoneModal from './MilestoneModal';
import EditModal from './EditModal';
import ExpenseModal from './ExpenseModal';
import TechStackModal from './TechStackModal';

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

const TABS = [
  { key: 'overview', label: 'Overview', icon: '📊' },
  { key: 'milestones', label: 'Milestones', icon: '🏁' },
  { key: 'edits', label: 'Edits Needed', icon: '✏️' },
  { key: 'stack', label: 'Tech Stack', icon: '⚙️' },
  { key: 'financials', label: 'Financials', icon: '💰' }
];

export default function ProjectDetail({ project, onUpdate, onDelete, onBack }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [showMilestoneModal, setShowMilestoneModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showStackModal, setShowStackModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);

  const prog = getProgress(project);
  const monthlyExp = getMonthlyExpenses(project);
  const sc = STATUS_CONFIG[project.status] || STATUS_CONFIG.ideation;

  const toggleMilestone = (id) => {
    onUpdate({
      ...project,
      milestones: project.milestones.map(m =>
        m.id === id ? { ...m, completed: !m.completed } : m
      )
    });
  };

  const toggleEdit = (id) => {
    onUpdate({
      ...project,
      edits: project.edits.map(e =>
        e.id === id ? { ...e, completed: !e.completed } : e
      )
    });
  };

  const deleteMilestone = (id) => {
    onUpdate({ ...project, milestones: project.milestones.filter(m => m.id !== id) });
  };

  const deleteEdit = (id) => {
    onUpdate({ ...project, edits: project.edits.filter(e => e.id !== id) });
  };

  const deleteExpense = (id) => {
    onUpdate({ ...project, expenses: project.expenses.filter(e => e.id !== id) });
  };

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
    if (edit.id && project.edits.find(e => e.id === edit.id)) {
      onUpdate({ ...project, edits: project.edits.map(e => e.id === edit.id ? edit : e) });
    } else {
      onUpdate({ ...project, edits: [...(project.edits || []), { ...edit, id: `ed${Date.now()}` }] });
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

  const handleSaveStack = (entry) => {
    onUpdate({ ...project, techStack: [...(project.techStack || []), entry] });
    setShowStackModal(false);
  };

  const handleUpdateRevenue = (field, value) => {
    onUpdate({ ...project, revenue: { ...project.revenue, [field]: value } });
  };

  return (
    <div>
      {/* Header */}
      <div className="detail-header">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
        <div className="detail-logo" style={{ background: `${project.color}18`, border: `1px solid ${project.color}30` }}>
          {project.logo}
        </div>
        <div style={{ flex: 1 }}>
          <div className="detail-title">{project.name}</div>
          <div className="detail-meta">
            <span className="status-badge" style={{ background: sc.bg, color: sc.color }}>
              <span className="status-dot" style={{ background: sc.color }} /> {sc.label}
            </span>
            <span className="platform-chip">{project.platform}</span>
            <span className="detail-meta-item">{project.tagline}</span>
            {project.bundleId && (
              <span className="detail-meta-item" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                {project.bundleId}
              </span>
            )}
          </div>
        </div>
        <div className="detail-header-actions">
          <button
            className="btn btn-danger btn-sm"
            onClick={() => { if (window.confirm('Delete this project?')) onDelete(project.id); }}
          >
            Delete
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs-bar">
        {TABS.map(t => {
          let count = null;
          if (t.key === 'milestones') count = (project.milestones || []).filter(m => !m.completed).length;
          if (t.key === 'edits') count = (project.edits || []).filter(e => !e.completed).length;
          if (t.key === 'stack') count = (project.techStack || []).length;
          if (t.key === 'financials') count = (project.expenses || []).length;
          return (
            <button
              key={t.key}
              className={`tab-btn ${activeTab === t.key ? 'active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.icon} {t.label}
              {count !== null && count > 0 && (
                <span className="tab-count">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {activeTab === 'overview' && (
        <div className="data-section">
          <div className="stats-grid" style={{ marginBottom: 24 }}>
            <div className="stat-card teal">
              <div className="stat-label">Overall Progress</div>
              <div className="stat-value" style={{ color: project.color }}>{prog.pct}%</div>
              <div className="stat-sub">{prog.done} of {prog.total} tasks</div>
            </div>
            <div className="stat-card green">
              <div className="stat-label">Monthly Revenue</div>
              <div className="stat-value" style={{ color: 'var(--green)' }}>${project.revenue?.monthly || 0}</div>
              <div className="stat-sub">{project.revenue?.model || '—'}</div>
            </div>
            <div className="stat-card coral">
              <div className="stat-label">Monthly Costs</div>
              <div className="stat-value" style={{ color: 'var(--coral)' }}>${monthlyExp.toFixed(0)}</div>
              <div className="stat-sub">{(project.expenses || []).length} expenses</div>
            </div>
            <div className="stat-card amber">
              <div className="stat-label">Net Monthly</div>
              <div className="stat-value" style={{ color: (project.revenue?.monthly || 0) - monthlyExp >= 0 ? 'var(--green)' : 'var(--coral)' }}>
                ${((project.revenue?.monthly || 0) - monthlyExp).toFixed(0)}
              </div>
              <div className="stat-sub">Revenue – costs</div>
            </div>
            <div className="stat-card indigo">
              <div className="stat-label">Milestones</div>
              <div className="stat-value">
                {(project.milestones || []).filter(m => m.completed).length}/{(project.milestones || []).length}
              </div>
              <div className="stat-sub">Completed</div>
            </div>
            <div className="stat-card electric">
              <div className="stat-label">Open Edits</div>
              <div className="stat-value">{(project.edits || []).filter(e => !e.completed).length}</div>
              <div className="stat-sub">Remaining</div>
            </div>
          </div>

          <div className="progress-section" style={{ marginBottom: 24 }}>
            <div className="progress-header">
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>Project Progress</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: project.color }}>{prog.pct}%</span>
            </div>
            <div className="progress-track" style={{ height: 10 }}>
              <div
                className="progress-fill"
                style={{ width: `${prog.pct}%`, background: `linear-gradient(90deg, ${project.color}, ${project.color}88)` }}
              />
            </div>
          </div>

          {/* Recent milestones */}
          <div className="data-section-header">
            <h3 className="data-section-title">Recent Milestones</h3>
            <button className="btn btn-secondary btn-sm" onClick={() => setActiveTab('milestones')}>View All</button>
          </div>
          <div className="item-list">
            {(project.milestones || []).slice(-3).reverse().map(m => (
              <div key={m.id} className={`item-row ${m.completed ? 'completed' : ''}`}>
                <div className="check-btn checked" style={{ background: m.completed ? project.color : undefined, borderColor: project.color }}>
                  {m.completed ? '✓' : ''}
                </div>
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

      {/* ── MILESTONES TAB ── */}
      {activeTab === 'milestones' && (
        <div className="data-section">
          <div className="data-section-header">
            <h3 className="data-section-title">Milestones</h3>
            <button className="btn btn-primary btn-sm" onClick={() => { setEditingItem(null); setShowMilestoneModal(true); }}>
              + Add Milestone
            </button>
          </div>
          {(project.milestones || []).length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🏁</div>
              <div className="empty-state-text">No milestones yet. Add your first one!</div>
            </div>
          ) : (
            <div className="item-list">
              {(project.milestones || []).map(m => (
                <div key={m.id} className={`item-row ${m.completed ? 'completed' : ''}`}>
                  <button
                    className={`check-btn ${m.completed ? 'checked' : ''}`}
                    style={m.completed ? { background: project.color, borderColor: project.color } : { borderColor: project.color }}
                    onClick={() => toggleMilestone(m.id)}
                  >
                    {m.completed ? '✓' : ''}
                  </button>
                  <div className="item-main">
                    <div className="item-title">
                      {m.title}
                      {m.dueDate && (
                        <span className="tag" style={{ background: 'var(--bg-surface)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                          {m.dueDate}
                        </span>
                      )}
                    </div>
                    <div className="item-desc">{m.description}</div>
                  </div>
                  {m.amount > 0 && <div className="item-amount">${m.amount.toLocaleString()}</div>}
                  <div className="item-actions">
                    <button className="icon-btn" onClick={() => { setEditingItem(m); setShowMilestoneModal(true); }}>✏</button>
                    <button className="icon-btn danger" onClick={() => deleteMilestone(m.id)}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── EDITS TAB ── */}
      {activeTab === 'edits' && (
        <div className="data-section">
          <div className="data-section-header">
            <h3 className="data-section-title">Edits Needed</h3>
            <button className="btn btn-primary btn-sm" onClick={() => { setEditingItem(null); setShowEditModal(true); }}>
              + Add Edit
            </button>
          </div>
          {(project.edits || []).length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">✏️</div>
              <div className="empty-state-text">No edits logged. You're clean!</div>
            </div>
          ) : (
            <div className="item-list">
              {(project.edits || []).sort((a, b) => {
                const order = { high: 0, medium: 1, low: 2 };
                return (order[a.priority] ?? 1) - (order[b.priority] ?? 1);
              }).map(e => {
                const pc = PRIORITY_CONFIG[e.priority] || PRIORITY_CONFIG.medium;
                return (
                  <div key={e.id} className={`item-row ${e.completed ? 'completed' : ''}`}>
                    <button
                      className={`check-btn ${e.completed ? 'checked' : ''}`}
                      style={e.completed ? { background: project.color, borderColor: project.color } : { borderColor: project.color }}
                      onClick={() => toggleEdit(e.id)}
                    >
                      {e.completed ? '✓' : ''}
                    </button>
                    <div className="item-main">
                      <div className="item-title">
                        {e.item}
                        <span className="tag" style={{ background: `${pc.color}18`, color: pc.color }}>
                          {pc.label}
                        </span>
                      </div>
                      <div className="item-tags">
                        <span className="tag" style={{ background: 'var(--indigo-dim)', color: 'var(--indigo)' }}>{e.page}</span>
                        <span className="tag" style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                          📍 {e.location}
                        </span>
                      </div>
                      {e.notes && <div className="item-desc" style={{ marginTop: 6 }}>📝 {e.notes}</div>}
                    </div>
                    <div className="item-actions">
                      <button className="icon-btn" onClick={() => { setEditingItem(e); setShowEditModal(true); }}>✏</button>
                      <button className="icon-btn danger" onClick={() => deleteEdit(e.id)}>✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── TECH STACK TAB ── */}
      {activeTab === 'stack' && (
        <div className="data-section">
          <div className="data-section-header">
            <h3 className="data-section-title">Tech Stack</h3>
            <button className="btn btn-primary btn-sm" onClick={() => setShowStackModal(true)}>
              + Add Layer
            </button>
          </div>
          {(project.techStack || []).length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">⚙️</div>
              <div className="empty-state-text">No tech stack defined yet.</div>
            </div>
          ) : (
            <table className="stack-table">
              <thead>
                <tr>
                  <th>Layer</th>
                  <th>Technology</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {(project.techStack || []).map((s, i) => (
                  <tr key={i}>
                    <td><span className="layer-badge">{s.layer}</span></td>
                    <td><span className="tech-value">{s.tech}</span></td>
                    <td>
                      <button className="icon-btn danger" onClick={() => deleteTechStack(i)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── FINANCIALS TAB ── */}
      {activeTab === 'financials' && (
        <div className="data-section">
          <div className="finance-grid">
            <div className="finance-card">
              <div className="finance-card-title">Monthly Revenue</div>
              <div className="finance-big-num green">${project.revenue?.monthly || 0}</div>
              <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <div>
                  <label className="form-label" style={{ marginBottom: 4 }}>Monthly MRR ($)</label>
                  <input
                    className="form-input"
                    type="number"
                    value={project.revenue?.monthly || 0}
                    onChange={e => handleUpdateRevenue('monthly', parseFloat(e.target.value) || 0)}
                    style={{ width: 140 }}
                  />
                </div>
                <div>
                  <label className="form-label" style={{ marginBottom: 4 }}>Total Revenue ($)</label>
                  <input
                    className="form-input"
                    type="number"
                    value={project.revenue?.total || 0}
                    onChange={e => handleUpdateRevenue('total', parseFloat(e.target.value) || 0)}
                    style={{ width: 140 }}
                  />
                </div>
              </div>
              <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--bg-card)', borderRadius: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>All-time Revenue: </span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--amber)', fontWeight: 700 }}>
                  ${(project.revenue?.total || 0).toLocaleString()}
                </span>
              </div>
            </div>

            <div className="finance-card">
              <div className="finance-card-title">Monthly Expenses</div>
              <div className="finance-big-num coral">${monthlyExp.toFixed(2)}</div>
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                {(project.expenses || []).length} expense{(project.expenses || []).length !== 1 ? 's' : ''} tracked
              </div>
              <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--bg-card)', borderRadius: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Net Monthly: </span>
                <span style={{ fontFamily: 'var(--font-mono)', color: (project.revenue?.monthly || 0) - monthlyExp >= 0 ? 'var(--green)' : 'var(--coral)', fontWeight: 700 }}>
                  ${((project.revenue?.monthly || 0) - monthlyExp).toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          <div className="data-section-header">
            <h3 className="data-section-title">Operating Expenses</h3>
            <button className="btn btn-primary btn-sm" onClick={() => { setEditingItem(null); setShowExpenseModal(true); }}>
              + Add Expense
            </button>
          </div>

          {(project.expenses || []).length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">💸</div>
              <div className="empty-state-text">No expenses tracked yet.</div>
            </div>
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
                        {e.period === 'yearly' ? `$${e.amount}/yr (≈$${monthlyAmt.toFixed(2)}/mo)` : `$${e.amount}/mo`}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="expense-amount">${monthlyAmt.toFixed(2)}<span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>/mo</span></div>
                      <button className="icon-btn" onClick={() => { setEditingItem(e); setShowExpenseModal(true); }}>✏</button>
                      <button className="icon-btn danger" onClick={() => deleteExpense(e.id)}>✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Milestone Costs */}
          {(project.milestones || []).some(m => m.amount > 0) && (
            <>
              <div className="divider" />
              <div className="data-section-header">
                <h3 className="data-section-title">Milestone Budget</h3>
              </div>
              <div className="expense-list">
                {(project.milestones || []).filter(m => m.amount > 0).map(m => (
                  <div key={m.id} className="expense-row" style={{ opacity: m.completed ? 0.6 : 1 }}>
                    <div>
                      <div className="expense-name">{m.title} {m.completed ? '✓' : ''}</div>
                      <div className="expense-meta">{m.description}</div>
                    </div>
                    <div className="expense-amount">${m.amount.toLocaleString()}</div>
                  </div>
                ))}
                <div className="expense-row" style={{ background: 'var(--amber-dim)', borderColor: 'rgba(245,158,11,0.2)' }}>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Total Milestone Budget</div>
                  <div className="expense-amount">
                    ${(project.milestones || []).filter(m => m.amount > 0).reduce((s, m) => s + m.amount, 0).toLocaleString()}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Modals */}
      {showMilestoneModal && (
        <MilestoneModal
          milestone={editingItem}
          onSave={handleSaveMilestone}
          onClose={() => { setShowMilestoneModal(false); setEditingItem(null); }}
        />
      )}
      {showEditModal && (
        <EditModal
          edit={editingItem}
          onSave={handleSaveEdit}
          onClose={() => { setShowEditModal(false); setEditingItem(null); }}
        />
      )}
      {showExpenseModal && (
        <ExpenseModal
          expense={editingItem}
          onSave={handleSaveExpense}
          onClose={() => { setShowExpenseModal(false); setEditingItem(null); }}
        />
      )}
      {showStackModal && (
        <TechStackModal
          onSave={handleSaveStack}
          onClose={() => setShowStackModal(false)}
        />
      )}
    </div>
  );
}
