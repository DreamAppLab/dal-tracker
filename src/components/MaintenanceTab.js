import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, onSnapshot, doc, updateDoc, Timestamp, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { seedAllApps } from '../utils/seedMaintenanceTasks';
import { generateCyclesForApp } from '../utils/generateMaintenanceCycles';

const SUBVIEWS = [
  { key: 'this-month', label: 'This Month' },
  { key: 'by-app', label: 'By App' },
];

const CONFIG_FLAGS = [
  ['hasFirebase', 'Firebase'],
  ['hasCloudFunctions', 'Functions'],
  ['hasRevenueCat', 'RevenueCat'],
  ['hasSentry', 'Sentry'],
  ['hasCrisp', 'Crisp'],
  ['hasWebEndpoints', 'Web'],
  ['hasFreeTrial', 'Free Trial'],
  ['liveIOS', 'iOS Live'],
  ['liveAndroid', 'Android Live'],
];

const ACCENT = '#4cc1f3';

function todayYmd() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return [
    dt.getFullYear(),
    String(dt.getMonth() + 1).padStart(2, '0'),
    String(dt.getDate()).padStart(2, '0'),
  ].join('-');
}

function inCurrentMonth(dueDate) {
  if (!dueDate) return false;
  const now = new Date();
  const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return dueDate.startsWith(prefix);
}

function formatDue(dueDate) {
  if (!dueDate) return '—';
  const [y, m, d] = dueDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function isComplete(cycle) {
  return cycle.completedAt != null;
}

function isOverdue(cycle, today) {
  return !isComplete(cycle) && cycle.dueDate && cycle.dueDate < today;
}

function isDueSoon(cycle, today) {
  if (isComplete(cycle) || isOverdue(cycle, today) || !cycle.dueDate) return false;
  return cycle.dueDate <= addDaysYmd(today, 7);
}

function taskCounts(cycle) {
  const tasks = cycle.tasks || [];
  const done = tasks.filter((t) => t.done).length;
  return { done, total: tasks.length };
}

function classifyCycle(cycle, today) {
  if (isComplete(cycle)) return 'completed';
  if (isOverdue(cycle, today)) return 'overdue';
  if (inCurrentMonth(cycle.dueDate)) return 'thisMonth';
  return 'upcoming';
}

function StatusBadge({ cycle, today }) {
  let label = '';
  let color = '#94A3B8';
  let bg = 'rgba(148,163,184,0.15)';
  if (isComplete(cycle)) {
    label = 'Complete';
    color = '#22C55E';
    bg = 'rgba(34,197,94,0.15)';
  } else if (isOverdue(cycle, today)) {
    label = 'Overdue';
    color = '#F87171';
    bg = 'rgba(248,113,113,0.15)';
  } else if (isDueSoon(cycle, today)) {
    label = 'Due soon';
    color = '#FACC15';
    bg = 'rgba(234,179,8,0.16)';
  } else {
    return null;
  }
  return (
    <span className="status-badge" style={{ background: bg, color }}>
      {label}
    </span>
  );
}

function ConfigBadges({ config = {} }) {
  const flags = CONFIG_FLAGS.filter(([key]) => config[key]).map(([, label]) => label);
  const services = config.services || [];
  const items = [...flags, ...services];
  if (items.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
      {items.map((label) => (
        <span
          key={label}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.02em',
            color: ACCENT,
            background: 'rgba(76,193,243,0.12)',
            border: `1px solid ${ACCENT}44`,
            borderRadius: 999,
            padding: '2px 8px',
          }}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function CycleCard({ cycle, today, expanded, onToggleExpand, onToggleTask, toggling }) {
  const { done, total } = taskCounts(cycle);
  return (
    <div
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
        onClick={onToggleExpand}
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
              {expanded ? '▾' : '▸'} {cycle.label || 'Cycle'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, marginLeft: 18 }}>
              Due {formatDue(cycle.dueDate)} · {done}/{total} tasks
            </div>
          </div>
          <StatusBadge cycle={cycle} today={today} />
        </div>
      </button>
      {expanded &&
        (cycle.tasks || []).map((task, index) => {
          const doneTask = !!task.done;
          const busy = toggling === `${cycle.cycleId}:${task.taskId}`;
          return (
            <div
              key={task.taskId || index}
              role="button"
              tabIndex={0}
              onClick={() => !busy && onToggleTask(cycle, index)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (!busy) onToggleTask(cycle, index);
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: '12px 16px',
                borderTop: '1px solid var(--border)',
                cursor: busy ? 'wait' : 'pointer',
                background: doneTask ? 'rgba(34,197,94,0.06)' : 'transparent',
              }}
            >
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  flexShrink: 0,
                  marginTop: 1,
                  border: `2px solid ${doneTask ? '#22C55E' : 'var(--border)'}`,
                  background: doneTask ? '#22C55E' : 'transparent',
                }}
              />
              <div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    textDecoration: doneTask ? 'line-through' : 'none',
                  }}
                >
                  {task.label}
                </div>
                {task.description ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    {task.description}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
    </div>
  );
}

function AppCycleList({ cycles, today, expanded, setExpanded, onToggleTask, toggling }) {
  if (cycles.length === 0) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '8px 0' }}>
        No cycles in this group.
      </div>
    );
  }
  return cycles.map((cycle) => (
    <CycleCard
      key={cycle.cycleId || cycle.id}
      cycle={cycle}
      today={today}
      expanded={!!expanded[cycle.cycleId || cycle.id]}
      onToggleExpand={() => {
        const id = cycle.cycleId || cycle.id;
        setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
      }}
      onToggleTask={onToggleTask}
      toggling={toggling}
    />
  ));
}

const MaintenanceTab = React.memo(function MaintenanceTab() {
  const [subView, setSubView] = useState('this-month');
  const [schedules, setSchedules] = useState(null);
  const [cycles, setCycles] = useState([]);
  const [initializing, setInitializing] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [toggling, setToggling] = useState(null);
  const [selectedAppId, setSelectedAppId] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncCount, setSyncCount] = useState(null);

  const today = todayYmd();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const snap = await getDocs(collection(db, 'maintenanceSchedules'));
      if (cancelled) return;
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setSchedules(rows);
      if (rows[0]) setSelectedAppId((prev) => prev || rows[0].appId);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'maintenanceCycles'), (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      rows.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
      setCycles(rows);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!schedules || schedules.length === 0) return undefined;
    let cancelled = false;
    (async () => {
      for (const schedule of schedules) {
        if (cancelled) return;
        await generateCyclesForApp(schedule.appId, schedule);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schedules]);

  const selectedSchedule = useMemo(
    () => (schedules || []).find((s) => s.appId === selectedAppId) || (schedules || [])[0],
    [schedules, selectedAppId]
  );

  const thisMonthByApp = useMemo(() => {
    const monthCycles = cycles.filter((c) => inCurrentMonth(c.dueDate));
    const groups = [];
    const seen = new Map();
    monthCycles.forEach((cycle) => {
      const key = cycle.appId || cycle.appName;
      if (!seen.has(key)) {
        seen.set(key, groups.length);
        groups.push({ appId: cycle.appId, appName: cycle.appName || cycle.appId, cycles: [] });
      }
      groups[seen.get(key)].cycles.push(cycle);
    });
    groups.sort((a, b) => String(a.appName).localeCompare(String(b.appName)));
    return groups;
  }, [cycles]);

  const byAppGroups = useMemo(() => {
    const appCycles = cycles.filter((c) => c.appId === (selectedSchedule?.appId || selectedAppId));
    const buckets = { overdue: [], thisMonth: [], upcoming: [], completed: [] };
    appCycles.forEach((cycle) => {
      buckets[classifyCycle(cycle, today)].push(cycle);
    });
    return buckets;
  }, [cycles, selectedSchedule, selectedAppId, today]);

  const handleSyncAllToCalendar = async () => {
    setSyncing(true);
    setSyncCount(null);
    try {
      const snap = await getDocs(
        query(collection(db, 'maintenanceCycles'), where('calendarEventId', '==', null))
      );
      let synced = 0;
      for (const d of snap.docs) {
        const cycle = { id: d.id, ...d.data() };
        const cycleId = cycle.cycleId || d.id;
        try {
          const res = await fetch('/api/calendar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'create',
              cycleId,
              appName: cycle.appName,
              label: cycle.label,
              dueDate: cycle.dueDate,
              tasks: (cycle.tasks || []).map((t) => t.label),
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.calendarEventId) {
            console.error('Calendar sync failed for', cycleId, data.error || res.status);
            continue;
          }
          await updateDoc(doc(db, 'maintenanceCycles', cycleId), {
            calendarEventId: data.calendarEventId,
          });
          synced += 1;
        } catch (err) {
          console.error('Calendar sync failed for', cycleId, err);
        }
      }
      setSyncCount(synced);
    } catch (err) {
      console.error('Calendar backfill failed:', err);
      setSyncCount(0);
    } finally {
      setSyncing(false);
    }
  };

  const handleInit = async () => {
    setInitializing(true);
    try {
      await seedAllApps();
      const snap = await getDocs(collection(db, 'maintenanceSchedules'));
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setSchedules(rows);
      if (rows[0]) setSelectedAppId(rows[0].appId);
      await Promise.all(rows.map((s) => generateCyclesForApp(s.appId, s)));
    } catch (err) {
      console.error('Failed to initialize maintenance schedules:', err);
    } finally {
      setInitializing(false);
    }
  };

  const handleToggleTask = async (cycle, index) => {
    const tasks = [...(cycle.tasks || [])];
    const current = tasks[index];
    if (!current) return;
    const nextDone = !current.done;
    tasks[index] = {
      ...current,
      done: nextDone,
      doneAt: nextDone ? Timestamp.now() : null,
    };
    const allDone = tasks.length > 0 && tasks.every((t) => t.done);
    const cycleId = cycle.cycleId || cycle.id;
    setToggling(`${cycleId}:${current.taskId}`);
    try {
      await updateDoc(doc(db, 'maintenanceCycles', cycleId), {
        tasks,
        completedAt: allDone ? Timestamp.now() : null,
      });
      if (allDone && cycle.calendarEventId) {
        try {
          const res = await fetch('/api/calendar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'update',
              calendarEventId: cycle.calendarEventId,
              appName: cycle.appName,
              label: cycle.label,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data.error) {
            console.error('Calendar update failed:', data.error || res.status);
          }
        } catch (calErr) {
          console.error('Calendar update failed:', calErr);
        }
      }
    } catch (err) {
      console.error('Failed to update maintenance task:', err);
    } finally {
      setToggling(null);
    }
  };

  if (schedules === null) {
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
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading schedules…</div>
      </div>
    );
  }

  const showInit = schedules.length === 0;

  return (
    <div className="dashboard">
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>Maintenance</h1>
          <p className="page-subtitle" style={{ margin: 0 }}>
            App maintenance schedules and recurring tasks
          </p>
        </div>
        {!showInit && (
          <div className="page-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleSyncAllToCalendar}
              disabled={syncing}
            >
              {syncing ? 'Syncing…' : 'Sync All to Calendar'}
            </button>
            {syncing && (
              <>
                <span
                  style={{
                    width: 16,
                    height: 16,
                    border: '2px solid var(--border)',
                    borderTopColor: '#4cc1f3',
                    borderRadius: '50%',
                    display: 'inline-block',
                    animation: 'maint-cal-spin 0.8s linear infinite',
                  }}
                  aria-hidden="true"
                />
                <style>{`@keyframes maint-cal-spin { to { transform: rotate(360deg); } }`}</style>
              </>
            )}
            {!syncing && syncCount !== null && (
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                {syncCount} synced
              </span>
            )}
          </div>
        )}
      </div>

      {showInit && (
        <div className="data-section" style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Initialize schedules</div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 16px' }}>
            Seed task definitions for all 6 DAL apps, then generate cycles from September 1, 2026.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleInit}
            disabled={initializing}
          >
            {initializing ? 'Initializing…' : 'Initialize Maintenance Schedules'}
          </button>
        </div>
      )}

      {!showInit && (
        <>
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

          {subView === 'this-month' && (
            thisMonthByApp.length === 0 ? (
              <div className="data-section">
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                  No cycles due this month.
                </div>
              </div>
            ) : (
              thisMonthByApp.map((group) => (
                <div key={group.appId} style={{ marginBottom: 28 }}>
                  <div
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 16,
                      fontWeight: 700,
                      marginBottom: 10,
                    }}
                  >
                    {group.appName}
                  </div>
                  <AppCycleList
                    cycles={group.cycles}
                    today={today}
                    expanded={expanded}
                    setExpanded={setExpanded}
                    onToggleTask={handleToggleTask}
                    toggling={toggling}
                  />
                </div>
              ))
            )
          )}

          {subView === 'by-app' && selectedSchedule && (
            <>
              <div className="todo-filters" style={{ marginBottom: 12 }}>
                {(schedules || []).map((s) => (
                  <button
                    key={s.appId}
                    type="button"
                    className={`todo-filter-btn ${selectedSchedule.appId === s.appId ? 'active' : ''}`}
                    onClick={() => setSelectedAppId(s.appId)}
                  >
                    {s.appName}
                  </button>
                ))}
              </div>
              <div className="data-section" style={{ marginBottom: 20 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{selectedSchedule.appName}</div>
                <ConfigBadges config={selectedSchedule.config} />
              </div>
              {[
                ['overdue', 'Overdue'],
                ['thisMonth', 'This Month'],
                ['upcoming', 'Upcoming'],
                ['completed', 'Completed'],
              ].map(([key, title]) => (
                <div key={key} style={{ marginBottom: 24 }}>
                  <div
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 15,
                      fontWeight: 700,
                      marginBottom: 10,
                    }}
                  >
                    {title}
                  </div>
                  <AppCycleList
                    cycles={byAppGroups[key]}
                    today={today}
                    expanded={expanded}
                    setExpanded={setExpanded}
                    onToggleTask={handleToggleTask}
                    toggling={toggling}
                  />
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
});

export default MaintenanceTab;
