// src/App.js
import React, { useState, useEffect } from 'react';
import { collection, doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { useLocalStorage } from './hooks/useLocalStorage';
import { INITIAL_PROJECTS, PIPELINE_APPS } from './data/initialData';
import Dashboard from './components/Dashboard';
import ASODashboard from './components/ASODashboard';
import ProjectDetail from './components/ProjectDetail';
import Sidebar from './components/Sidebar';
import AddProjectModal from './components/AddProjectModal';
import './App.css';

function App() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let seeded = false;
    const unsubscribe = onSnapshot(collection(db, 'projects'), async (snapshot) => {
      if (snapshot.empty && !seeded) {
        seeded = true;
        await Promise.all(
          INITIAL_PROJECTS.map(project => setDoc(doc(db, 'projects', project.id), project))
        );
        return;
      }
      setProjects(snapshot.docs.map(d => d.data()));
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const [pipeline] = useLocalStorage('dal-pipeline', PIPELINE_APPS);
  const [activeView, setActiveView] = useState('dashboard');
  const [selectedProject, setSelectedProject] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const handleSelectProject = (project) => {
    setSelectedProject(project);
    setActiveView('project');
  };

  const handleUpdateProject = (updatedProject) => {
    setDoc(doc(db, 'projects', updatedProject.id), updatedProject);
    setSelectedProject(updatedProject);
  };

  const handleAddProject = (newProject) => {
    setDoc(doc(db, 'projects', newProject.id), newProject);
    setShowAddModal(false);
  };

  const handleDeleteProject = (projectId) => {
    deleteDoc(doc(db, 'projects', projectId));
    setActiveView('dashboard');
    setSelectedProject(null);
  };

  const currentProject = selectedProject
    ? projects.find(p => p.id === selectedProject.id) || selectedProject
    : null;

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-secondary, #94A3B8)' }}>
        Loading Mission Control...
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar
        projects={projects}
        activeView={activeView}
        selectedProjectId={currentProject?.id}
        onNavigate={setActiveView}
        onSelectProject={handleSelectProject}
        onAddProject={() => setShowAddModal(true)}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
      />
      <main className={`main-content ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
        {activeView === 'dashboard' && (
          <Dashboard
            projects={projects}
            pipeline={pipeline}
            onSelectProject={handleSelectProject}
            onAddProject={() => setShowAddModal(true)}
          />
        )}
        {activeView === 'aso' && <ASODashboard />}
        {activeView === 'project' && currentProject && (
          <ProjectDetail
            project={currentProject}
            onUpdate={handleUpdateProject}
            onDelete={handleDeleteProject}
            onBack={() => setActiveView('dashboard')}
          />
        )}
      </main>
      {showAddModal && (
        <AddProjectModal
          onAdd={handleAddProject}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}

export default App;
