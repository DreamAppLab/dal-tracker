import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

const ACCENT = '#4cc1f3';

const BADGE_STYLE = {
  security: { label: '🔒 SECURITY', color: '#F87171', bg: 'rgba(248,113,113,0.15)' },
  critical: { label: '⚠️ Critical', color: '#F87171', bg: 'rgba(248,113,113,0.15)' },
  blackbox: { label: '📦 Black Box', color: '#C4B5FD', bg: 'rgba(139,92,246,0.18)' },
  lesson: { label: '⚠️ Lesson Learned', color: '#FACC15', bg: 'rgba(234,179,8,0.16)' },
};

function isDone(completed, id) {
  return completed?.[id] === true;
}

function PipelineBadge({ kind }) {
  const s = BADGE_STYLE[kind];
  if (!s) return null;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.02em',
        color: s.color,
        background: s.bg,
        border: `1px solid ${s.color}44`,
        borderRadius: 999,
        padding: '2px 8px',
        marginRight: 6,
        marginTop: 4,
      }}
    >
      {s.label}
    </span>
  );
}

export default function PipelineChecklist({ projectId, pipelineDocId, data }) {
  const [completed, setCompleted] = useState({});
  const [loading, setLoading] = useState(true);
  const [openPhases, setOpenPhases] = useState(() =>
    data.phases[0] ? { [data.phases[0].id]: true } : {}
  );
  const [toggling, setToggling] = useState(null);

  const load = useCallback(async () => {
    if (!projectId || !pipelineDocId) return;
    setLoading(true);
    try {
      const snap = await getDoc(doc(db, 'projects', projectId, 'pipeline', pipelineDocId));
      setCompleted(snap.exists() ? snap.data().completed || {} : {});
    } catch (err) {
      console.error('Pipeline load failed:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId, pipelineDocId]);

  useEffect(() => {
    load();
  }, [load]);

  const doneCount = useMemo(
    () => data.phases.reduce((sum, ph) => sum + ph.tasks.filter((t) => isDone(completed, t.id)).length, 0),
    [data.phases, completed]
  );
  const pct = data.total ? Math.round((doneCount / data.total) * 100) : 0;

  const toggleTask = async (taskId) => {
    if (!projectId || toggling) return;
    const nextVal = !isDone(completed, taskId);
    const prev = completed;
    setToggling(taskId);
    setCompleted((c) => ({ ...c, [taskId]: nextVal }));
    try {
      await setDoc(
        doc(db, 'projects', projectId, 'pipeline', pipelineDocId),
        {
          completed: { [taskId]: nextVal },
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (err) {
      console.error('Pipeline save failed:', err);
      setCompleted(prev);
    } finally {
      setToggling(null);
    }
  };

  if (loading) {
    return (
      <div className="data-section" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading pipeline…</div>
      </div>
    );
  }

  return (
    <div className="data-section pipeline-checklist">
      <div style={{ marginBottom: 6, fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700 }}>
        {data.title}
      </div>
      <div className="progress-section" style={{ marginBottom: 18 }}>
        <div className="progress-header">
          <span>
            {doneCount} of {data.total} tasks complete — {pct}%
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', color: ACCENT }}>{pct}%</span>
        </div>
        <div className="progress-track" style={{ height: 8 }}>
          <div
            className="progress-fill"
            style={{ width: `${pct}%`, background: ACCENT, transition: 'width 0.3s' }}
          />
        </div>
      </div>

      {data.phases.map((phase) => {
        const phaseDone = phase.tasks.filter((t) => isDone(completed, t.id)).length;
        const open = !!openPhases[phase.id];
        return (
          <div
            key={phase.id}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 10,
              marginBottom: 12,
              overflow: 'hidden',
              background: 'var(--bg-card)',
            }}
          >
            <button
              type="button"
              onClick={() => setOpenPhases((s) => ({ ...s, [phase.id]: !s[phase.id] }))}
              style={{
                width: '100%',
                textAlign: 'left',
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                padding: '14px 16px',
                fontFamily: 'inherit',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
                    {open ? '▾' : '▸'} {phase.title}
                  </div>
                  {phase.note ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, marginLeft: 18 }}>
                      {phase.note}
                    </div>
                  ) : null}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: ACCENT, whiteSpace: 'nowrap' }}>
                  {phaseDone}/{phase.tasks.length}
                </div>
              </div>
            </button>
            {open &&
              phase.tasks.map((task) => {
                const done = isDone(completed, task.id);
                return (
                  <div
                    key={task.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleTask(task.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleTask(task.id);
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      padding: '12px 16px',
                      borderTop: '1px solid var(--border)',
                      cursor: toggling === task.id ? 'wait' : 'pointer',
                      background: done ? 'rgba(34,197,94,0.06)' : 'transparent',
                    }}
                  >
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 6,
                        flexShrink: 0,
                        marginTop: 1,
                        border: `2px solid ${done ? '#22C55E' : 'var(--border)'}`,
                        background: done ? '#22C55E' : 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 12,
                        color: '#fff',
                        fontWeight: 700,
                      }}
                    >
                      {done ? '✓' : ''}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: done ? 'var(--text-muted)' : 'var(--text-primary)',
                          textDecoration: done ? 'line-through' : 'none',
                          lineHeight: 1.35,
                        }}
                      >
                        <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginRight: 8, fontSize: 12 }}>
                          {task.num}.
                        </span>
                        {task.text}
                      </div>
                      {task.note ? (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.45 }}>
                          {task.note}
                        </div>
                      ) : null}
                      {task.badges?.length > 0 && (
                        <div style={{ marginTop: 2 }}>
                          {task.badges.map((b) => (
                            <PipelineBadge key={b} kind={b} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
