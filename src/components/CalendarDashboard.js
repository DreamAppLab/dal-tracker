import React, { useState, useEffect } from 'react';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
  startOfWeek,
  endOfWeek,
  parseISO,
  isWithinInterval,
} from 'date-fns';
import { db } from '../firebase';
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import { useGoogleCalendar } from '../contexts/GoogleCalendarContext';

function EventForm({ onSave, onCancel, initial = null }) {
  const [form, setForm] = useState(
    initial || {
      title: '',
      start: format(new Date(), "yyyy-MM-dd'T'09:00"),
      end: format(new Date(), "yyyy-MM-dd'T'10:00"),
      allDay: false,
      description: '',
    }
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    onSave(form);
  };

  return (
    <form onSubmit={handleSubmit} className="calendar-event-form">
      <div className="form-group">
        <label className="form-label">Title</label>
        <input
          className="form-input"
          value={form.title}
          onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          placeholder="e.g. App Store review deadline"
          required
        />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Start</label>
          <input
            className="form-input"
            type={form.allDay ? 'date' : 'datetime-local'}
            value={form.allDay ? form.start.slice(0, 10) : form.start}
            onChange={e => setForm(f => ({ ...f, start: e.target.value }))}
          />
        </div>
        <div className="form-group">
          <label className="form-label">End</label>
          <input
            className="form-input"
            type={form.allDay ? 'date' : 'datetime-local'}
            value={form.allDay ? form.end.slice(0, 10) : form.end}
            onChange={e => setForm(f => ({ ...f, end: e.target.value }))}
          />
        </div>
      </div>
      <label className="subscriptions-checkbox-label" style={{ marginBottom: 12 }}>
        <input
          type="checkbox"
          checked={form.allDay}
          onChange={e => setForm(f => ({ ...f, allDay: e.target.checked }))}
        />
        All day event
      </label>
      <div className="form-group">
        <label className="form-label">Description (optional)</label>
        <textarea
          className="form-textarea"
          value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          rows={2}
        />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn btn-primary btn-sm">Save Event</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

async function fetchGoogleEvents(accessToken, timeMin, timeMax) {
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  });
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = body?.error?.message || `Calendar API error (${res.status})`;
    throw new Error(message);
  }
  const json = await res.json();
  return (json.items || []).map(ev => ({
    id: ev.id,
    title: ev.summary || '(No title)',
    start: ev.start.dateTime || ev.start.date,
    end: ev.end.dateTime || ev.end.date,
    allDay: !ev.start.dateTime,
    description: ev.description || '',
    source: 'google',
  }));
}

export default function CalendarDashboard() {
  const {
    accessToken,
    googleUser,
    connecting,
    error: googleError,
    setError: setGoogleError,
    connectGoogle,
    disconnectGoogle,
    isConnected,
  } = useGoogleCalendar();

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [dalEvents, setDalEvents] = useState([]);
  const [googleEvents, setGoogleEvents] = useState([]);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedDay, setSelectedDay] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'calendarEvents'), (snapshot) => {
      setDalEvents(snapshot.docs.map(d => ({ id: d.id, ...d.data(), source: 'dal' })));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!accessToken) {
      setGoogleEvents([]);
      return;
    }

    const load = async () => {
      setLoadingGoogle(true);
      setGoogleError(null);
      try {
        const monthStart = startOfMonth(currentMonth);
        const monthEnd = endOfMonth(currentMonth);
        const events = await fetchGoogleEvents(accessToken, monthStart, monthEnd);
        setGoogleEvents(events);
      } catch (err) {
        setGoogleError(err.message);
        setGoogleEvents([]);
      } finally {
        setLoadingGoogle(false);
      }
    };
    load();
  }, [accessToken, currentMonth, setGoogleError]);

  const saveDalEvent = async (form) => {
    const id = `evt${Date.now()}`;
    const start = form.allDay ? `${form.start.slice(0, 10)}T00:00:00` : new Date(form.start).toISOString();
    const end = form.allDay ? `${form.end.slice(0, 10)}T23:59:59` : new Date(form.end).toISOString();
    await setDoc(doc(db, 'calendarEvents', id), {
      title: form.title.trim(),
      start,
      end,
      allDay: form.allDay,
      description: form.description || '',
      source: 'dal',
      createdAt: new Date().toISOString(),
    });
    setShowAddForm(false);
  };

  const deleteDalEvent = async (id) => {
    if (!window.confirm('Delete this event?')) return;
    await deleteDoc(doc(db, 'calendarEvents', id));
  };

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const allEvents = [...dalEvents, ...googleEvents];

  const getEventsForDay = (day) =>
    allEvents.filter(ev => {
      const start = parseISO(ev.start.length === 10 ? `${ev.start}T00:00:00` : ev.start);
      const end = parseISO(ev.end.length === 10 ? `${ev.end}T23:59:59` : ev.end);
      return isWithinInterval(day, { start, end }) || isSameDay(day, start);
    });

  const selectedDayEvents = selectedDay ? getEventsForDay(selectedDay) : [];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Calendar</h1>
          <p className="page-subtitle">Gmail calendar sync + DAL reminders and deadlines</p>
        </div>
        <div className="page-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!isConnected ? (
            <button className="btn btn-primary" onClick={connectGoogle} disabled={connecting}>
              {connecting ? 'Connecting...' : '📅 Connect Google Calendar'}
            </button>
          ) : (
            <div className="live-indicator" style={{ marginRight: 8 }}>
              <span className="live-dot" />
              {googleUser?.email || 'Google Calendar connected'}
            </div>
          )}
          {isConnected && (
            <button className="btn btn-ghost btn-sm" onClick={disconnectGoogle}>Disconnect</button>
          )}
          <button className="btn btn-secondary" onClick={() => setShowAddForm(true)}>
            + Add DAL Event
          </button>
        </div>
      </div>

      {googleError && (
        <div className="calendar-error-banner">{googleError}</div>
      )}

      <div className="calendar-legend">
        <span className="calendar-legend-item">
          <span className="calendar-legend-dot dal" /> DAL Events
        </span>
        <span className="calendar-legend-item">
          <span className="calendar-legend-dot google" /> Gmail Calendar
        </span>
        {loadingGoogle && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Syncing Google events...</span>}
      </div>

      <div className="calendar-nav">
        <button className="btn btn-ghost btn-sm" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>←</button>
        <h2 className="calendar-month-title">{format(currentMonth, 'MMMM yyyy')}</h2>
        <button className="btn btn-ghost btn-sm" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>→</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setCurrentMonth(new Date())}>Today</button>
      </div>

      <div className="calendar-grid">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div key={d} className="calendar-day-header">{d}</div>
        ))}
        {days.map(day => {
          const dayEvents = getEventsForDay(day);
          const inMonth = isSameMonth(day, currentMonth);
          const isToday = isSameDay(day, new Date());
          const isSelected = selectedDay && isSameDay(day, selectedDay);
          return (
            <div
              key={day.toISOString()}
              className={`calendar-day ${!inMonth ? 'other-month' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}`}
              onClick={() => setSelectedDay(day)}
            >
              <div className="calendar-day-num">{format(day, 'd')}</div>
              <div className="calendar-day-events">
                {dayEvents.slice(0, 3).map(ev => (
                  <div key={ev.id} className={`calendar-event-pill ${ev.source}`} title={ev.title}>
                    {ev.title}
                  </div>
                ))}
                {dayEvents.length > 3 && (
                  <div className="calendar-event-more">+{dayEvents.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selectedDay && (
        <div className="data-section" style={{ marginTop: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, color: 'var(--text-primary)' }}>
            {format(selectedDay, 'EEEE, MMMM d, yyyy')}
          </div>
          {selectedDayEvents.length === 0 ? (
            <div className="empty-state-text">No events on this day</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {selectedDayEvents.map(ev => (
                <div key={ev.id} className={`calendar-event-row ${ev.source}`}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{ev.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      {ev.allDay
                        ? 'All day'
                        : `${format(parseISO(ev.start), 'h:mm a')} – ${format(parseISO(ev.end), 'h:mm a')}`}
                      {' · '}{ev.source === 'dal' ? 'DAL Event' : 'Gmail'}
                    </div>
                    {ev.description && (
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{ev.description}</div>
                    )}
                  </div>
                  {ev.source === 'dal' && (
                    <button className="btn btn-ghost btn-sm" style={{ color: 'var(--coral)' }} onClick={() => deleteDalEvent(ev.id)}>
                      Delete
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showAddForm && (
        <div className="modal-overlay" onClick={() => setShowAddForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Add DAL Event</div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAddForm(false)}>✕</button>
            </div>
            <div className="modal-body">
              <EventForm onSave={saveDalEvent} onCancel={() => setShowAddForm(false)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
