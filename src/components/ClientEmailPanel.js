// Email thread + Compose for one client contact, shown on a Web Project.
//
// Shows every email with this contact (sent from Web Projects, Contacts or a
// project's Client tab) so the whole conversation is in one place. Sending goes
// through /api/client-email (server-side Mailgun, Reply-To the Mission Control
// inbound address), so the client's replies thread back here and are copied to
// lab@dreamapplab.com by /api/inbound-client-email.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { collection, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { apiFetch } from '../lib/apiClient';
import EmailBodyEditor from './EmailBodyEditor';
import EmailMessageBody from './EmailMessageBody';
import { DAL_SIGNATURE } from '../utils/dalEmailSignature';

const BRAND = '#4CC1F3';

function sentAtMs(v) {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function formatSentAt(v) {
  const ms = sentAtMs(v);
  return ms ? new Date(ms).toLocaleString() : '';
}

const SOURCE_LABEL = {
  webProject: 'Web Project',
  contact: 'Contacts',
  project: 'Project',
  client: 'Client',
  quote: 'Quote',
};

export default function ClientEmailPanel({ contactId, projectId, onEditProject }) {
  const [contact, setContact] = useState(null);
  const [contactLoaded, setContactLoaded] = useState(false);
  const [emails, setEmails] = useState([]);
  const [loadingEmails, setLoadingEmails] = useState(true);
  const [loadError, setLoadError] = useState('');
  const unreadRef = useRef([]);
  const [composing, setComposing] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState(DAL_SIGNATURE);
  const [attachment, setAttachment] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setContact(null);
    setContactLoaded(false);
    if (!contactId) { setContactLoaded(true); return undefined; }
    return onSnapshot(
      doc(db, 'clients', contactId),
      (snap) => { setContact(snap.exists() ? { id: snap.id, ...snap.data() } : null); setContactLoaded(true); },
      () => setContactLoaded(true)
    );
  }, [contactId]);

  const markVisibleRead = useCallback(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const ids = unreadRef.current;
    unreadRef.current = [];
    ids.forEach((id) => updateDoc(doc(db, 'clientEmails', id), { read: true }).catch(() => {}));
  }, []);

  useEffect(() => {
    setEmails([]);
    unreadRef.current = [];
    if (!contactId) { setLoadingEmails(false); return undefined; }
    setLoadingEmails(true);
    const q = query(collection(db, 'clientEmails'), where('clientId', '==', contactId));
    return onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        rows.sort((a, b) => sentAtMs(a.sentAt) - sentAtMs(b.sentAt));
        setEmails(rows);
        setLoadingEmails(false);
        setLoadError('');
        unreadRef.current = rows.filter((r) => r.direction === 'inbound' && r.read === false).map((r) => r.id);
        markVisibleRead();
      },
      () => { setLoadingEmails(false); setLoadError('Could not load emails. Refresh to try again.'); }
    );
  }, [contactId, markVisibleRead]);

  // Replies count as read only when the page is actually visible.
  useEffect(() => {
    const onVisible = () => markVisibleRead();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [markVisibleRead]);

  // The success notice fades after a few seconds.
  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 8000);
    return () => clearTimeout(t);
  }, [notice]);

  const canEmail = !!(contact && contact.email);

  const openCompose = () => {
    setError('');
    setNotice('');
    setSubject('');
    setBody(DAL_SIGNATURE);
    setAttachment(null);
    setComposing(true);
  };

  const closeCompose = () => {
    if (sending) return;
    setComposing(false);
    setAttachment(null);
  };

  // Focus Subject once, when the dialog opens (not on every keystroke).
  useEffect(() => {
    if (!composing) return undefined;
    const t = setTimeout(() => { const el = document.getElementById('cep-subject'); if (el) el.focus(); }, 0);
    return () => clearTimeout(t);
  }, [composing]);

  // Escape closes the dialog, except while a send is in flight.
  useEffect(() => {
    if (!composing) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !sending) { setComposing(false); setAttachment(null); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [composing, sending]);

  async function send() {
    if (!canEmail) { setError('This contact has no email address.'); return; }
    if (!subject.trim() || !body.trim()) { setError('Subject and message are required.'); return; }
    setSending(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('to', contact.email);
      fd.append('clientId', contact.id);
      fd.append('subject', subject.trim());
      fd.append('body', body);
      fd.append('source', 'webProject');
      if (projectId) fd.append('projectId', projectId);
      if (attachment) fd.append('attachment', attachment);
      const res = await apiFetch('/api/client-email', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Email could not be sent.');
      setComposing(false);
      setAttachment(null);
      setNotice(`Sent to ${contact.email}. Replies will show here and in lab@dreamapplab.com.`);
    } catch (e) {
      setError(e.message || 'Email could not be sent.');
    } finally {
      setSending(false);
    }
  }

  return (
    <section style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 20, marginBottom: 24 }} aria-label="Client emails">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 17 }}>✉️ Client emails</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#94a3b8' }}>
            {canEmail
              ? <>To {contact.name || 'client'} · {contact.email}</>
              : contactLoaded && contactId && !contact
                ? 'The assigned contact no longer exists.'
                : contactLoaded && contact && !contact.email
                  ? `${contact.name || 'This contact'} has no email address. Add one in Contacts.`
                  : contactLoaded ? 'Assign a contact to email this client.' : 'Loading contact…'}
          </p>
        </div>
        {canEmail ? (
          <button type="button" onClick={openCompose}
            style={{ background: BRAND, border: 'none', color: '#000', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
            Compose
          </button>
        ) : contactLoaded && !contactId && onEditProject ? (
          <button type="button" onClick={onEditProject}
            style={{ background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            Assign contact
          </button>
        ) : null}
      </div>

      {notice ? <div role="status" style={{ fontSize: 12, color: '#4ade80', marginBottom: 12 }}>{notice}</div> : null}

      {contactId && loadingEmails ? <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>Loading emails…</p> : null}
      {loadError ? <p role="alert" style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{loadError}</p> : null}
      {contactId && !loadingEmails && !loadError && emails.length === 0 ? (
        <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>No emails with this client yet. Click Compose to send the first one.</p>
      ) : null}

      {emails.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 520, overflowY: 'auto', paddingRight: 4 }}>
          {emails.map((email) => {
            const outbound = email.direction === 'outbound';
            return (
              <div key={email.id}
                style={{
                  alignSelf: outbound ? 'flex-end' : 'flex-start',
                  maxWidth: '82%',
                  background: outbound ? 'rgba(76,193,243,0.10)' : '#111827',
                  border: `1px solid ${outbound ? 'rgba(76,193,243,0.35)' : '#1e293b'}`,
                  borderRadius: 12,
                  padding: 14,
                }}>
                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>
                  {outbound ? `Sent to ${email.to}` : `${email.parentId ? 'Reply from' : 'From'} ${email.to}`} · {formatSentAt(email.sentAt)}
                  {email.source && SOURCE_LABEL[email.source] && email.source !== 'webProject' ? ` · via ${SOURCE_LABEL[email.source]}` : ''}
                </div>
                <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 14 }}>{email.subject}</div>
                <EmailMessageBody email={email} />
                {email.hasAttachment === true && email.attachmentUrl ? (
                  <a href={email.attachmentUrl} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'inline-block', marginTop: 8, fontSize: 12, color: BRAND }}>
                    📎 {email.attachmentName}
                  </a>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {composing ? (
        <div className="modal-overlay">
          <div className="modal" role="dialog" aria-modal="true" aria-label="Compose email">
            <div className="modal-header">
              <div className="modal-title">Email {contact?.name || 'client'}</div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={closeCompose} disabled={sending} aria-label="Close">✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label" htmlFor="cep-to">To</label>
                <input id="cep-to" className="form-input" value={`${contact?.name || ''} <${contact?.email || ''}>`} readOnly />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="cep-subject">Subject</label>
                <input id="cep-subject" className="form-input" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} />
              </div>
              <div className="form-group">
                <div className="form-label" id="cep-message-label">Message</div>
                <div aria-labelledby="cep-message-label"><EmailBodyEditor defaultHtml={body} onChange={setBody} /></div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="cep-attachment">Attachment (optional)</label>
                <input id="cep-attachment" type="file" className="form-input" style={{ padding: 6 }}
                  onChange={(e) => setAttachment(e.target.files[0] || null)}
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.html" />
                {attachment ? <div style={{ fontSize: 12, color: 'var(--green-text)', marginTop: 4 }}>📎 {attachment.name}</div> : null}
              </div>
              {error ? <div className="quotes-error" role="alert">{error}</div> : null}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={closeCompose} disabled={sending}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={send} disabled={sending}>{sending ? 'Sending…' : 'Send Email'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
