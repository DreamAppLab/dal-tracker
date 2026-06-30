import React, { useState, useEffect } from 'react';
import {
  format,
  startOfMonth,
  endOfMonth,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
  startOfWeek,
  parseISO,
  isWithinInterval,
  addDays,
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
import { getAccountColorStyle } from '../data/calendarColors';

const WEEKDAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function getWorkdaysForMonth(month) {
  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const lastWeekStart = startOfWeek(monthEnd, { weekStartsOn: 1 });
  const gridEnd = addDays(lastWeekStart, 4);

  const days = [];
  let weekStart = gridStart;
  while (weekStart <= gridEnd) {
    for (let i = 0; i < 5; i++) {
      days.push(addDays(weekStart, i));
    }
    weekStart = addDays(weekStart, 7);
  }
  return days;
}

function dalEventToForm(event) {
  const start = parseISO(event.start.length === 10 ? `${event.start}T00:00:00` : event.start);
  const end = parseISO(event.end.length === 10 ? `${event.end}T23:59:59` : event.end);
  return {
    title: event.title,
    start: event.allDay ? format(start, 'yyyy-MM-dd') : format(start, "yyyy-MM-dd'T'HH:mm"),
    end: event.allDay ? format(end, 'yyyy-MM-dd') : format(end, "yyyy-MM-dd'T'HH:mm"),
    allDay: event.allDay,
    description: event.description || '',
  };
}

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
        <button type="submit" className="btn btn-primary btn-sm">{initial ? 'Save Changes' : 'Save Event'}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function prepareDescriptionHtml(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('a').forEach((anchor) => {
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noopener noreferrer');
  });
  return doc.body.innerHTML;
}

function EventDetailsModal({ event, editing, onClose, onEdit, onDelete, onSaveEdit }) {
  if (!event) return null;

  if (editing && event.source === 'dal') {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <div className="modal-title">Edit DAL Event</div>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
          </div>
          <div className="modal-body">
            <EventForm
              initial={dalEventToForm(event)}
              onSave={onSaveEdit}
              onCancel={onClose}
            />
          </div>
        </div>
      </div>
    );
  }

  const start = parseISO(event.start.length === 10 ? `${event.start}T00:00:00` : event.start);
  const end = parseISO(event.end.length === 10 ? `${event.end}T23:59:59` : event.end);
  const dateStr = format(start, 'EEEE, MMMM d, yyyy');
  const timeStr = event.allDay
    ? 'All day'
    : `${format(start, 'h:mm a')} – ${format(end, 'h:mm a')}`;

  const isDal = event.source === 'dal';
  const sourceStyle = isDal
    ? { color: 'var(--coral)', background: 'var(--coral-dim)' }
    : getAccountColorStyle(event.accountColor);
  const sourceLabel = isDal ? 'DAL Event' : event.accountEmail;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal event-details-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{event.title}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="event-detail-row">
            <span className="event-detail-label">Date</span>
            <span className="event-detail-value">{dateStr}</span>
          </div>
          <div className="event-detail-row">
            <span className="event-detail-label">Time</span>
            <span className="event-detail-value">{timeStr}</span>
          </div>
          <div className="event-detail-row">
            <span className="event-detail-label">Source</span>
            <span className="event-detail-source" style={{ color: sourceStyle.color, background: sourceStyle.background }}>
              <span className="event-detail-source-dot" style={{ background: sourceStyle.color }} />
              {sourceLabel}
            </span>
          </div>
          {event.location && (
            <div className="event-detail-row">
              <span className="event-detail-label">Location</span>
              <span className="event-detail-value">{event.location}</span>
            </div>
          )}
          {event.description && (
            <div className="event-detail-row event-detail-row-block">
              <span className="event-detail-label">Description</span>
              <div
                className="event-detail-value event-detail-description"
                dangerouslySetInnerHTML={{ __html: prepareDescriptionHtml(event.description) }}
              />
            </div>
          )}
        </div>
        <div className="modal-footer">
          {isDal && (
            <>
              <button className="btn btn-secondary" onClick={onEdit}>Edit</button>
              <button className="btn btn-danger" onClick={onDelete}>Delete</button>
            </>
          )}
          <button className="btn btn-primary" onClick={onClose} style={{ marginLeft: 'auto' }}>Close</button>
        </div>
      </div>
    </div>
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
    location: ev.location || '',
    source: 'google',
  }));
}

function EventPill({ event, onSelect }) {
  const handleClick = (e) => {
    e.stopPropagation();
    onSelect(event);
  };

  if (event.source === 'dal') {
    return (
      <div className="calendar-event-pill dal" title={event.title} onClick={handleClick}>
        {event.title}
      </div>
    );
  }
  const style = getAccountColorStyle(event.accountColor);
  return (
    <div
      className="calendar-event-pill"
      style={{ color: style.color, background: style.background }}
      title={event.title}
      onClick={handleClick}
    >
      {event.title}
    </div>
  );
}

export default function CalendarDashboard() {
  const {
    connectedAccounts,
    connecting,
    error: googleError,
    setError: setGoogleError,
    connectAccount,
    disconnectAccount,
  } = useGoogleCalendar();

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [dalEvents, setDalEvents] = useState([]);
  const [googleEvents, setGoogleEvents] = useState([]);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [editingEvent, setEditingEvent] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'calendarEvents'), (snapshot) => {
      setDalEvents(snapshot.docs.map(d => ({ id: d.id, ...d.data(), source: 'dal' })));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!connectedAccounts.length) {
      setGoogleEvents([]);
      return;
    }

    const load = async () => {
      setLoadingGoogle(true);
      setGoogleError(null);
      try {
        const monthStart = startOfMonth(currentMonth);
        const monthEnd = endOfMonth(currentMonth);
        const results = await Promise.allSettled(
          connectedAccounts.map(async (account) => {
            const events = await fetchGoogleEvents(account.accessToken, monthStart, monthEnd);
            return events.map(ev => ({
              ...ev,
              id: `${account.email}-${ev.id}`,
              accountEmail: account.email,
              accountColor: account.color,
            }));
          })
        );

        const merged = [];
        const errors = [];
        results.forEach((result, i) => {
          if (result.status === 'fulfilled') {
            merged.push(...result.value);
          } else {
            errors.push(`${connectedAccounts[i].email}: ${result.reason?.message || 'Failed to fetch'}`);
          }
        });

        setGoogleEvents(merged);
        if (errors.length) {
          setGoogleError(errors.join('; '));
        }
      } catch (err) {
        setGoogleError(err.message);
        setGoogleEvents([]);
      } finally {
        setLoadingGoogle(false);
      }
    };
    load();
  }, [connectedAccounts, currentMonth, setGoogleError]);

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

  const updateDalEvent = async (id, form) => {
    const start = form.allDay ? `${form.start.slice(0, 10)}T00:00:00` : new Date(form.start).toISOString();
    const end = form.allDay ? `${form.end.slice(0, 10)}T23:59:59` : new Date(form.end).toISOString();
    await setDoc(doc(db, 'calendarEvents', id), {
      title: form.title.trim(),
      start,
      end,
      allDay: form.allDay,
      description: form.description || '',
      source: 'dal',
    });
    closeEventModal();
  };

  const deleteDalEvent = async (id) => {
    if (!window.confirm('Delete this event?')) return;
    await deleteDoc(doc(db, 'calendarEvents', id));
    closeEventModal();
  };

  const closeEventModal = () => {
    setSelectedEvent(null);
    setEditingEvent(false);
  };

  const days = getWorkdaysForMonth(currentMonth);
  const allEvents = [...dalEvents, ...googleEvents];

  const getEventsForDay = (day) =>
    allEvents.filter(ev => {
      const start = parseISO(ev.start.length === 10 ? `${ev.start}T00:00:00` : ev.start);
      const end = parseISO(ev.end.length === 10 ? `${ev.end}T23:59:59` : ev.end);
      return isWithinInterval(day, { start, end }) || isSameDay(day, start);
    });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Calendar</h1>
          <p className="page-subtitle">Gmail calendar sync + DAL reminders and deadlines</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={() => setShowAddForm(true)}>
            + Add DAL Event
          </button>
        </div>
      </div>

      <div className="connected-accounts-section">
        <div className="connected-accounts-header">
          <h3 className="connected-accounts-title">Connected Accounts</h3>
          <button className="btn btn-primary btn-sm" onClick={connectAccount} disabled={connecting}>
            {connecting ? 'Connecting...' : '+ Connect Account'}
          </button>
        </div>
        {connectedAccounts.length === 0 ? (
          <p className="connected-accounts-empty">No Google accounts connected yet.</p>
        ) : (
          <ul className="connected-accounts-list">
            {connectedAccounts.map(account => {
              const colorStyle = getAccountColorStyle(account.color);
              return (
                <li key={account.email} className="connected-account-row">
                  <span className="connected-account-dot" style={{ background: colorStyle.color }} />
                  <span className="connected-account-email">{account.email}</span>
                  <span className="connected-account-color-label">{account.color}</span>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--coral)', marginLeft: 'auto' }}
                    onClick={() => disconnectAccount(account.email)}
                  >
                    Disconnect
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {googleError && (
        <div className="calendar-error-banner">{googleError}</div>
      )}

      <div className="calendar-legend">
        <span className="calendar-legend-item">
          <span className="calendar-legend-dot dal" /> DAL Events
        </span>
        {connectedAccounts.map(account => {
          const colorStyle = getAccountColorStyle(account.color);
          return (
            <span key={account.email} className="calendar-legend-item">
              <span className="calendar-legend-dot" style={{ background: colorStyle.color }} />
              {account.email}
            </span>
          );
        })}
        {loadingGoogle && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Syncing Google events...</span>}
      </div>

      <div className="calendar-nav">
        <button className="btn btn-ghost btn-sm" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>←</button>
        <h2 className="calendar-month-title">{format(currentMonth, 'MMMM yyyy')}</h2>
        <button className="btn btn-ghost btn-sm" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>→</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setCurrentMonth(new Date())}>Today</button>
      </div>

      <div className="calendar-grid calendar-grid-workweek">
        {WEEKDAY_HEADERS.map(d => (
          <div key={d} className="calendar-day-header">{d}</div>
        ))}
        {days.map(day => {
          const dayEvents = getEventsForDay(day);
          const inMonth = isSameMonth(day, currentMonth);
          const isToday = isSameDay(day, new Date());
          return (
            <div
              key={day.toISOString()}
              className={`calendar-day ${!inMonth ? 'other-month' : ''} ${isToday ? 'today' : ''}`}
            >
              <div className="calendar-day-num">{format(day, 'd')}</div>
              <div className="calendar-day-events">
                {dayEvents.slice(0, 3).map(ev => (
                  <EventPill key={ev.id} event={ev} onSelect={setSelectedEvent} />
                ))}
                {dayEvents.length > 3 && (
                  <div
                    className="calendar-event-more"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (dayEvents[3]) setSelectedEvent(dayEvents[3]);
                    }}
                  >
                    +{dayEvents.length - 3} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selectedEvent && (
        <EventDetailsModal
          event={selectedEvent}
          editing={editingEvent}
          onClose={closeEventModal}
          onEdit={() => setEditingEvent(true)}
          onDelete={() => deleteDalEvent(selectedEvent.id)}
          onSaveEdit={(form) => updateDalEvent(selectedEvent.id, form)}
        />
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
