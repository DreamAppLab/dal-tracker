import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../firebase';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';

const EMPTY_FORM = {
  name: '',
  company: '',
  email: '',
  phone: '',
  notes: '',
};

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

export default function Contacts() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [listError, setListError] = useState('');

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
              {filtered.map((client) => (
                <tr key={client.id}>
                  <td>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{client.name}</div>
                    {client.company ? (
                      <div className="quotes-muted">{client.company}</div>
                    ) : null}
                  </td>
                  <td>{client.email || '—'}</td>
                  <td>{client.phone || '—'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      title="Edit"
                      onClick={() => setEditing(client)}
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      title="Delete"
                      onClick={() => confirmDelete(client)}
                    >
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
    </div>
  );
}
