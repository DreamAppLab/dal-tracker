// src/App.js
import React, { useState } from 'react';
import { useLocalStorage } from './hooks/useLocalStorage';
import { INITIAL_PROJECTS, PIPELINE_APPS } from './data/initialData';
import Dashboard from './components/Dashboard';
import ASODashboard from './components/ASODashboard';
import ProjectDetail from './components/ProjectDetail';
import Sidebar from './components/Sidebar';
import AddProjectModal from './components/AddProjectModal';
import './App.css';

function App() {
  const [projects, setProjects] = useLocalStorage('dal-projects', INITIAL_PROJECTS);
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
    setProjects(prev => prev.map(p => p.id === updatedProject.id ? updatedProject : p));
    setSelectedProject(updatedProject);
  };

  const handleAddProject = (newProject) => {
    setProjects(prev => [...prev, newProject]);
    setShowAddModal(false);
  };

  const handleDeleteProject = (projectId) => {
    setProjects(prev => prev.filter(p => p.id !== projectId));
    setActiveView('dashboard');
    setSelectedProject(null);
  };

  const currentProject = selectedProject
    ? projects.find(p => p.id === selectedProject.id) || selectedProject
    : null;

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
