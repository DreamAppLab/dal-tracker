// clientEmails collection schema:
// { clientId, projectId, source, threadId, subject, body, to, sentAt, direction, read, parentId }
// clients collection schema:
// { name, company, email, phone, notes, createdAt, updatedAt }
// projects.clientIds: string[] — array of client doc IDs assigned to this project

import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../firebase';
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  onSnapshot,
  orderBy,
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

export default function ClientTab({ project }) {
  const [allClients, setAllClients] = useState([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [showAssignPicker, setShowAssignPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [showAddNew, setShowAddNew] = useState(false);
  const [newForm, setNewForm] = useState({ ...EMPTY_FORM });
  const [newError, setNewError] = useState('');
  const [savingNew, setSavingNew] = useState(false);

  const [emails, setEmails] = useState([]);
  const [loadingEmails, setLoadingEmails] = useState(true);
  const [composing, setComposing] = useState(false);
  const [composeClient, setComposeClient] = useState(null);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailError, setEmailError] = useState('');

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'clients'), (snapshot) => {
      const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      data.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
      setAllClients(data);
      setLoadingClients(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!project?.id) return;
    const q = query(
      collection(db, 'clientEmails'),
      where('projectId', '==', project.id),
      where('source', '==', 'project'),
      orderBy('sentAt', 'asc')
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setEmails(data);
      setLoadingEmails(false);
      snapshot.docs.forEach((emailDoc) => {
        const row = emailDoc.data();
        if (row.direction === 'inbound' && row.read === false) {
          updateDoc(doc(db, 'clientEmails', emailDoc.id), { read: true }).catch(() => {});
        }
      });
    });
    return () => unsub();
  }, [project?.id]);

  const assignedClients = useMemo(() => {
    const ids = project.clientIds || [];
    return allClients.filter((c) => ids.includes(c.id));
  }, [allClients, project.clientIds]);

  const unassignedClients = useMemo(() => {
    const ids = project.clientIds || [];
    return allClients.filter((c) => !ids.includes(c.id));
  }, [allClients, project.clientIds]);

  const pickerFiltered = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return unassignedClients;
    return unassignedClients.filter((c) => {
      const name = String(c.name || '').toLowerCase();
      const company = String(c.company || '').toLowerCase();
      const email = String(c.email || '').toLowerCase();
      return name.includes(q) || company.includes(q) || email.includes(q);
    });
  }, [unassignedClients, pickerSearch]);

  const emailableClients = assignedClients.filter((c) => c.email);

  async function handleAssign(clientId) {
    await updateDoc(doc(db, 'projects', project.id), {
      clientIds: arrayUnion(clientId)
    });
    setShowAssignPicker(false);
    setPickerSearch('');
  }

  async function handleUnassign(clientId, clientName) {
    const ok = window.confirm(`Remove ${clientName} from this project?`);
    if (!ok) return;
    await updateDoc(doc(db, 'projects', project.id), {
      clientIds: arrayRemove(clientId)
    });
  }

  async function handleAddNew(e) {
    e.preventDefault();
    const name = newForm.name.trim();
    if (!name) {
      setNewError('Name is required.');
      return;
    }
    setSavingNew(true);
    setNewError('');
    try {
      const payload = {
        name,
        company: newForm.company.trim(),
        email: newForm.email.trim(),
        phone: newForm.phone.trim(),
        notes: newForm.notes.trim(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const ref = await addDoc(collection(db, 'clients'), payload);
      await updateDoc(doc(db, 'projects', project.id), {
        clientIds: arrayUnion(ref.id)
      });
      setShowAddNew(false);
      setNewForm({ ...EMPTY_FORM });
    } catch (err) {
      setNewError(err.message || 'Could not add contact.');
    } finally {
      setSavingNew(false);
    }
  }

  async function handleSendEmail() {
    if (!composeClient?.email) {
      setEmailError('Select a contact with an email address.');
      return;
    }
    if (!emailSubject.trim() || !emailBody.trim()) {
      setEmailError('Subject and body are required.');
      return;
    }
    setSendingEmail(true);
    setEmailError('');
    try {
      const res = await fetch('/api/client-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: composeClient.email,
          clientId: composeClient.id,
          subject: emailSubject,
          body: emailBody,
          source: 'project',
          projectId: project.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to send email.');
      setComposing(false);
      setComposeClient(null);
      setEmailSubject('');
      setEmailBody('');
    } catch (err) {
      setEmailError(err.message || 'Failed to send email.');
    } finally {
      setSendingEmail(false);
    }
  }

  return (
    <div className="data-section">
      <div className="data-section-header">
        <h3 className="data-section-title">Assigned Contacts</h3>
        <div style={{ display: 'flex', gap: 8, position: 'relative' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowAssignPicker((v) => !v)}
          >
            Assign Existing
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => { setNewError(''); setShowAddNew(true); }}>
            Add New
          </button>
          {showAssignPicker ? (
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: 36,
                zIndex: 20,
                width: 320,
                background: 'var(--bg-card)',
                border: '1px solid var(--border-active)',
                borderRadius: 'var(--radius-sm)',
                padding: 12,
                boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
              }}
            >
              <input
                className="form-input"
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                placeholder="Search contacts"
                style={{ marginBottom: 8 }}
              />
              {unassignedClients.length === 0 ? (
                <div className="quotes-muted">All contacts are assigned</div>
              ) : pickerFiltered.length === 0 ? (
                <div className="quotes-muted">No matching contacts</div>
              ) : (
                <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                  {pickerFiltered.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 4 }}
                      onClick={() => handleAssign(c.id)}
                    >
                      <div>{c.name}</div>
                      {c.email || c.company ? (
                        <div className="quotes-muted">{[c.company, c.email].filter(Boolean).join(' · ')}</div>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {loadingClients ? (
        <div className="empty-state">Loading...</div>
      ) : assignedClients.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-text">No contacts assigned to this project yet.</div>
        </div>
      ) : (
        <div className="quotes-table-wrap">
          <table className="stack-table quotes-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Company</th>
                <th>Email</th>
                <th>Phone</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {assignedClients.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 700 }}>{c.name}</td>
                  <td>{c.company || '—'}</td>
                  <td>{c.email || '—'}</td>
                  <td>{c.phone || '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      title="Unassign"
                      onClick={() => handleUnassign(c.id, c.name)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="data-section-header" style={{ marginTop: 32 }}>
        <h3 className="data-section-title">Email Thread</h3>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={assignedClients.length === 0}
          title={assignedClients.length === 0 ? 'Assign a contact first' : 'Compose'}
          onClick={() => {
            setEmailError('');
            setEmailSubject('');
            setEmailBody('');
            setComposeClient(emailableClients[0] || null);
            setComposing(true);
          }}
        >
          Compose
        </button>
      </div>

      {loadingEmails ? (
        <div className="empty-state">Loading...</div>
      ) : emails.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-text">No emails yet — compose your first message to a client.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {emails.map((email) => {
            const outbound = email.direction === 'outbound';
            return (
              <div
                key={email.id}
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
                  {outbound ? 'Sent' : 'Reply'} · {outbound ? `To ${email.to}` : `From ${email.to}`} · {formatSentAt(email.sentAt)}
                </div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{email.subject}</div>
                <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.5 }}>{email.body}</div>
              </div>
            );
          })}
        </div>
      )}

      {showAddNew ? (
        <div className="modal-overlay" onClick={() => !savingNew && setShowAddNew(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Add New Contact</div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAddNew(false)}>✕</button>
            </div>
            <form onSubmit={handleAddNew}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Name *</label>
                  <input className="form-input" value={newForm.name} onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Company</label>
                  <input className="form-input" value={newForm.company} onChange={(e) => setNewForm((f) => ({ ...f, company: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input className="form-input" type="email" value={newForm.email} onChange={(e) => setNewForm((f) => ({ ...f, email: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input className="form-input" type="tel" value={newForm.phone} onChange={(e) => setNewForm((f) => ({ ...f, phone: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Notes</label>
                  <textarea className="form-textarea" rows={3} value={newForm.notes} onChange={(e) => setNewForm((f) => ({ ...f, notes: e.target.value }))} />
                </div>
                {newError ? <div className="quotes-error">{newError}</div> : null}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowAddNew(false)} disabled={savingNew}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={savingNew}>Save Contact</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {composing ? (
        <div className="modal-overlay" onClick={() => !sendingEmail && setComposing(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Compose Email</div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setComposing(false)} disabled={sendingEmail}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">To</label>
                <select
                  className="form-select"
                  value={composeClient?.id || ''}
                  onChange={(e) => setComposeClient(emailableClients.find((c) => c.id === e.target.value) || null)}
                >
                  <option value="">Select a contact</option>
                  {emailableClients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.email})</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Subject</label>
                <input className="form-input" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Body</label>
                <textarea className="form-textarea" rows={8} value={emailBody} onChange={(e) => setEmailBody(e.target.value)} />
              </div>
              {emailError ? <div className="quotes-error">{emailError}</div> : null}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => setComposing(false)} disabled={sendingEmail}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={handleSendEmail} disabled={sendingEmail}>Send Email</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
