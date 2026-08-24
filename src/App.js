import React, { useState, useEffect } from 'react';
import { db } from './firebase';
import { collection, onSnapshot, doc, setDoc, query, where } from 'firebase/firestore';
import { PIPELINE_APPS } from './data/initialData';
import Dashboard from './components/Dashboard';
import ASODashboard from './components/ASODashboard';
import SubscriptionsDashboard from './components/SubscriptionsDashboard';
import RevenueDashboard from './components/RevenueDashboard';
import CalendarDashboard from './components/CalendarDashboard';
import TodoDashboard from './components/TodoDashboard';
import ReviewRequestsDashboard from './components/ReviewRequestsDashboard';
import DALHeadquarters from './components/DALHeadquarters';
import BlackBox from './components/BlackBox';
import BlogAdmin from './pages/BlogAdmin';
import ToolsHub from './pages/ToolsHub';
import ExpensesTab from './tabs/ExpensesTab';
import ProjectDetail from './components/ProjectDetail';
import ClientJobsDashboard from './components/ClientJobsDashboard';
import MaintenanceTab from './components/MaintenanceTab';
import Contacts from './components/Contacts';
import Sidebar from './components/Sidebar';
import { QuotesUnreadListener } from './tabs/QuotesTab';
import AddProjectModal from './components/AddProjectModal';
import LoginScreen from './components/LoginScreen';
import AuthLoadingScreen from './components/AuthLoadingScreen';
import { useAuth } from './contexts/AuthContext';
import { GoogleCalendarProvider } from './contexts/GoogleCalendarContext';
import './App.css';

function App() {
  const { user, authLoading } = useAuth();

  if (authLoading) {
    return <AuthLoadingScreen />;
  }

  if (!user) {
    return <LoginScreen />;
  }

  return <DashboardApp />;
}

function DashboardApp() {
  const { logout } = useAuth();
  const [projects, setProjects] = useState([]);
  const [revenueLogos, setRevenueLogos] = useState({});
  const [loading, setLoading] = useState(true);
  const [pipelineItems, setPipelineItems] = useState([]);
  const [pipelineSeeded, setPipelineSeeded] = useState(false);
  const [activeView, setActiveView] = useState('dashboard');
  const [selectedProject, setSelectedProject] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addModalProjectType, setAddModalProjectType] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toast, setToast] = useState('');
  const [contactsUnread, setContactsUnread] = useState(0);
  const [clientJobsUnread, setClientJobsUnread] = useState(0);
  const [projectsUnread, setProjectsUnread] = useState({}); // { projectId: count }
  const [maintenanceOverdue, setMaintenanceOverdue] = useState(0);
  const [quotesUnread, setQuotesUnread] = useState(0);
  const [websitesSeedVersion, setWebsitesSeedVersion] = useState(0);

  useEffect(() => {
    const timeoutId = setTimeout(() => setLoading(false), 8000);

    const unsub = onSnapshot(
      collection(db, 'projects'),
      (snapshot) => {
        clearTimeout(timeoutId);
        const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        setProjects(data);
        setLoading(false);
      },
      () => {
        clearTimeout(timeoutId);
        setLoading(false);
      }
    );

    return () => {
      clearTimeout(timeoutId);
      unsub();
    };
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'revenue'), (snapshot) => {
      const logos = {};
      snapshot.docs.forEach(d => {
        if (d.data().logoUrl) logos[d.id] = d.data().logoUrl;
      });
      setRevenueLogos(logos);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'pipeline'), async (snapshot) => {
      if (snapshot.empty && !pipelineSeeded) {
        setPipelineSeeded(true);
        await Promise.all(
          PIPELINE_APPS.map(item =>
            setDoc(doc(db, 'pipeline', item.id), item, { merge: true })
          )
        );
        return;
      }

      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setPipelineItems(data);
    });
    return () => unsub();
  }, [pipelineSeeded]);

  useEffect(() => {
    const q = query(
      collection(db, 'clientEmails'),
      where('source', '==', 'project'),
      where('direction', '==', 'inbound'),
      where('read', '==', false)
    );
    const unsub = onSnapshot(q, (snap) => {
      const counts = {};
      snap.docs.forEach(d => {
        const projectId = d.data().projectId;
        if (projectId) {
          counts[projectId] = (counts[projectId] || 0) + 1;
        }
      });
      setProjectsUnread(counts);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const jobIds = new Set(
      projects.filter((p) => p.projectType === 'Client Job').map((p) => p.id)
    );
    const q = query(
      collection(db, 'clientEmails'),
      where('source', '==', 'project'),
      where('direction', '==', 'inbound'),
      where('read', '==', false)
    );
    const unsub = onSnapshot(q, (snap) => {
      let count = 0;
      snap.docs.forEach((d) => {
        if (jobIds.has(d.data().projectId)) count += 1;
      });
      setClientJobsUnread(count);
    });
    return () => unsub();
  }, [projects]);

  useEffect(() => {
    if (loading || websitesSeedVersion === 2) return undefined;
    const seeds = [
      { id: 'dal-website', name: 'Dream App Lab', hasBlog: true, websiteUrl: 'https://dreamapplab.com' },
      { id: 'my-class-log', name: 'My Class Log', hasBlog: true, websiteUrl: 'https://myclasslog.com' },
      { id: 'my-rv-vault', name: 'My RV Vault', hasBlog: true, websiteUrl: 'https://myrrvault.com' },
      { id: 'ten-miles-ahead', name: 'Ten Miles Ahead', hasBlog: true, websiteUrl: 'https://tenmilesahead.com' },
      { id: 'the-shady-duck', name: 'The Shady Duck', hasBlog: false, websiteUrl: 'https://theshadyduck.com' },
    ];
    let cancelled = false;
    (async () => {
      await Promise.all(
        seeds.map((seed) => {
          const existing = projects.find((p) => p.id === seed.id);
          const payload = {
            id: seed.id,
            name: seed.name,
            type: 'website',
            projectType: 'Website',
            platform: 'web',
            hasBlog: seed.hasBlog,
            websiteUrl: seed.websiteUrl,
            updatedAt: new Date().toISOString(),
          };
          if (!existing) {
            payload.status = 'live';
            payload.logo = '🌐';
            payload.color = '#F59E0B';
            payload.tagline = '';
            payload.createdAt = new Date().toISOString();
          }
          return setDoc(doc(db, 'projects', seed.id), payload, { merge: true });
        })
      );
      if (!cancelled) setWebsitesSeedVersion(2);
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, projects, websitesSeedVersion]);

  useEffect(() => {
    const q = query(
      collection(db, 'maintenanceCycles'),
      where('completedAt', '==', null)
    );
    const unsub = onSnapshot(q, (snap) => {
      const now = new Date();
      const today = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
      ].join('-');
      let count = 0;
      snap.docs.forEach((d) => {
        const dueDate = d.data().dueDate;
        if (dueDate && dueDate < today) count += 1;
      });
      setMaintenanceOverdue(count);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(
      collection(db, 'clientEmails'),
      where('direction', '==', 'inbound'),
      where('read', '==', false)
    );
    const unsub = onSnapshot(q, (snap) => {
      const count = snap.size;
      document.title = count > 0 ? `(${count}) DAL Mission Control` : 'DAL Mission Control';
    });
    return () => {
      unsub();
      document.title = 'DAL Mission Control';
    };
  }, []);

  const handleSelectProject = (project) => {
    setSelectedProject(project);
    setActiveView('project');
  };

  const showToast = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 4000);
  };

  const handleUpdateProject = async (updatedProject) => {
    const withStamp = { ...updatedProject, updatedAt: new Date().toISOString() };
    await setDoc(doc(db, 'projects', withStamp.id), withStamp, { merge: true });
    setSelectedProject(withStamp);
  };

  const handleAddProject = async (newProject) => {
    await setDoc(doc(db, 'projects', newProject.id), newProject, { merge: true });
    setShowAddModal(false);
    setAddModalProjectType('');
  };

  const openAddModal = (projectType = '') => {
    setAddModalProjectType(projectType);
    setShowAddModal(true);
  };

  const handleDeleteProject = async () => {
    setActiveView('dashboard');
    setSelectedProject(null);
  };

  const currentProject = selectedProject
    ? projects.find(p => p.id === selectedProject.id) || selectedProject
    : null;

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0a0f1e', color: '#fff', fontSize: 18 }}>
        Loading Mission Control...
      </div>
    );
  }

  return (
    <GoogleCalendarProvider>
    <div className="app-shell">
      <Sidebar
        projects={projects}
        revenueLogos={revenueLogos}
        activeView={activeView}
        selectedProjectId={currentProject?.id}
        onNavigate={setActiveView}
        onSelectProject={handleSelectProject}
        onAddProject={() => openAddModal('')}
        onLogout={logout}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        contactsUnread={contactsUnread}
        clientJobsUnread={clientJobsUnread}
        projectsUnread={projectsUnread}
        maintenanceOverdue={maintenanceOverdue}
        quotesUnread={quotesUnread}
      />
      <main className={`main-content ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
        {activeView === 'dashboard' && (
          <Dashboard
            projects={projects}
            pipelineItems={pipelineItems}
            onSelectProject={handleSelectProject}
            onAddProject={() => openAddModal('')}
            projectsUnread={projectsUnread}
          />
        )}
        {activeView === 'maintenance' && <MaintenanceTab />}
        {activeView === 'client-jobs' && (
          <ClientJobsDashboard
            projects={projects}
            onSelectProject={handleSelectProject}
            onNewClientJob={() => openAddModal('Client Job')}
          />
        )}
        {activeView === 'contacts' && <Contacts onUnreadCount={setContactsUnread} />}
        {activeView === 'aso' && (
          <ASODashboard projects={projects} />
        )}
        {activeView === 'revenue' && (
          <RevenueDashboard
            projects={projects}
            onLogoUpdated={(appId, logoUrl) => {
              setRevenueLogos(prev => ({ ...prev, [appId]: logoUrl }));
            }}
          />
        )}
        {activeView === 'expenses' && <ExpensesTab />}
        {activeView === 'subscriptions' && (
          <SubscriptionsDashboard projects={projects} />
        )}
        {activeView === 'calendar' && (
          <CalendarDashboard />
        )}
        {activeView === 'todos' && (
          <TodoDashboard />
        )}
        {activeView === 'review-requests' && (
          <ReviewRequestsDashboard projects={projects} />
        )}
        {activeView === 'hq' && <DALHeadquarters />}
        {activeView === 'blackbox' && <BlackBox project={currentProject} />}
        {activeView === 'blog' && <BlogAdmin />}
        {activeView === 'tools' && <ToolsHub />}
        {activeView === 'project' && currentProject && (
          <ProjectDetail
            project={currentProject}
            revenueLogos={revenueLogos}
            onUpdate={handleUpdateProject}
            onDelete={handleDeleteProject}
            onBack={() => setActiveView('dashboard')}
            onOpenProject={handleSelectProject}
            onToast={showToast}
            quotesUnread={quotesUnread}
            onQuotesUnread={setQuotesUnread}
          />
        )}
      </main>
      <QuotesUnreadListener onUnreadCount={setQuotesUnread} />
      {showAddModal && (
        <AddProjectModal
          onAdd={handleAddProject}
          onClose={() => {
            setShowAddModal(false);
            setAddModalProjectType('');
          }}
          defaultProjectType={addModalProjectType}
        />
      )}
      {toast ? (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 2000,
            background: '#0f172a',
            border: '1px solid #4cc1f3',
            color: '#E2E8F0',
            padding: '12px 16px',
            borderRadius: 10,
            boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
            fontSize: 13,
            maxWidth: 360,
          }}
        >
          {toast}
        </div>
      ) : null}
    </div>
    </GoogleCalendarProvider>
  );
}

export default App;
