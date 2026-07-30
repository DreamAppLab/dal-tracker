// src/components/TodoDashboard.js
import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase';
import { collection, doc, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';

function formatAddedDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDueBadge(value) {
  if (!value) return '';
  const d = parseDueDate(value);
  if (!d) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function parseDueDate(value) {
  if (!value) return null;
  // Date-only strings (YYYY-MM-DD) parse as UTC midnight; use local noon for day checks
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, day] = value.split('-').map(Number);
    return new Date(y, m - 1, day, 12, 0, 0);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dueDateKey(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = parseDueDate(value);
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isOverdue(dueDate, completed) {
  if (completed || !dueDate) return false;
  const due = parseDueDate(dueDate);
  if (!due) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDay = new Date(due);
  dueDay.setHours(0, 0, 0, 0);
  return dueDay < today;
}

async function upsertTodoCalendarEvent(todoId, description, dueDate, existingEventId) {
  const dateKey = dueDateKey(dueDate);
  if (!dateKey) return null;

  const eventId = existingEventId || `todo-cal-${todoId}`;
  await setDoc(
    doc(db, 'calendarEvents', eventId),
    {
      title: `📋 ${description.trim()}`,
      start: `${dateKey}T00:00:00`,
      end: `${dateKey}T23:59:59`,
      allDay: true,
      description: 'To Do item',
      source: 'dal',
      todoId,
      createdAt: new Date().toISOString(),
    },
    { merge: true }
  );
  return eventId;
}

async function removeTodoCalendarEvent(eventId) {
  if (!eventId) return;
  try {
    await deleteDoc(doc(db, 'calendarEvents', eventId));
  } catch (err) {
    console.error('Failed to remove todo calendar event:', err);
  }
}

export default function TodoDashboard() {
  const [todos, setTodos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [filter, setFilter] = useState('all');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'todos'), (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setTodos(data);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const filteredTodos = useMemo(() => {
    let list = [...todos];
    if (filter === 'open') list = list.filter(t => !t.completed);
    if (filter === 'completed') list = list.filter(t => t.completed);

    list.sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      const aOver = isOverdue(a.due_date, a.completed);
      const bOver = isOverdue(b.due_date, b.completed);
      if (aOver !== bOver) return aOver ? -1 : 1;
      const aCreated = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bCreated = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bCreated - aCreated;
    });
    return list;
  }, [todos, filter]);

  const handleAdd = async (e) => {
    e.preventDefault();
    const text = description.trim();
    if (!text || saving) return;

    setSaving(true);
    try {
      const todoRef = doc(collection(db, 'todos'));
      const now = new Date().toISOString();
      const due = dueDate || null;

      let calendarEventId = null;
      if (due) {
        calendarEventId = await upsertTodoCalendarEvent(todoRef.id, text, due, null);
      }

      await setDoc(
        todoRef,
        {
          description: text,
          created_at: now,
          due_date: due,
          completed: false,
          completed_at: null,
          calendarEventId,
        },
        { merge: true }
      );

      setDescription('');
      setDueDate('');
    } catch (err) {
      console.error('Failed to add todo:', err);
      alert('Failed to add task. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (todo) => {
    const nextCompleted = !todo.completed;
    try {
      if (nextCompleted) {
        await removeTodoCalendarEvent(todo.calendarEventId);
        await setDoc(
          doc(db, 'todos', todo.id),
          {
            completed: true,
            completed_at: new Date().toISOString(),
            calendarEventId: null,
          },
          { merge: true }
        );
      } else {
        let calendarEventId = null;
        if (todo.due_date) {
          calendarEventId = await upsertTodoCalendarEvent(
            todo.id,
            todo.description,
            todo.due_date,
            todo.calendarEventId
          );
        }
        await setDoc(
          doc(db, 'todos', todo.id),
          {
            completed: false,
            completed_at: null,
            calendarEventId,
          },
          { merge: true }
        );
      }
    } catch (err) {
      console.error('Failed to update todo:', err);
      alert('Failed to update task. Please try again.');
    }
  };

  const handleDelete = async (todo) => {
    if (!window.confirm('Delete this task?')) return;
    try {
      await removeTodoCalendarEvent(todo.calendarEventId);
      await deleteDoc(doc(db, 'todos', todo.id));
    } catch (err) {
      console.error('Failed to delete todo:', err);
      alert('Failed to delete task. Please try again.');
    }
  };

  if (loading) {
    return (
      <div className="page">
        <div className="empty-state">
          <div className="empty-state-text">Loading tasks...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">To Do</h1>
          <p className="page-subtitle">Track tasks and sync due dates to the Calendar</p>
        </div>
      </div>

      <form className="todo-add-bar" onSubmit={handleAdd}>
        <input
          className="form-input todo-add-input"
          type="text"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Add a new task..."
          maxLength={500}
        />
        <input
          className="form-input todo-due-input"
          type="date"
          value={dueDate}
          onChange={e => setDueDate(e.target.value)}
          title="Optional due date"
        />
        <button className="btn btn-primary" type="submit" disabled={!description.trim() || saving}>
          {saving ? 'Adding...' : 'Add Task'}
        </button>
      </form>

      <div className="todo-filters">
        {[
          { key: 'all', label: 'All' },
          { key: 'open', label: 'Open' },
          { key: 'completed', label: 'Completed' },
        ].map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`todo-filter-btn ${filter === key ? 'active' : ''}`}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {filteredTodos.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">✅</div>
          <div className="empty-state-text">
            {filter === 'completed'
              ? 'No completed tasks yet'
              : filter === 'open'
                ? 'No open tasks — you\'re clear'
                : 'No tasks yet. Add one above.'}
          </div>
        </div>
      ) : (
        <div className="todo-list">
          {filteredTodos.map(todo => {
            const overdue = isOverdue(todo.due_date, todo.completed);
            return (
              <div
                key={todo.id}
                className={`todo-item ${todo.completed ? 'todo-item--completed' : ''}`}
              >
                <label className="todo-checkbox-wrap">
                  <input
                    type="checkbox"
                    checked={!!todo.completed}
                    onChange={() => handleToggle(todo)}
                  />
                  <span className="todo-checkbox-custom" />
                </label>

                <div className="todo-item-body">
                  <div className={`todo-item-text ${todo.completed ? 'todo-item-text--done' : ''}`}>
                    {todo.description}
                  </div>
                  <div className="todo-item-meta">
                    <span className="todo-created">
                      Added {formatAddedDate(todo.created_at)}
                    </span>
                    {todo.due_date && (
                      <span className={`todo-due-badge ${overdue ? 'todo-due-badge--overdue' : ''}`}>
                        Due {formatDueBadge(todo.due_date)}
                      </span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  className="todo-delete-btn"
                  onClick={() => handleDelete(todo)}
                  title="Delete task"
                  aria-label="Delete task"
                >
                  🗑
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
