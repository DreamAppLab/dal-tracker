import React, { useState } from 'react';

const SUBVIEWS = [
  { key: 'this-month', label: 'This Month' },
  { key: 'by-app', label: 'By App' },
];

export default function MaintenanceTab() {
  const [subView, setSubView] = useState('this-month');

  return (
    <div className="dashboard">
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>Maintenance</h1>
          <p className="page-subtitle" style={{ margin: 0 }}>
            App maintenance schedules and recurring tasks
          </p>
        </div>
      </div>

      <div className="todo-filters" style={{ marginBottom: 16 }}>
        {SUBVIEWS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`todo-filter-btn ${subView === key ? 'active' : ''}`}
            onClick={() => setSubView(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="data-section">
        {subView === 'this-month' && (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            This month’s cycles will appear here.
          </div>
        )}
        {subView === 'by-app' && (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Per-app schedules will appear here.
          </div>
        )}
      </div>
    </div>
  );
}
