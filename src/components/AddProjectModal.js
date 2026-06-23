// src/components/AddProjectModal.js
import React, { useState } from 'react';

const EMOJIS = ['📱', '🌐', '🚀', '💡', '🏠', '✈️', '📚', '🏥', '🐾', '🌿', '💊', '🧠', '❤️', '🧶', '🚐', '🎮', '📸', '🎵', '💰', '⚙️'];
const COLORS = ['#00D4B8', '#6366F1', '#F59E0B', '#FF5B5B', '#22C55E', '#58c6f4', '#EC4899', '#8B5CF6', '#06B6D4', '#F43F5E'];

export default function AddProjectModal({ onAdd, onClose }) {
  const [form, setForm] = useState({
    name: '', tagline: '', type: 'own-app', platform: 'mobile', status: 'in-development',
    logo: '📱', color: '#00D4B8', bundleId: '', pricing: '', price: 0,
    revenue: { monthly: 0, total: 0, model: 'paid' },
    expenses: [], milestones: [], edits: [], techStack: []
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = () => {
    if (!form.name.trim()) return;
    onAdd({ ...form, id: form.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + Date.now() });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Add New Project</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {/* Logo & Color */}
          <div style={{ display: 'flex', gap: 20, marginBottom: 16, alignItems: 'flex-start' }}>
            <div>
              <label className="form-label">Logo</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: 180 }}>
                {EMOJIS.map(e => (
                  <button key={e} onClick={() => set('logo', e)}
                    style={{
                      width: 34, height: 34, borderRadius: 8, border: `2px solid ${form.logo === e ? 'var(--teal)' : 'var(--border)'}`,
                      background: form.logo === e ? 'var(--teal-dim)' : 'var(--bg-input)',
                      cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}
                  >{e}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="form-label">Color</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: 160 }}>
                {COLORS.map(c => (
                  <button key={c} onClick={() => set('color', c)}
                    style={{
                      width: 30, height: 30, borderRadius: 8, background: c,
                      border: `3px solid ${form.color === c ? 'white' : 'transparent'}`,
                      cursor: 'pointer'
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Project Name *</label>
            <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. MyClassLog" />
          </div>
          <div className="form-group">
            <label className="form-label">Tagline</label>
            <input className="form-input" value={form.tagline} onChange={e => set('tagline', e.target.value)} placeholder="Short description" />
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Type</label>
              <select className="form-select" value={form.type} onChange={e => set('type', e.target.value)}>
                <option value="own-app">Own App</option>
                <option value="own-website">Own Website</option>
                <option value="client-app">Client App</option>
                <option value="client-website">Client Website</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Platform</label>
              <select className="form-select" value={form.platform} onChange={e => set('platform', e.target.value)}>
                <option value="mobile">Mobile</option>
                <option value="web">Web</option>
                <option value="both">Both</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Status</label>
              <select className="form-select" value={form.status} onChange={e => set('status', e.target.value)}>
                <option value="ideation">Ideation</option>
                <option value="in-development">In Development</option>
                <option value="submitted">Submitted</option>
                <option value="live">Live</option>
                <option value="paused">Paused</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Revenue Model</label>
              <select className="form-select" value={form.revenue.model} onChange={e => set('revenue', { ...form.revenue, model: e.target.value })}>
                <option value="paid">Paid (one-time)</option>
                <option value="freemium">Freemium</option>
                <option value="subscription">Subscription</option>
                <option value="lead-gen">Lead Generation</option>
                <option value="free">Free</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Bundle ID / Domain</label>
            <input className="form-input" value={form.bundleId} onChange={e => set('bundleId', e.target.value)} placeholder="com.dreamapplab.appname or domain.com" />
          </div>
          <div className="form-group">
            <label className="form-label">Pricing</label>
            <input className="form-input" value={form.pricing} onChange={e => set('pricing', e.target.value)} placeholder="e.g. $3.99 one-time, or Freemium $2.99/mo · $24.99/yr via RevenueCat" />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={!form.name.trim()}>
            Create Project
          </button>
        </div>
      </div>
    </div>
  );
}
