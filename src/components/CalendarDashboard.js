import React, { useState, useEffect, useCallback } from 'react';
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
  subDays,
  addHours,
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
import {
  EVENT_COLORS,
  getAccountColorStyle,
  colorNameToGoogleColorId,
  googleColorIdToName,
} from '../data/calendarColors';

const WEEKDAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const DAL_CALENDAR = 'dal';
const GOOGLE_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

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

function parseEventDate(value) {
  return parseISO(value.length === 10 ? `${value}T00:00:00` : value);
}

function emptyForm() {
  return {
    title: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    endDate: '',
    time: '',
    description: '',
    calendar: DAL_CALENDAR,
    color: 'coral',
  };
}

function eventToForm(event) {
  const start = parseEventDate(event.start);
  const end = parseEventDate(event.end);
  let endDate = format(end, 'yyyy-MM-dd');
  if (event.source === 'google' && event.allDay) {
    const exclusiveEnd = parseISO(event.end.length === 10 ? `${event.end}T00:00:00` : event.end);
    endDate = format(subDays(exclusiveEnd, 1), 'yyyy-MM-dd');
    if (endDate < format(start, 'yyyy-MM-dd')) {
      endDate = format(start, 'yyyy-MM-dd');
    }
  }
  const startDate = format(start, 'yyyy-MM-dd');
  return {
    title: event.title === '(No title)' ? '' : (event.title || ''),
    date: startDate,
    endDate: endDate !== startDate ? endDate : '',
    time: event.allDay ? '' : format(start, 'HH:mm'),
    description: event.description || '',
    calendar: event.source === 'dal' ? DAL_CALENDAR : event.accountEmail,
    color: event.color
      || (event.colorId ? googleColorIdToName(event.colorId, event.accountColor || 'coral') : null)
      || event.accountColor
      || 'coral',
  };
}

function datesFromForm(form) {
  const date = form.date;
  const endDate = form.endDate || form.date;
  const allDay = !form.time;
  if (allDay) {
    return {
      allDay: true,
      start: `${date}T00:00:00`,
      end: `${endDate}T23:59:59`,
    };
  }
  const startLocal = new Date(`${date}T${form.time}`);
  const endLocal = form.endDate && form.endDate !== form.date
    ? new Date(`${endDate}T${form.time}`)
    : addHours(startLocal, 1);
  return {
    allDay: false,
    start: startLocal.toISOString(),
    end: endLocal.toISOString(),
  };
}

function buildGoogleEventBody(form) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date = form.date;
  const endDate = form.endDate || form.date;
  const description = form.description || '';
  const colorId = colorNameToGoogleColorId(form.color);
  if (!form.time) {
    return {
      summary: form.title.trim(),
      description,
      colorId,
      start: { date },
      end: { date: format(addDays(parseISO(`${endDate}T00:00:00`), 1), 'yyyy-MM-dd') },
    };
  }
  const startLocal = new Date(`${date}T${form.time}`);
  const endLocal = form.endDate && form.endDate !== form.date
    ? new Date(`${endDate}T${form.time}`)
    : addHours(startLocal, 1);
  return {
    summary: form.title.trim(),
    description,
    colorId,
    start: { dateTime: format(startLocal, "yyyy-MM-dd'T'HH:mm:ss"), timeZone },
    end: { dateTime: format(endLocal, "yyyy-MM-dd'T'HH:mm:ss"), timeZone },
  };
}

function googleEventApiId(event) {
  if (event.googleEventId) return event.googleEventId;
  if (event.accountEmail && event.id?.startsWith(`${event.accountEmail}-`)) {
    return event.id.slice(event.accountEmail.length + 1);
  }
  return event.id;
}

async function parseGoogleError(res) {
  const body = await res.json().catch(() => ({}));
  return body?.error?.message || `Calendar API error (${res.status})`;
}

function EventForm({
  form,
  setForm,
  connectedAccounts,
  onSave,
  onCancel,
  onDelete,
  saving,
  error,
  isEdit,
}) {
  return (
    <form onSubmit={onSave} className="calendar-event-form">
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
          <label className="form-label">Date</label>
          <input
            className="form-input"
            type="date"
            value={form.date}
            onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
            required
          />
        </div>
        <div className="form-group">
          <label className="form-label">End date</label>
          <input
            className="form-input"
            type="date"
            value={form.endDate}
            min={form.date}
            onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
          />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Time</label>
        <input
          className="form-input"
          type="time"
          value={form.time}
          onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
        />
        <div className="form-hint">Leave blank for an all-day event</div>
      </div>
      <div className="form-group">
        <label className="form-label">Description</label>
        <textarea
          className="form-textarea"
          value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          rows={3}
        />
      </div>
      <div className="form-group">
        <label className="form-label">Calendar</label>
        <select
          className="form-select"
          value={form.calendar}
          onChange={e => {
            const calendar = e.target.value;
            setForm(f => {
              const account = connectedAccounts.find(a => a.email === calendar);
              return {
                ...f,
                calendar,
                color: calendar === DAL_CALENDAR ? 'coral' : (account?.color || f.color),
              };
            });
          }}
        >
          <option value={DAL_CALENDAR}>DAL Events</option>
          {connectedAccounts.map(account => (
            <option key={account.email} value={account.email}>{account.email}</option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">Color</label>
        <div className="event-color-picker" role="listbox" aria-label="Event color">
          {EVENT_COLORS.map(color => (
            <button
              key={color.name}
              type="button"
              className={`event-color-swatch${form.color === color.name ? ' selected' : ''}`}
              style={{ background: color.value }}
              title={color.name}
              aria-label={color.name}
              onClick={() => setForm(f => ({ ...f, color: color.name }))}
            />
          ))}
        </div>
      </div>
      {error && <div className="calendar-error-banner">{error}</div>}
      <div className="event-form-actions">
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
          {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Save Event'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
      {isEdit && (
        <button type="button" className="btn btn-danger event-delete-btn" onClick={onDelete} disabled={saving}>
          Delete
        </button>
      )}
    </form>
  );
}

function DeleteConfirmModal({ onCancel, onConfirm, deleting }) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal event-confirm-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Delete this event?</div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onCancel} disabled={deleting}>Cancel</button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

async function fetchGoogleEvents(accessToken, timeMin, timeMax, authorizedFetch) {
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  });
  const url = `${GOOGLE_EVENTS_URL}?${params}`;
  const res = authorizedFetch
    ? await authorizedFetch(url)
    : await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error(await parseGoogleError(res));
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
    googleEventId: ev.id,
    colorId: ev.colorId || '',
  }));
}

function EventPill({ event, onSelect }) {
  const handleClick = (e) => {
    e.stopPropagation();
    onSelect(event);
  };

  if (event.source === 'dal' && !event.color) {
    return (
      <div className="calendar-event-pill dal" title={event.title} onClick={handleClick}>
        {event.title}
      </div>
    );
  }
  const style = getAccountColorStyle(event.color || event.accountColor);
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
    connectTimedOut,
    error: googleError,
    setError: setGoogleError,
    connectAccount,
    disconnectAccount,
    authorizedCalendarFetch,
  } = useGoogleCalendar();

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [dalEvents, setDalEvents] = useState([]);
  const [googleEvents, setGoogleEvents] = useState([]);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [googleReloadKey, setGoogleReloadKey] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [form, setForm] = useState(() => emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const refreshGoogleEvents = useCallback(() => {
    setGoogleReloadKey(k => k + 1);
  }, []);

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
            const events = await fetchGoogleEvents(
              account.accessToken,
              monthStart,
              monthEnd,
              (url) => authorizedCalendarFetch(account, url)
            );
            return events.map(ev => ({
              ...ev,
              id: `${account.email}-${ev.id}`,
              accountEmail: account.email,
              accountColor: account.color,
              color: googleColorIdToName(ev.colorId, account.color),
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
  }, [connectedAccounts, currentMonth, setGoogleError, authorizedCalendarFetch, googleReloadKey]);

  const closeModal = () => {
    setModalOpen(false);
    setEditingEvent(null);
    setFormError(null);
    setConfirmDelete(false);
    setSaving(false);
    setDeleting(false);
  };

  const openAddModal = () => {
    setEditingEvent(null);
    setForm(emptyForm());
    setFormError(null);
    setConfirmDelete(false);
    setModalOpen(true);
  };

  const openEditModal = (event) => {
    setEditingEvent(event);
    setForm(eventToForm(event));
    setFormError(null);
    setConfirmDelete(false);
    setModalOpen(true);
  };

  const writeDalEvent = async (id, payload, isCreate) => {
    await setDoc(doc(db, 'calendarEvents', id), {
      ...payload,
      source: 'dal',
      ...(isCreate ? { createdAt: new Date().toISOString() } : {}),
    });
  };

  const googleWrite = async (account, method, eventId, body) => {
    const url = eventId
      ? `${GOOGLE_EVENTS_URL}/${encodeURIComponent(eventId)}`
      : GOOGLE_EVENTS_URL;
    const res = await authorizedCalendarFetch(account, url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const message = await parseGoogleError(res);
      if (res.status === 403) {
        throw new Error(`${message} Reconnect ${account.email} to grant calendar write access.`);
      }
      throw new Error(message);
    }
    if (res.status === 204) return null;
    return res.json().catch(() => null);
  };

  const deleteFromSource = async (event) => {
    if (event.source === 'dal') {
      await deleteDoc(doc(db, 'calendarEvents', event.id));
      return;
    }
    const account = connectedAccounts.find(a => a.email === event.accountEmail);
    if (!account) throw new Error('Connected Google account not found.');
    await googleWrite(account, 'DELETE', googleEventApiId(event));
  };

  const createOnTarget = async (formData) => {
    const dates = datesFromForm(formData);
    const payload = {
      title: formData.title.trim(),
      start: dates.start,
      end: dates.end,
      allDay: dates.allDay,
      description: formData.description || '',
      color: formData.color,
    };
    if (formData.calendar === DAL_CALENDAR) {
      await writeDalEvent(`evt${Date.now()}`, payload, true);
      return;
    }
    const account = connectedAccounts.find(a => a.email === formData.calendar);
    if (!account) throw new Error('Select a connected Google calendar.');
    await googleWrite(account, 'POST', null, buildGoogleEventBody(formData));
  };

  const updateInPlace = async (event, formData) => {
    const dates = datesFromForm(formData);
    if (formData.calendar === DAL_CALENDAR) {
      await writeDalEvent(event.id, {
        title: formData.title.trim(),
        start: dates.start,
        end: dates.end,
        allDay: dates.allDay,
        description: formData.description || '',
        color: formData.color,
      }, false);
      return;
    }
    const account = connectedAccounts.find(a => a.email === formData.calendar);
    if (!account) throw new Error('Connected Google account not found.');
    await googleWrite(account, 'PATCH', googleEventApiId(event), buildGoogleEventBody(formData));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.date) return;
    setSaving(true);
    setFormError(null);
    try {
      if (!editingEvent) {
        await createOnTarget(form);
      } else {
        const prevCalendar = editingEvent.source === 'dal' ? DAL_CALENDAR : editingEvent.accountEmail;
        if (prevCalendar === form.calendar) {
          await updateInPlace(editingEvent, form);
        } else {
          await createOnTarget(form);
          await deleteFromSource(editingEvent);
        }
      }
      closeModal();
      refreshGoogleEvents();
    } catch (err) {
      setFormError(err.message || 'Failed to save event');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!editingEvent) return;
    setDeleting(true);
    setFormError(null);
    try {
      await deleteFromSource(editingEvent);
      closeModal();
      refreshGoogleEvents();
    } catch (err) {
      setDeleting(false);
      setConfirmDelete(false);
      setFormError(err.message || 'Failed to delete event');
    }
  };

  const days = getWorkdaysForMonth(currentMonth);
  const allEvents = [...dalEvents, ...googleEvents];

  const getEventsForDay = (day) =>
    allEvents.filter(ev => {
      const start = parseEventDate(ev.start);
      const end = parseEventDate(ev.end);
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
          <button className="btn btn-secondary" onClick={openAddModal}>
            + Add DAL Event
          </button>
        </div>
      </div>

      <div className="connected-accounts-section">
        <div className="connected-accounts-header">
          <h3 className="connected-accounts-title">Connected Accounts</h3>
          <button className="btn btn-primary btn-sm" onClick={connectAccount} disabled={connecting}>
            {connecting ? 'Connecting...' : connectTimedOut ? 'Try again' : '+ Connect Account'}
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
                  <EventPill key={ev.id} event={ev} onSelect={openEditModal} />
                ))}
                {dayEvents.length > 3 && (
                  <div
                    className="calendar-event-more"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (dayEvents[3]) openEditModal(dayEvents[3]);
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

      {modalOpen && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">{editingEvent ? 'Edit Event' : 'Add DAL Event'}</div>
              <button className="btn btn-ghost btn-sm" onClick={closeModal}>✕</button>
            </div>
            <div className="modal-body">
              <EventForm
                form={form}
                setForm={setForm}
                connectedAccounts={connectedAccounts}
                onSave={handleSave}
                onCancel={closeModal}
                onDelete={() => setConfirmDelete(true)}
                saving={saving}
                error={formError}
                isEdit={!!editingEvent}
              />
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <DeleteConfirmModal
          onCancel={() => setConfirmDelete(false)}
          onConfirm={handleConfirmDelete}
          deleting={deleting}
        />
      )}
    </div>
  );
}
