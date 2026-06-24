// src/components/ASODashboard.js
import React, { useState, useEffect } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { INITIAL_PROJECTS } from '../data/initialData';
import {
  ASO_PHASES,
  ASO_TOOLS,
  RANK_LABELS,
  getRankTier,
  loadAsoChecked,
  saveAsoChecked,
  loadAsoKeywords,
  saveAsoKeywords
} from '../data/asoData';

function KeywordRow({ keyword, rank, onChange, onRemove }) {
  const tier = getRankTier(parseInt(rank, 10));
  const cfg = RANK_LABELS[tier];

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
      <input
        className="form-input"
        value={keyword}
        onChange={e => onChange('keyword', e.target.value)}
        placeholder="Keyword"
        style={{ flex: 2 }}
      />
      <input
        className="form-input"
        type="number"
        min="0"
        value={rank}
        onChange={e => onChange('rank', e.target.value)}
        placeholder="Rank"
        style={{ width: 80, fontFamily: 'var(--font-mono)' }}
      />
      <span
        className="tag"
        style={{ background: `${cfg.color}18`, color: cfg.color, minWidth: 72, textAlign: 'center' }}
      >
        {cfg.label}
      </span>
      <button className="icon-btn danger" onClick={onRemove}>Del</button>
    </div>
  );
}

export default function ASODashboard() {
  const [projects] = useLocalStorage('dal-projects', INITIAL_PROJECTS);
  const [checked, setChecked] = useState(loadAsoChecked);
  const [openPhases, setOpenPhases] = useState({ a1: true });
  const [keywords, setKeywords] = useState(loadAsoKeywords);
  const [selectedAppId, setSelectedAppId] = useState('');

  const liveApps = projects.filter(p => p.type === 'own-app' && (p.status === 'live' || p.status === 'submitted'));

  useEffect(() => {
    if (!selectedAppId && liveApps.length > 0) {
      setSelectedAppId(liveApps[0].id);
    }
  }, [liveApps, selectedAppId]);

  const selectedApp = liveApps.find(p => p.id === selectedAppId);
  const appKeywords = keywords[selectedAppId] || [];

  const toggle = (stepId) => {
    const next = { ...checked, [stepId]: !checked[stepId] };
    setChecked(next);
    saveAsoChecked(next);
  };

  const togglePhase = (phaseId) => {
    setOpenPhases(p => ({ ...p, [phaseId]: !p[phaseId] }));
  };

  const expandAll = () => {
    const all = {};
    ASO_PHASES.forEach(p => { all[p.id] = true; });
    setOpenPhases(all);
  };

  const collapseAll = () => setOpenPhases({});

  const resetChecklist = () => {
    if (!window.confirm('Reset all ASO checklist progress? This cannot be undone.')) return;
    setChecked({});
    saveAsoChecked({});
  };

  const updateKeywords = (appId, rows) => {
    const next = { ...keywords, [appId]: rows };
    setKeywords(next);
    saveAsoKeywords(next);
  };

  const addKeyword = () => {
    if (!selectedAppId) return;
    const rows = [...appKeywords, { id: `kw${Date.now()}`, keyword: '', rank: '' }];
    updateKeywords(selectedAppId, rows);
  };

  const updateKeyword = (id, field, value) => {
    const rows = appKeywords.map(k => k.id === id ? { ...k, [field]: value } : k);
    updateKeywords(selectedAppId, rows);
  };

  const removeKeyword = (id) => {
    updateKeywords(selectedAppId, appKeywords.filter(k => k.id !== id));
  };

  const allSteps = ASO_PHASES.flatMap(p => p.steps);
  const totalSteps = allSteps.length;
  const doneSteps = allSteps.filter(s => checked[s.id]).length;
  const pct = totalSteps ? Math.round((doneSteps / totalSteps) * 100) : 0;

  const rankedKeywords = appKeywords.filter(k => k.rank && parseInt(k.rank, 10) > 0 && parseInt(k.rank, 10) <= 50).length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">ASO Mission Control</h1>
          <p className="page-subtitle">App Store Optimization — keywords, listings, and ongoing monitoring</p>
        </div>
        <div className="page-actions">
          <div className="live-indicator">
            <span className="live-dot" />
            {liveApps.length} Live App{liveApps.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card teal">
          <div className="stat-label">ASO Checklist</div>
          <div className="stat-value" style={{ color: 'var(--teal)' }}>{pct}%</div>
          <div className="stat-sub">{doneSteps}/{totalSteps} steps</div>
        </div>
        <div className="stat-card green">
          <div className="stat-label">Live Apps</div>
          <div className="stat-value">{liveApps.length}</div>
          <div className="stat-sub">Eligible for ASO tracking</div>
        </div>
        <div className="stat-card amber">
          <div className="stat-label">Tracked Keywords</div>
          <div className="stat-value">{appKeywords.length}</div>
          <div className="stat-sub">{selectedApp ? selectedApp.name : 'Select an app'}</div>
        </div>
        <div className="stat-card indigo">
          <div className="stat-label">Top 50 Ranks</div>
          <div className="stat-value">{rankedKeywords}</div>
          <div className="stat-sub">For selected app</div>
        </div>
      </div>

      {/* Keyword Tracker */}
      <div className="data-section" style={{ marginBottom: 24 }}>
        <div className="data-section-header">
          <h3 className="data-section-title">Keyword Tracker</h3>
          <button className="btn btn-primary btn-sm" onClick={addKeyword} disabled={!selectedAppId}>+ Add Keyword</button>
        </div>

        {liveApps.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-text">No live apps yet. Launch an app to start tracking keywords.</div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              {liveApps.map(app => (
                <button
                  key={app.id}
                  onClick={() => setSelectedAppId(app.id)}
                  style={{
                    padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid',
                    background: selectedAppId === app.id ? app.color : 'var(--bg-card)',
                    color: selectedAppId === app.id ? 'var(--bg-base)' : 'var(--text-secondary)',
                    borderColor: selectedAppId === app.id ? app.color : 'var(--border)'
                  }}
                >
                  {app.logo} {app.name}
                </button>
              ))}
            </div>

            {selectedApp && (
              <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                {selectedApp.bundleId && <span style={{ fontFamily: 'var(--font-mono)', marginRight: 12 }}>{selectedApp.bundleId}</span>}
                {selectedApp.pricing && <span>{selectedApp.pricing}</span>}
              </div>
            )}

            {appKeywords.length === 0 ? (
              <div className="empty-state" style={{ padding: '20px' }}>
                <div className="empty-state-text">No keywords tracked yet. Add your primary and secondary target keywords.</div>
              </div>
            ) : (
              appKeywords.map(kw => (
                <KeywordRow
                  key={kw.id}
                  keyword={kw.keyword}
                  rank={kw.rank}
                  onChange={(field, value) => updateKeyword(kw.id, field, value)}
                  onRemove={() => removeKeyword(kw.id)}
                />
              ))
            )}
          </>
        )}
      </div>

      {/* ASO Tools */}
      <div className="data-section" style={{ marginBottom: 24 }}>
        <div className="data-section-header">
          <h3 className="data-section-title">Quick Links</h3>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
          {ASO_TOOLS.map(tool => (
            <a
              key={tool.name}
              href={tool.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'block', padding: '12px 14px', borderRadius: 10,
                border: '1px solid var(--border)', background: 'var(--bg-card)',
                textDecoration: 'none', transition: 'var(--transition)'
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--teal)', marginBottom: 4 }}>{tool.name} ↗</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tool.desc}</div>
            </a>
          ))}
        </div>
      </div>

      {/* ASO Checklist */}
      <div className="data-section">
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
                ASO Pipeline Checklist
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {doneSteps} of {totalSteps} steps complete · {pct}%
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={expandAll}>Expand all</button>
              <button className="btn btn-ghost btn-sm" onClick={collapseAll}>Collapse all</button>
              <button className="btn btn-sm" style={{ color: 'var(--coral)', borderColor: 'rgba(255,91,91,0.3)', background: 'transparent' }} onClick={resetChecklist}>Reset</button>
            </div>
          </div>
          <div style={{ height: 6, background: 'var(--bg-card)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: pct + '%', background: 'var(--teal)', borderRadius: 3, transition: 'width 0.3s' }} />
          </div>
        </div>

        {ASO_PHASES.map(phase => {
          const phaseDone = phase.steps.filter(s => checked[s.id]).length;
          const phaseTotal = phase.steps.length;
          const isOpen = !!openPhases[phase.id];
          const allPhaseDone = phaseDone === phaseTotal;

          return (
            <div key={phase.id} style={{
              border: '1px solid var(--border)',
              borderRadius: 10,
              marginBottom: 8,
              overflow: 'hidden',
              background: allPhaseDone ? 'rgba(34,197,94,0.04)' : 'var(--bg-card)'
            }}>
              <div
                onClick={() => togglePhase(phase.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '12px 14px', cursor: 'pointer',
                  borderBottom: isOpen ? '1px solid var(--border)' : 'none'
                }}
              >
                <div style={{
                  width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                  background: allPhaseDone ? 'var(--green)' : 'var(--bg-card)',
                  border: '2px solid ' + (allPhaseDone ? 'var(--green)' : 'var(--border)'),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, color: 'white', fontWeight: 700
                }}>
                  {allPhaseDone ? '✓' : ''}
                </div>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{phase.title}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 6 }}>{phaseDone}/{phaseTotal}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', transition: 'transform 0.2s', display: 'inline-block', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
              </div>

              {isOpen && (
                <div>
                  {phase.steps.map((step, idx) => (
                    <div
                      key={step.id}
                      onClick={() => toggle(step.id)}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10,
                        padding: '10px 14px',
                        borderBottom: idx < phase.steps.length - 1 ? '1px solid var(--border)' : 'none',
                        cursor: 'pointer',
                        background: checked[step.id] ? 'rgba(34,197,94,0.04)' : 'transparent'
                      }}
                    >
                      <div style={{
                        width: 17, height: 17, borderRadius: 4, flexShrink: 0, marginTop: 2,
                        border: '2px solid ' + (checked[step.id] ? 'var(--teal)' : 'var(--border)'),
                        background: checked[step.id] ? 'var(--teal)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, color: 'white', fontWeight: 700, transition: 'all 0.15s'
                      }}>
                        {checked[step.id] ? '✓' : ''}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{
                          fontSize: 13,
                          color: checked[step.id] ? 'var(--text-muted)' : 'var(--text-primary)',
                          textDecoration: checked[step.id] ? 'line-through' : 'none',
                          lineHeight: 1.4
                        }}>
                          {step.label}
                        </div>
                        {step.note && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.5 }}>
                            {step.note}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
