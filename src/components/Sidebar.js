import React, { useEffect, useState } from 'react';
import { STATUS_CONFIG } from '../data/initialData';
import AppLogo from './AppLogo';

const STORAGE_KEY = 'dal-mc-sidebar-sections';
const DEFAULT_SECTIONS = {
  home: false,
  clients: false,
  utilities: false,
  apps: false,
  websites: false,
};

function loadSections() {
  return { ...DEFAULT_SECTIONS };
}

function byName(a, b) {
  return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
}

function isDalWebsite(project) {
  const id = String(project.id || '').toLowerCase();
  const name = String(project.name || '').toLowerCase();
  return id === 'dal-website' || name.includes('dream app lab');
}

function UnreadBadge({ count }) {
  if (!count) return null;
  return (
    <span style={{
      background: 'var(--coral)',
      color: 'white',
      borderRadius: 10,
      padding: '1px 6px',
      fontSize: 11,
      fontWeight: 700,
      marginLeft: 'auto',
    }}>
      {count}
    </span>
  );
}

function SectionHeader({ label, open, onToggle, badge = 0, unreadDot = false }) {
  return (
    <button
      type="button"
      className="sidebar-section-toggle"
      onClick={onToggle}
      aria-expanded={open}
    >
      <span
        className="sidebar-section-label"
        style={{
          fontSize: 11,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          paddingLeft: 10,
        }}
      >
        {label}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 8 }}>
        {unreadDot && badge > 0 && (
          <span
            className="quotes-unread-dot"
            style={{ background: 'var(--coral)', boxShadow: '0 0 6px rgba(232, 92, 92, 0.55)' }}
            aria-label="Unread"
          />
        )}
        {badge > 0 && <UnreadBadge count={badge} />}
        <span className="sidebar-section-chevron" aria-hidden="true" style={{ paddingRight: 0 }}>
          {open ? '▾' : '▸'}
        </span>
      </span>
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
  contactsUnread = 0,
  clientJobsUnread = 0,
  projectsUnread = {},
  maintenanceOverdue = 0,
  quotesUnread = 0,
  inboundUnread = 0,
  onboardingUploads = 0,
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

  const showHome = !sidebarOpen || sections.home;
  const showClients = !sidebarOpen || sections.clients;
  const showUtilities = !sidebarOpen || sections.utilities;
  const showApps = sidebarOpen && sections.apps;
  const showWebsites = sidebarOpen && sections.websites;
  const ownApps = projects
    .filter((p) => p.type === 'own-app' && p.projectType !== 'Client Job')
    .slice()
    .sort(byName);
  const webApps = projects
    .filter((p) => p.type !== 'own-app' && p.projectType !== 'Client Job')
    .slice()
    .sort(byName);

  const clientsBadge = (inboundUnread || 0) || ((contactsUnread || 0) + (clientJobsUnread || 0));
  const utilitiesBadge = maintenanceOverdue > 0 ? maintenanceOverdue : 0;
  const websitesBadge = (quotesUnread || 0) + (onboardingUploads || 0);

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
        <UnreadBadge
          count={(projectsUnread[p.id] || 0) + (isDalWebsite(p) ? (quotesUnread || 0) + (onboardingUploads || 0) : 0)}
        />
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
            label="Home"
            open={sections.home}
            onToggle={() => toggleSection('home')}
          />
        )}
        {showHome && (
          <>
            <button
              className={`sidebar-item ${activeView === 'dashboard' ? 'active' : ''}`}
              onClick={() => onNavigate('dashboard')}
            >
              <span className="sidebar-item-icon">📊</span>
              {sidebarOpen && <span className="sidebar-item-text">Dashboard</span>}
            </button>
            <button
              className={`sidebar-item ${activeView === 'hq' ? 'active' : ''}`}
              onClick={() => onNavigate('hq')}
            >
              <span className="sidebar-item-icon">🏢</span>
              {sidebarOpen && <span className="sidebar-item-text">DAL HQ</span>}
            </button>
            <button
              className={`sidebar-item ${activeView === 'blackbox' ? 'active' : ''}`}
              onClick={() => onNavigate('blackbox')}
            >
              <span className="sidebar-item-icon">🔒</span>
              {sidebarOpen && <span className="sidebar-item-text">Black Box</span>}
            </button>
            <button
              className={`sidebar-item ${activeView === 'calendar' ? 'active' : ''}`}
              onClick={() => onNavigate('calendar')}
            >
              <span className="sidebar-item-icon">📅</span>
              {sidebarOpen && <span className="sidebar-item-text">Calendar</span>}
            </button>
            <button
              className={`sidebar-item ${activeView === 'expenses' ? 'active' : ''}`}
              onClick={() => onNavigate('expenses')}
            >
              <span className="sidebar-item-icon">🧾</span>
              {sidebarOpen && <span className="sidebar-item-text">Expenses</span>}
            </button>
            <button
              className={`sidebar-item ${activeView === 'revenue' ? 'active' : ''}`}
              onClick={() => onNavigate('revenue')}
            >
              <span className="sidebar-item-icon">💰</span>
              {sidebarOpen && <span className="sidebar-item-text">Revenue</span>}
            </button>
            <button
              className={`sidebar-item ${activeView === 'subscriptions' ? 'active' : ''}`}
              onClick={() => onNavigate('subscriptions')}
            >
              <span className="sidebar-item-icon">💳</span>
              {sidebarOpen && <span className="sidebar-item-text">Subscriptions</span>}
            </button>
          </>
        )}

        {sidebarOpen && (
          <SectionHeader
            label="Clients"
            open={sections.clients}
            onToggle={() => toggleSection('clients')}
            badge={clientsBadge}
            unreadDot
          />
        )}
        {showClients && (
          <>
            <button
              className={`sidebar-item ${activeView === 'client-jobs' ? 'active' : ''}`}
              onClick={() => onNavigate('client-jobs')}
            >
              <span className="sidebar-item-icon">💼</span>
              {sidebarOpen && <span className="sidebar-item-text">Client Jobs</span>}
              <UnreadBadge count={clientJobsUnread} />
            </button>
            <button
              className={`sidebar-item ${activeView === 'contacts' ? 'active' : ''}`}
              onClick={() => onNavigate('contacts')}
            >
              <span className="sidebar-item-icon">👥</span>
              {sidebarOpen && <span className="sidebar-item-text">Contacts</span>}
              <UnreadBadge count={contactsUnread} />
            </button>
          </>
        )}

        {sidebarOpen && (
          <SectionHeader
            label="Utilities"
            open={sections.utilities}
            onToggle={() => toggleSection('utilities')}
            badge={utilitiesBadge}
          />
        )}
        {showUtilities && (
          <>
            <button
              className={`sidebar-item ${activeView === 'maintenance' ? 'active' : ''}`}
              onClick={() => onNavigate('maintenance')}
            >
              <span className="sidebar-item-icon">🛠️</span>
              {sidebarOpen && <span className="sidebar-item-text">Maintenance</span>}
              <UnreadBadge count={maintenanceOverdue} />
            </button>
            <button
              className={`sidebar-item ${activeView === 'review-requests' ? 'active' : ''}`}
              onClick={() => onNavigate('review-requests')}
            >
              <span className="sidebar-item-icon">⭐</span>
              {sidebarOpen && <span className="sidebar-item-text">Review Requests</span>}
            </button>
            <button
              className={`sidebar-item ${activeView === 'todos' ? 'active' : ''}`}
              onClick={() => onNavigate('todos')}
            >
              <span className="sidebar-item-icon">✅</span>
              {sidebarOpen && <span className="sidebar-item-text">To Do</span>}
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
              badge={websitesBadge}
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
