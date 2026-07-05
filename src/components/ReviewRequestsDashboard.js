import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import AddContactModal from './AddContactModal';
import { INTRO_SMS, getReviewRequestSms, sendSms } from '../utils/twilioApi';

function todayIsoDate() {
  return new Date().toISOString().split('T')[0];
}

export default function ReviewRequestsDashboard({ projects }) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [pendingCells, setPendingCells] = useState({});
  const [error, setError] = useState('');

  const ownApps = projects
    .filter(p => p.type === 'own-app')
    .sort((a, b) => a.name.localeCompare(b.name));

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'contacts'), (snapshot) => {
      const data = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setContacts(data);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const handleAddContact = async (newContact) => {
    await setDoc(doc(db, 'contacts', newContact.id), newContact, { merge: true });
    setShowAddModal(false);
  };

  const setCellPending = (contactId, projectId, isPending) => {
    const key = `${contactId}:${projectId}`;
    setPendingCells(prev => {
      const next = { ...prev };
      if (isPending) next[key] = true;
      else delete next[key];
      return next;
    });
  };

  const handleCheckboxChange = async (contact, project, checked) => {
    const contactId = contact.id;
    const projectId = project.id;
    const key = `${contactId}:${projectId}`;
    if (pendingCells[key]) return;

    setError('');

    if (!checked) {
      setCellPending(contactId, projectId, true);
      try {
        const existingTextedApps = contact.textedApps || {};
        const existingApp = existingTextedApps[projectId] || {};
        await setDoc(
          doc(db, 'contacts', contactId),
          {
            textedApps: {
              ...existingTextedApps,
              [projectId]: { ...existingApp, requestSent: false },
            },
          },
          { merge: true }
        );
      } catch (err) {
        setError(err.message || 'Failed to update contact');
      } finally {
        setCellPending(contactId, projectId, false);
      }
      return;
    }

    setCellPending(contactId, projectId, true);
    try {
      if (!contact.introSent) {
        await sendSms(contact.phone, INTRO_SMS);
        await setDoc(doc(db, 'contacts', contactId), { introSent: true }, { merge: true });
      }

      await sendSms(contact.phone, getReviewRequestSms(project.name));

      const existingTextedApps = contact.textedApps || {};
      await setDoc(
        doc(db, 'contacts', contactId),
        {
          textedApps: {
            ...existingTextedApps,
            [projectId]: { requestSent: true, lastSentDate: todayIsoDate() },
          },
        },
        { merge: true }
      );
    } catch (err) {
      setError(err.message || 'Failed to send SMS');
    } finally {
      setCellPending(contactId, projectId, false);
    }
  };

  if (loading) {
    return (
      <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
        <span style={{ color: 'var(--text-muted)' }}>Loading review requests...</span>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Review Requests</h1>
          <p className="page-subtitle">Track review-request texts sent to contacts for each app</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary btn-sm" onClick={() => setShowAddModal(true)}>
            + Add Contact
          </button>
        </div>
      </div>

      {error && (
        <div className="review-requests-error" role="alert">
          {error}
        </div>
      )}

      {ownApps.length === 0 ? (
        <div className="data-section">
          <p style={{ color: 'var(--text-muted)' }}>No own-app projects found. Add apps in Projects to build the grid.</p>
        </div>
      ) : contacts.length === 0 ? (
        <div className="data-section">
          <p style={{ color: 'var(--text-muted)' }}>No contacts yet. Click &quot;+ Add Contact&quot; to get started.</p>
        </div>
      ) : (
        <div className="data-section" style={{ paddingTop: 0 }}>
          <div className="review-requests-table-wrap">
            <table className="stack-table review-requests-table">
              <thead>
                <tr>
                  <th className="review-requests-sticky-col">Contact</th>
                  {ownApps.map(app => (
                    <th key={app.id} className="review-requests-app-col">{app.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {contacts.map(contact => (
                  <tr key={contact.id}>
                    <td className="review-requests-sticky-col">
                      <div className="review-requests-contact-name">{contact.name}</div>
                      <div className="review-requests-contact-phone">{contact.phone}</div>
                    </td>
                    {ownApps.map(app => {
                      const appData = contact.textedApps?.[app.id] || {};
                      const isChecked = !!appData.requestSent;
                      const isPending = !!pendingCells[`${contact.id}:${app.id}`];
                      const lastSentDate = appData.lastSentDate;

                      return (
                        <td key={app.id} className="review-requests-cell">
                          <label className={`review-requests-checkbox-label ${isPending ? 'pending' : ''}`}>
                            <input
                              type="checkbox"
                              className="review-requests-checkbox"
                              checked={isChecked}
                              disabled={isPending}
                              onChange={e => handleCheckboxChange(contact, app, e.target.checked)}
                            />
                            {isChecked && lastSentDate && (
                              <span className="review-requests-sent-date" title={`Sent on ${lastSentDate}`}>
                                Sent on {lastSentDate}
                              </span>
                            )}
                          </label>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showAddModal && (
        <AddContactModal
          onAdd={handleAddContact}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}
