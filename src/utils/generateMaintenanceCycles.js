import { collection, doc, getDocs, query, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase';

export const CYCLE_START = '2026-09-01';
const HORIZON_DAYS = 90;

function parseYmd(value) {
  const [y, m, d] = String(value).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date, days) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

function todayLocal() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function generationWindow() {
  const today = todayLocal();
  const floor = parseYmd(CYCLE_START);
  const start = today > floor ? today : floor;
  const end = addDays(today, HORIZON_DAYS);
  return { start, end };
}

function inWindow(date, start, end) {
  return date >= start && date <= end && formatYmd(date) >= CYCLE_START;
}

function monthlyDates(start, end, anchorDay) {
  const day = anchorDay || 1;
  const dates = [];
  let cursor = new Date(start.getFullYear(), start.getMonth(), day);
  if (cursor < start) cursor = new Date(start.getFullYear(), start.getMonth() + 1, day);
  while (cursor <= end) {
    if (inWindow(cursor, start, end)) dates.push(formatYmd(cursor));
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, day);
  }
  return dates;
}

function quarterlyDates(start, end, anchorMonths, anchorDay) {
  const months = (anchorMonths && anchorMonths.length ? anchorMonths : [1, 4, 7, 10]).slice().sort((a, b) => a - b);
  const day = anchorDay || 1;
  const dates = [];
  for (let year = start.getFullYear(); year <= end.getFullYear(); year += 1) {
    months.forEach((month) => {
      const cursor = new Date(year, month - 1, day);
      if (inWindow(cursor, start, end)) dates.push(formatYmd(cursor));
    });
  }
  return dates;
}

function fixedDates(start, end, mmdd) {
  if (!mmdd || !/^\d{2}-\d{2}$/.test(mmdd)) return [];
  const [mm, dd] = mmdd.split('-').map(Number);
  const dates = [];
  for (let year = start.getFullYear(); year <= end.getFullYear(); year += 1) {
    const cursor = new Date(year, mm - 1, dd);
    if (inWindow(cursor, start, end)) dates.push(formatYmd(cursor));
  }
  return dates;
}

function weeklyDates(start, end) {
  const dates = [];
  let cursor = parseYmd(CYCLE_START);
  while (cursor < start) cursor = addDays(cursor, 7);
  while (cursor <= end) {
    if (inWindow(cursor, start, end)) dates.push(formatYmd(cursor));
    cursor = addDays(cursor, 7);
  }
  return dates;
}

function dueDatesForTask(task, start, end) {
  switch (task.frequency) {
    case 'weekly':
      return weeklyDates(start, end);
    case 'monthly':
      return monthlyDates(start, end, task.anchorDay);
    case 'quarterly':
      return quarterlyDates(start, end, task.anchorMonths, task.anchorDay);
    case 'annual':
    case 'fixed':
      return fixedDates(start, end, task.fixedDate);
    default:
      return [];
  }
}

function frequencyLabel(frequency) {
  if (!frequency) return '';
  return frequency.charAt(0).toUpperCase() + frequency.slice(1);
}

export function cycleLabel(dueDate, frequency) {
  const d = parseYmd(dueDate);
  const freq = frequencyLabel(frequency);
  if (frequency === 'weekly' || frequency === 'fixed') {
    const pretty = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    return `${pretty} — ${freq}`;
  }
  const pretty = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return `${pretty} — ${freq}`;
}

export function cycleDocId(appId, frequency, dueDate) {
  return `${appId}_${frequency}_${dueDate}`;
}

export async function generateCyclesForApp(appId, schedule) {
  if (!appId || !schedule) return 0;
  const { start, end } = generationWindow();
  const enabledTasks = (schedule.tasks || []).filter((t) => t.enabled !== false);
  const groups = new Map();

  enabledTasks.forEach((task) => {
    dueDatesForTask(task, start, end).forEach((dueDate) => {
      if (dueDate < CYCLE_START) return;
      const key = `${dueDate}__${task.frequency}`;
      if (!groups.has(key)) groups.set(key, { dueDate, frequency: task.frequency, tasks: [] });
      groups.get(key).tasks.push({
        taskId: task.taskId,
        label: task.label,
        description: task.description,
        done: false,
        doneAt: null,
      });
    });
  });

  const existingSnap = await getDocs(
    query(collection(db, 'maintenanceCycles'), where('appId', '==', appId))
  );
  const existing = new Set(
    existingSnap.docs.map((d) => {
      const data = d.data();
      return `${data.dueDate}__${data.frequency}`;
    })
  );

  let created = 0;
  const createdAt = Timestamp.now();
  const appName = schedule.appName || appId;

  await Promise.all(
    [...groups.values()].map(async (group) => {
      const key = `${group.dueDate}__${group.frequency}`;
      if (existing.has(key)) return;
      const matchingDue = existingSnap.docs.filter((d) => d.data().dueDate === group.dueDate);
      if (matchingDue.some((d) => d.data().frequency === group.frequency)) return;

      const cycleId = cycleDocId(appId, group.frequency, group.dueDate);
      const label = cycleLabel(group.dueDate, group.frequency);
      await setDoc(doc(db, 'maintenanceCycles', cycleId), {
        cycleId,
        appId,
        appName,
        label,
        frequency: group.frequency,
        dueDate: group.dueDate,
        tasks: group.tasks,
        completedAt: null,
        calendarEventId: null,
        createdAt,
      });
      created += 1;

      try {
        const res = await fetch('/api/calendar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create',
            cycleId,
            appName,
            label,
            dueDate: group.dueDate,
            tasks: group.tasks.map((t) => t.label),
          }),
        });
        const data = await res.json().catch(() => ({}));
        const calendarEventId = data.calendarEventId;
        if (res.ok && calendarEventId) {
          await updateDoc(doc(db, 'maintenanceCycles', cycleId), { calendarEventId });
        } else {
          console.error('Calendar create failed:', data.error || res.status);
        }
      } catch (err) {
        console.error('Calendar create failed:', err);
      }
    })
  );

  return created;
}
