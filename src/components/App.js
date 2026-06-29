import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { PIPELINE_APPS } from '../data/initialData';
import Dashboard from './Dashboard';
import ProjectDetail from './ProjectDetail';
import Sidebar from './Sidebar';
import AddProjectModal from './AddProjectModal';
import '../App.css';

function App() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pipeline] = useState(PIPELINE_APPS);
  const [activeView, setActiveView] = useState('dashboard');
  const [selectedProject, setSelectedProject] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'projects'), (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setProjects(data);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const handleSelectProject = (project) => {
    setSelectedProject(project);
    setActiveView('project');
  };

  const handleUpdateProject = async (updatedProject) => {
    await setDoc(doc(db, 'projects', updatedProject.id), updatedProject);
    setSelectedProject(updatedProject);
  };

  const handleAddProject = async (newProject) => {
    await setDoc(doc(db, 'projects', newProject.id), newProject);
    setShowAddModal(false);
  };

  const handleDeleteProject = async (projectId) => {
    await deleteDoc(doc(db, 'projects', projectId));
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
