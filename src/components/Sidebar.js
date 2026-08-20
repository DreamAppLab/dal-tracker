import React, { useEffect, useState } from 'react';
import { STATUS_CONFIG } from '../data/initialData';
import AppLogo from './AppLogo';

const STORAGE_KEY = 'dal-mc-sidebar-sections';
const DEFAULT_SECTIONS = { navigation: true, apps: true, websites: true };

function loadSections() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SECTIONS };
    return { ...DEFAULT_SECTIONS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SECTIONS };
  }
}

function SectionHeader({ label, open, onToggle }) {
  return (
    <button
      type="button"
      className="sidebar-section-toggle"
      onClick={onToggle}
      aria-expanded={open}
    >
      <span className="sidebar-section-label">{label}</span>
      <span className="sidebar-section-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
    </button>
  );
}

export default function Sidebar({
  projects,
  revenueLogos = {},
  activeView,
  selectedProjectId,
  onNavigate,
  onSelectProject,
  onAddProject,
  onLogout,
  sidebarOpen,
  setSidebarOpen,
}) {
  const [sections, setSections] = useState(DEFAULT_SECTIONS);

  useEffect(() => {
    setSections(loadSections());
  }, []);

  const toggleSection = (key) => {
    setSections((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore quota / private mode */
      }
      return next;
    });
  };

  const showNavItems = !sidebarOpen || sections.navigation;
  const showApps = sidebarOpen && sections.apps;
  const showWebsites = sidebarOpen && sections.websites;
  const ownApps = projects.filter((p) => p.type === 'own-app' && p.projectType !== 'Client Job');
  const webApps = projects.filter((p) => p.type !== 'own-app' && p.projectType !== 'Client Job');

  const renderProject = (p) => {
    const sc = STATUS_CONFIG[p.status];
    const logoUrl = revenueLogos[p.id];
    return (
      <button
        key={p.id}
        className={`sidebar-item ${selectedProjectId === p.id ? 'active' : ''}`}
        onClick={() => onSelectProject(p)}
      >
        <span className="sidebar-item-icon sidebar-app-logo">
          <AppLogo logoUrl={logoUrl} fallback={p.logo} color={p.color} size={24} />
        </span>
        <span className="sidebar-item-text">{p.name}</span>
        <span className="sidebar-status-dot" style={{ background: sc?.color || '#94A3B8' }} />
      </button>
    );
  };

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
        {sidebarOpen && (
          <SectionHeader
            label="Navigation"
            open={sections.navigation}
            onToggle={() => toggleSection('navigation')}
          />
        )}
        {showNavItems && (
          <>
            <button
              className={`sidebar-item ${activeView === 'dashboard' ? 'active' : ''}`}
              onClick={() => onNavigate('dashboard')}
            >
              <span className="sidebar-item-icon">📊</span>
              {sidebarOpen && <span className="sidebar-item-text">Dashboard</span>}
            </button>
            <button
              className={`sidebar-item ${activeView === 'client-jobs' ? 'active' : ''}`}
              onClick={() => onNavigate('client-jobs')}
            >
              <span className="sidebar-item-icon">💼</span>
              {sidebarOpen && <span className="sidebar-item-text">Client Jobs</span>}
            </button>
            <button
              className={`sidebar-item ${activeView === 'contacts' ? 'active' : ''}`}
              onClick={() => onNavigate('contacts')}
            >
              <span className="sidebar-item-icon">👥</span>
              {sidebarOpen && <span className="sidebar-item-text">Contacts</span>}
            </button>
            <button className={`sidebar-item ${activeView === 'aso' ? 'active' : ''}`} onClick={() => onNavigate('aso')}>
              <span className="sidebar-item-icon">📈</span>
              {sidebarOpen && <span className="sidebar-item-text">ASO</span>}
            </button>
            <button
              className={`sidebar-item ${activeView === 'revenue' ? 'active' : ''}`}
              onClick={() => onNavigate('revenue')}
            >
              <span className="sidebar-item-icon">💰</span>
              {sidebarOpen && <span className="sidebar-item-text">Revenue</span>}
            </button>
            <button
              className={`sidebar-item ${activeView === 'expenses' ? 'active' : ''}`}
              onClick={() => onNavigate('expenses')}
            >
              <span className="sidebar-item-icon">🧾</span>
              {sidebarOpen && <span className="sidebar-item-text">Expenses</span>}
            </button>
            <button
              className={`sidebar-item ${activeView === 'subscriptions' ? 'active' : ''}`}
              onClick={() => onNavigate('subscriptions')}
            >
              <span className="sidebar-item-icon">💳</span>
              {sidebarOpen && <span className="sidebar-item-text">Subscriptions</span>}
            </button>
            <button
              className={`sidebar-item ${activeView === 'calendar' ? 'active' : ''}`}
              onClick={() => onNavigate('calendar')}
            >
              <span className="sidebar-item-icon">📅</span>
              {sidebarOpen && <span className="sidebar-item-text">Calendar</span>}
            </button>
            <button
              className={`sidebar-item ${activeView === 'todos' ? 'active' : ''}`}
              onClick={() => onNavigate('todos')}
            >
              <span className="sidebar-item-icon">✅</span>
              {sidebarOpen && <span className="sidebar-item-text">To Do</span>}
            </button>
            <button
              className={`sidebar-item ${activeView === 'review-requests' ? 'active' : ''}`}
              onClick={() => onNavigate('review-requests')}
            >
              <span className="sidebar-item-icon">⭐</span>
              {sidebarOpen && <span className="sidebar-item-text">Review Requests</span>}
            </button>
            <button
              className={`sidebar-item ${activeView === 'hq' ? 'active' : ''}`}
              onClick={() => onNavigate('hq')}
            >
              <span className="sidebar-item-icon">🏢</span>
              {sidebarOpen && <span className="sidebar-item-text">DAL HQ</span>}
            </button>
            <button
              className={`sidebar-item ${activeView === 'blog' ? 'active' : ''}`}
              onClick={() => onNavigate('blog')}
            >
              <span className="sidebar-item-icon">📝</span>
              {sidebarOpen && <span className="sidebar-item-text">Blog</span>}
            </button>
            <button
              className={`sidebar-item ${activeView === 'tools' ? 'active' : ''}`}
              onClick={() => onNavigate('tools')}
            >
              <span className="sidebar-item-icon">🔧</span>
              {sidebarOpen && <span className="sidebar-item-text">Tools</span>}
            </button>
          </>
        )}

        {sidebarOpen && (
          <>
            <SectionHeader
              label="Your Apps"
              open={sections.apps}
              onToggle={() => toggleSection('apps')}
            />
            {showApps && ownApps.map(renderProject)}

            <SectionHeader
              label="Websites / Web Apps"
              open={sections.websites}
              onToggle={() => toggleSection('websites')}
            />
            {showWebsites && webApps.map(renderProject)}
          </>
        )}
      </nav>

      <button className="sidebar-add-btn" onClick={onAddProject}>
        {sidebarOpen ? '+ Add Project' : '+'}
      </button>
      <button className="sidebar-logout-btn" onClick={onLogout} title="Sign out">
        {sidebarOpen ? 'Sign Out' : '⎋'}
      </button>
    </aside>
  );
}
