// clientEmails collection schema:
// { clientId, projectId, source, threadId, subject, body, to, sentAt, sentBy, direction, read, parentId }
import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../firebase';
import EmailBodyEditor from './EmailBodyEditor';
import { DAL_SIGNATURE } from '../utils/dalEmailSignature';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';

const EMPTY_FORM = {
  name: '',
  company: '',
  email: '',
  phone: '',
  notes: '',
};

function formatSentAt(value) {
  if (!value) return '';
  const d = value.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

function sentAtMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  const d = value.toDate ? value.toDate() : new Date(value);
  const t = d.getTime();
  return Number.isNaN(t) ? 0 : t;
}

const ThreadMessage = React.memo(function ThreadMessage({ email }) {
  const outbound = email.direction === 'outbound';
  return (
    <div
      style={{
        alignSelf: outbound ? 'flex-end' : 'flex-start',
        maxWidth: '78%',
        background: outbound ? 'var(--teal-dim)' : 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 14,
      }}
    >
      <div className="quotes-muted" style={{ marginBottom: 6 }}>
        {outbound ? 'Sent' : 'Reply'} · {formatSentAt(email.sentAt)}
      </div>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{email.subject}</div>
      <div style={{ fontSize: 13, lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: email.body }} />
    </div>
  );
}, (prev, next) => (
  prev.email.id === next.email.id
  && prev.email.body === next.email.body
  && prev.email.subject === next.email.subject
  && prev.email.direction === next.email.direction
  && sentAtMillis(prev.email.sentAt) === sentAtMillis(next.email.sentAt)
));

function ContactModal({ client, onClose, onSaved, onDelete }) {
  const isEdit = Boolean(client);
  const [form, setForm] = useState(() => {
    if (!client) return { ...EMPTY_FORM };
    return {
      name: client.name || '',
      company: client.company || '',
      email: client.email || '',
      phone: client.phone || '',
      notes: client.notes || '',
    };
  });
  const [nameError, setNameError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key === 'name') setNameError('');
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setNameError('Name is required.');
      return;
    }

    setSaving(true);
    setSaveError('');
    const payload = {
      name,
      company: form.company.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      notes: form.notes.trim(),
      updatedAt: serverTimestamp(),
    };

    try {
      if (isEdit) {
        await updateDoc(doc(db, 'clients', client.id), payload);
      } else {
        await addDoc(collection(db, 'clients'), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      onSaved();
    } catch (err) {
      setSaveError(err.message || 'Could not save contact.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{isEdit ? 'Edit Contact' : 'Add Contact'}</div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSave}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">Name *</label>
              <input
                className="form-input"
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                placeholder="Full name"
                autoFocus
              />
              {nameError ? (
                <div style={{ color: 'var(--coral)', fontSize: 12, marginTop: 4 }}>{nameError}</div>
              ) : null}
            </div>
            <div className="form-group">
              <label className="form-label">Company</label>
              <input
                className="form-input"
                value={form.company}
                onChange={(e) => setField('company', e.target.value)}
                placeholder="Company"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                className="form-input"
                type="email"
                value={form.email}
                onChange={(e) => setField('email', e.target.value)}
                placeholder="name@example.com"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Phone</label>
              <input
                className="form-input"
                type="tel"
                value={form.phone}
                onChange={(e) => setField('phone', e.target.value)}
                placeholder="Phone"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea
                className="form-textarea"
                rows={3}
                value={form.notes}
                onChange={(e) => setField('notes', e.target.value)}
                placeholder="Notes"
              />
            </div>
            {saveError ? (
              <div className="quotes-error">{saveError}</div>
            ) : null}
          </div>
          <div
            className="modal-footer"
            style={isEdit ? { justifyContent: 'space-between' } : undefined}
          >
            {isEdit ? (
              <button
                type="button"
                className="btn btn-danger"
                disabled={saving}
                onClick={() => onDelete(client)}
              >
                Delete
              </button>
            ) : null}
            <div style={{ display: 'flex', gap: 10, marginLeft: 'auto' }}>
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {isEdit ? 'Save Changes' : 'Save Contact'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Contacts({ onUnreadCount }) {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [listError, setListError] = useState('');
  const [projectMap, setProjectMap] = useState(new Map());
  const [composingFor, setComposingFor] = useState(null);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState(DAL_SIGNATURE);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [emailSuccess, setEmailSuccess] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadClientIds, setUnreadClientIds] = useState(() => new Set());
  const [selectedContact, setSelectedContact] = useState(null);
  const [contactEmails, setContactEmails] = useState([]);
  const [loadingEmails, setLoadingEmails] = useState(false);
  const [attachment, setAttachment] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'clients'),
      (snapshot) => {
        const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        data.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
        setClients(data);
        setLoading(false);
        setListError('');
      },
      (err) => {
        setListError(err.message || 'Could not load contacts.');
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'projects'), (snapshot) => {
      const map = new Map();
      snapshot.docs.forEach((d) => {
        const project = { id: d.id, ...d.data() };
        const ids = Array.isArray(project.clientIds) ? project.clientIds : [];
        if (!ids.length) return;
        const entry = { id: project.id, name: project.name, color: project.color };
        ids.forEach((clientId) => {
          if (!clientId) return;
          const list = map.get(clientId) || [];
          list.push(entry);
          map.set(clientId, list);
        });
      });
      setProjectMap(map);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(
      collection(db, 'clientEmails'),
      where('source', '==', 'contact'),
      where('direction', '==', 'inbound'),
      where('read', '==', false)
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const ids = new Set();
      snapshot.docs.forEach((d) => {
        const clientId = d.data().clientId;
        if (clientId) ids.add(clientId);
      });
      setUnreadClientIds(ids);
      setUnreadCount(snapshot.size);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (onUnreadCount) onUnreadCount(unreadCount);
  }, [unreadCount, onUnreadCount]);

  useEffect(() => {
    if (!selectedContact) {
      setContactEmails([]);
      setLoadingEmails(false);
      return;
    }
    const contactId = selectedContact.id;
    setLoadingEmails(true);
    const q = query(
      collection(db, 'clientEmails'),
      where('clientId', '==', contactId),
      where('source', '==', 'contact')
    );
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => sentAtMillis(b.sentAt) - sentAtMillis(a.sentAt))
          .slice(0, 50);
        setContactEmails(data);
        setLoadingEmails(false);
        snapshot.docs.forEach((emailDoc) => {
          const row = emailDoc.data();
          if (row.direction === 'inbound' && row.read === false) {
            updateDoc(doc(db, 'clientEmails', emailDoc.id), { read: true }).catch(() => {});
          }
        });
      },
      (err) => {
        setLoadingEmails(false);
        console.error(err);
      }
    );
    return () => unsub();
  }, [selectedContact?.id]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => {
      const name = String(c.name || '').toLowerCase();
      const company = String(c.company || '').toLowerCase();
      const email = String(c.email || '').toLowerCase();
      return name.includes(q) || company.includes(q) || email.includes(q);
    });
  }, [clients, search]);

  const confirmDelete = async (client) => {
    if (!client) return;
    const ok = window.confirm(`Delete ${client.name}? This cannot be undone.`);
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'clients', client.id));
      setEditing(null);
    } catch (err) {
      window.alert(err.message || 'Could not delete contact.');
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">Contacts</h2>
        <div className="page-actions">
          <input
            className="form-input"
            style={{ minWidth: 220 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, company, or email"
          />
          <button type="button" className="btn btn-primary" onClick={() => setShowAdd(true)}>
            + Add Contact
          </button>
        </div>
      </div>

      {listError ? <div className="quotes-error" style={{ marginBottom: 16 }}>{listError}</div> : null}

      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : clients.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-text">No contacts yet — add your first one.</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-text">No contacts match your search.</div>
        </div>
      ) : (
        <div className="quotes-table-wrap">
          <table className="stack-table quotes-table">
            <tbody>
              {filtered.map((client) => {
                const clientProjects = projectMap.get(client.id) || [];
                return (
                <tr
                  key={client.id}
                  onClick={() => {
                    setSelectedContact(client);
                    setLoadingEmails(true);
                    setContactEmails([]);
                  }}
                  style={{
                    cursor: 'pointer',
                    background: selectedContact?.id === client.id ? 'rgba(56, 189, 248, 0.08)' : undefined,
                    boxShadow: selectedContact?.id === client.id ? 'inset 3px 0 0 var(--teal)' : undefined,
                  }}
                >
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {unreadClientIds.has(client.id) ? (
                        <span
                          className="quotes-unread-dot"
                          style={{ background: 'var(--coral)', boxShadow: '0 0 6px rgba(232, 92, 92, 0.55)', flexShrink: 0 }}
                          aria-label="Unread"
                        />
                      ) : null}
                      <div>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{client.name}</div>
                        {client.company ? (
                          <div className="quotes-muted">{client.company}</div>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td>{client.email || '—'}</td>
                  <td>{client.phone || '—'}</td>
                  <td>
                    {clientProjects.length
                      ? clientProjects.map((proj) => (
                        <span
                          key={proj.id}
                          style={{
                            display: 'inline-block',
                            background: `${proj.color}22`,
                            border: `1px solid ${proj.color}55`,
                            color: proj.color,
                            borderRadius: 4,
                            padding: '2px 8px',
                            fontSize: 11,
                            fontWeight: 600,
                            marginRight: 4
                          }}
                        >{proj.name}</span>
                      ))
                      : <span className="quotes-muted">—</span>}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      title="Send Email"
                      onClick={(e) => {
                        e.stopPropagation();
                        setComposingFor(client);
                        setEmailSubject('');
                        setEmailBody(DAL_SIGNATURE);
                        setEmailError('');
                        setEmailSuccess('');
                      }}
                      disabled={!client.email}
                    >
                      ✉️
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      title="Edit"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(client);
                      }}
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      title="Delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        confirmDelete(client);
                      }}
                    >
                      🗑️
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedContact ? (
        <div className="data-section" style={{ marginTop: 24 }}>
          <div className="data-section-header">
            <div>
              <h3 className="data-section-title">{selectedContact.name}</h3>
              <div className="quotes-muted">{selectedContact.email || 'No email'}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!selectedContact.email}
                onClick={() => {
                  setComposingFor(selectedContact);
                  setEmailSubject('');
                  setEmailBody(DAL_SIGNATURE);
                  setEmailError('');
                  setEmailSuccess('');
                }}
              >
                Compose
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setSelectedContact(null);
                  setComposingFor(null);
                  setAttachment(null);
                }}
              >
                ✕ Close
              </button>
            </div>
          </div>
          {loadingEmails ? (
            <div className="empty-state">
              <div className="empty-state-text">Loading messages...</div>
            </div>
          ) : contactEmails.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-text">No emails yet — click Compose to send the first one.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {contactEmails.map((email) => (
                <ThreadMessage key={email.id} email={email} />
              ))}
            </div>
          )}
        </div>
      ) : null}

      {showAdd ? (
        <ContactModal
          onClose={() => setShowAdd(false)}
          onSaved={() => setShowAdd(false)}
        />
      ) : null}

      {editing ? (
        <ContactModal
          client={editing}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
          onDelete={confirmDelete}
        />
      ) : null}

      {composingFor ? (
        <div className="modal-overlay" onClick={() => {
          if (!sendingEmail) {
            setComposingFor(null);
            setAttachment(null);
          }
        }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Email {composingFor.name}</div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setComposingFor(null);
                  setAttachment(null);
                }}
                disabled={sendingEmail}
              >✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">To</label>
                <input className="form-input" value={composingFor.email || ''} disabled />
              </div>
              <div className="form-group">
                <label className="form-label">Subject</label>
                <input
                  className="form-input"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  placeholder="Subject"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Body</label>
                <EmailBodyEditor defaultHtml={emailBody} onChange={setEmailBody} />
              </div>
              <div className="form-group">
                <label className="form-label">Attachment (optional)</label>
                <input
                  type="file"
                  className="form-input"
                  style={{ padding: '6px' }}
                  onChange={(e) => setAttachment(e.target.files[0] || null)}
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.html"
                />
                {attachment && (
                  <div style={{ fontSize: 12, color: 'var(--green-text)', marginTop: 4 }}>
                    📎 {attachment.name}
                  </div>
                )}
              </div>
              {emailError ? (
                <div style={{ color: 'var(--coral)', fontSize: 13, marginBottom: 8 }}>{emailError}</div>
              ) : null}
              {emailSuccess ? (
                <div style={{ color: 'var(--green)', fontSize: 13, marginBottom: 8 }}>{emailSuccess}</div>
              ) : null}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={sendingEmail}
                onClick={() => {
                  setComposingFor(null);
                  setAttachment(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={sendingEmail}
                onClick={async () => {
                  if (!emailSubject.trim() || !emailBody.trim()) {
                    setEmailError('Subject and body are required.');
                    return;
                  }
                  setSendingEmail(true);
                  setEmailError('');
                  setEmailSuccess('');
                  try {
                    const fd = new FormData();
                    fd.append('to', composingFor.email);
                    fd.append('clientId', composingFor.id);
                    fd.append('subject', emailSubject);
                    fd.append('body', emailBody);
                    fd.append('source', 'contact');
                    fd.append('projectId', '');
                    if (attachment) fd.append('attachment', attachment);
                    const res = await fetch('/api/client-email', {
                      method: 'POST',
                      body: fd,
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) throw new Error(data.error || 'Failed to send email.');
                    setEmailSuccess('Email sent.');
                    setEmailSubject('');
                    setEmailBody('');
                    setAttachment(null);
                    window.setTimeout(() => {
                      setComposingFor(null);
                      setAttachment(null);
                    }, 1500);
                  } catch (err) {
                    setEmailError(err.message || 'Failed to send email.');
                  } finally {
                    setSendingEmail(false);
                  }
                }}
              >
                Send Email
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
