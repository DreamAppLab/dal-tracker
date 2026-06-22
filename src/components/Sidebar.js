// src/components/Sidebar.js
import React from 'react';
import { STATUS_CONFIG } from '../data/initialData';


export default function Sidebar({ projects, activeView, selectedProjectId, onNavigate, onSelectProject, onAddProject, sidebarOpen, setSidebarOpen }) {
  return (
    <aside className={`sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
      <div className="sidebar-logo">
        <div className="sidebar-logo-mark">D</div>
        {sidebarOpen && (
          <div className="sidebar-logo-text">
            Dream App Lab<span>Mission Control</span>
          </div>
        )}
        <button className="sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)} title="Toggle sidebar">
          {sidebarOpen ? '◀' : '▶'}
        </button>
      </div>

      <nav className="sidebar-nav">
        {sidebarOpen && <div className="sidebar-section-label">Navigation</div>}
        <button
          className={`sidebar-item ${activeView === 'dashboard' ? 'active' : ''}`}
          onClick={() => onNavigate('dashboard')}
        >
          <span className="sidebar-item-icon">📊</span>
          {sidebarOpen && <span className="sidebar-item-text">Dashboard</span>}
        </button>

        {sidebarOpen && (
          <>
            <div className="sidebar-section-label" style={{ marginTop: 12 }}>Your Apps</div>
            {projects.filter(p => p.type === 'own-app').map(p => {
              const sc = STATUS_CONFIG[p.status];
              return (
                <button
                  key={p.id}
                  className={`sidebar-item ${selectedProjectId === p.id ? 'active' : ''}`}
                  onClick={() => onSelectProject(p)}
                >
                  <span className="sidebar-item-icon">{p.logo}</span>
                  <span className="sidebar-item-text">{p.name}</span>
                  <span className="sidebar-status-dot" style={{ background: sc?.color || '#94A3B8' }} />
                </button>
              );
            })}

            <div className="sidebar-section-label" style={{ marginTop: 12 }}>Websites / Web Apps</div>
            {projects.filter(p => p.type !== 'own-app').map(p => {
              const sc = STATUS_CONFIG[p.status];
              return (
                <button
                  key={p.id}
                  className={`sidebar-item ${selectedProjectId === p.id ? 'active' : ''}`}
                  onClick={() => onSelectProject(p)}
                >
                  <span className="sidebar-item-icon">{p.logo}</span>
                  <span className="sidebar-item-text">{p.name}</span>
                  <span className="sidebar-status-dot" style={{ background: sc?.color || '#94A3B8' }} />
                </button>
              );
            })}
          </>
        )}
      </nav>

      <button className="sidebar-add-btn" onClick={onAddProject}>
        {sidebarOpen ? '+ Add Project' : '+'}
      </button>
    </aside>
  );
}
