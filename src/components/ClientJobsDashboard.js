import React, { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { STATUS_CONFIG } from '../data/initialData';
import { WEBSITE_PIPELINE } from '../data/websitePipeline';

function formatDate(value) {
  if (!value) return '—';
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusCfg(status) {
  return STATUS_CONFIG[status] || STATUS_CONFIG['in-development'] || {
    label: status || 'Unknown',
    color: '#FACC15',
    bg: 'rgba(234,179,8,0.15)',
  };
}

export default function ClientJobsDashboard({
  projects = [],
  onSelectProject,
  onNewClientJob,
}) {
  const [progress, setProgress] = useState({});

  const jobs = (projects || []).filter((p) => p.projectType === 'Client Job');

  useEffect(() => {
    let cancelled = false;
    async function loadFromQuery() {
      try {
        const snap = await getDocs(query(collection(db, 'projects'), where('projectType', '==', 'Client Job')));
        if (cancelled) return;
        const ids = snap.docs.map((d) => d.id);
        await loadProgress(ids);
      } catch (err) {
        console.error(err);
        if (!cancelled) await loadProgress(jobs.map((j) => j.id));
      }
    }
    async function loadProgress(ids) {
      const map = {};
      await Promise.all(
        ids.map(async (id) => {
          try {
            const pSnap = await getDoc(doc(db, 'projects', id, 'pipeline', 'website'));
            const completed = pSnap.exists() ? pSnap.data().completed || {} : {};
            const done = WEBSITE_PIPELINE.phases.reduce(
              (sum, ph) => sum + ph.tasks.filter((t) => completed[t.id] === true).length,
              0
            );
            map[id] = WEBSITE_PIPELINE.total
              ? Math.round((done / WEBSITE_PIPELINE.total) * 100)
              : 0;
          } catch {
            map[id] = 0;
          }
        })
      );
      if (!cancelled) setProgress(map);
    }
    loadFromQuery();
    return () => {
      cancelled = true;
    };
  }, [jobs.map((j) => j.id).join('|')]);

  return (
    <div className="dashboard">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>Client Jobs</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
            Client website and job projects with pipeline progress.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={onNewClientJob}>
          + New Client Job
        </button>
      </div>

      {jobs.length === 0 ? (
        <div className="empty-state" style={{ marginTop: 40 }}>
          <div className="empty-state-text">No client jobs yet. Add one to get started.</div>
        </div>
      ) : (
        <div className="projects-grid" style={{ marginTop: 24 }}>
          {jobs.map((job) => {
            const sc = statusCfg(job.status);
            const pct = progress[job.id] ?? 0;
            return (
              <div key={job.id} className="project-card" onClick={() => onSelectProject(job)}>
                <div className="project-card-accent" style={{ background: 'linear-gradient(90deg, #FACC15, transparent)' }} />
                <div className="project-card-top">
                  <div>
                    <div className="project-name">{job.name}</div>
                    <div className="project-tagline">{job.clientName || job.tagline || '—'}</div>
                  </div>
                  <span className="status-badge" style={{ background: sc.bg, color: sc.color }}>
                    {sc.label}
                  </span>
                </div>
                <div className="progress-section">
                  <div className="progress-header">
                    <span>Pipeline</span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: '#FACC15' }}>{pct}% complete</span>
                  </div>
                  <div className="progress-track">
                    <div
                      className="progress-fill"
                      style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #FACC15, #F59E0B)' }}
                    />
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
                  Updated {formatDate(job.updatedAt || job.createdAt)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
