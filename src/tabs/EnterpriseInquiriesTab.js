import React, { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { dalSiteDb } from '../firebaseDalSite';

const STATUS_OPTIONS = [
  { value: 'new',              label: 'New',             color: '#60a5fa' },
  { value: 'contacted',        label: 'Contacted',       color: '#a78bfa' },
  { value: 'call_scheduled',   label: 'Call Scheduled',  color: '#fbbf24' },
  { value: 'proposal_sent',    label: 'Proposal Sent',   color: '#34d399' },
  { value: 'won',              label: 'Won',             color: '#4ade80' },
  { value: 'lost',             label: 'Lost',            color: '#f87171' },
];

const STATUS_MAP = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.value, s]));

const FIELD_LABELS = {
  'yes':            'Yes',
  'no':             'No',
  'yes-important':  'Yes — very important',
  'somewhat':       'Somewhat',
  'not-priority':   'Not a priority',
  'yes-cloud':      'Yes (cloud)',
  'qbo':            'QuickBooks Online',
  'xero':           'Xero',
  'freshbooks':     'FreshBooks',
  'other-online':   'Other online',
  'desktop':        'Desktop only',
  'none':           'None',
  'unsure':         'Unsure',
  'phone':          'Phone call',
  'email':          'Email',
  'either':         'Either',
  'morning':        'Morning (8am–12pm)',
  'afternoon':      'Afternoon (12pm–5pm)',
  'evening':        'Evening (after 5pm)',
  'anytime':        'Anytime',
  'single':         'Single location',
  'multi-city':     'Multiple cities/counties',
  'statewide':      'Statewide/regional',
  'multi-state':    'Multiple states',
  'no-formal':      'No formal system',
  'tried-failed':   'Tried, didn\'t work',
  'no-want':        'No — wants one',
  'no-dont-need':   'No — doesn\'t need one',
  'domain-only':    'Domain only',
  'none-recurring': 'No recurring customers',
  'yes-import':     'Yes — very important',
  'possibly':       'Possibly',
  'no-not-now':     'No — not now',
};

function lbl(v) {
  if (!v) return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  return FIELD_LABELS[v] || v;
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(value) {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const styles = {
  page: { padding: '24px', minHeight: '100vh', background: '#0a0a0f', color: '#e2e8f0' },
  header: { marginBottom: '24px' },
  title: { fontSize: '22px', fontWeight: 700, color: '#fff', margin: '0 0 4px', fontFamily: "'Space Grotesk', system-ui, sans-serif" },
  subtitle: { fontSize: '13px', color: '#8a8fa8', margin: 0 },
  filters: { display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' },
  select: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e2e8f0', padding: '6px 10px', fontSize: '13px', fontFamily: 'inherit', outline: 'none' },
  badge: (status) => {
    const s = STATUS_MAP[status] || { label: status || 'Unknown', color: '#94a3b8' };
    return {
      display: 'inline-block', fontSize: '11px', fontWeight: 700,
      letterSpacing: '.05em', textTransform: 'uppercase',
      color: '#0a0a0f', background: s.color,
      padding: '2px 8px', borderRadius: '999px',
    };
  },
  card: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '12px',
    marginBottom: '16px',
    overflow: 'hidden',
  },
  cardHeader: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: '16px 18px 12px', gap: '16px', flexWrap: 'wrap',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    background: 'rgba(217,119,6,0.04)',
  },
  cardBody: { padding: '14px 18px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px', marginBottom: '12px' },
  fieldBlock: {},
  fieldLabel: { fontSize: '10px', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: '#8a8fa8', marginBottom: '2px' },
  fieldValue: { fontSize: '13px', color: '#e2e8f0', lineHeight: 1.5 },
  challenges: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '2px' },
  challengeTag: { fontSize: '11px', background: 'rgba(217,119,6,0.12)', color: '#fbbf24', border: '1px solid rgba(217,119,6,0.3)', borderRadius: '999px', padding: '2px 8px' },
  notesArea: { width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e2e8f0', padding: '8px 10px', fontSize: '13px', fontFamily: 'inherit', resize: 'vertical', minHeight: '72px', outline: 'none' },
  saveBtn: { marginTop: '6px', padding: '6px 14px', background: '#d97706', border: 'none', borderRadius: '6px', color: '#0a0a0f', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  statusSelect: { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', color: '#e2e8f0', padding: '5px 8px', fontSize: '12px', fontFamily: 'inherit', outline: 'none' },
  emptyMsg: { textAlign: 'center', padding: '48px 24px', color: '#64748b', fontSize: '14px' },
  loadingMsg: { textAlign: 'center', padding: '48px', color: '#64748b' },
  countBadge: { fontSize: '12px', background: 'rgba(217,119,6,0.15)', color: '#fbbf24', border: '1px solid rgba(217,119,6,0.3)', borderRadius: '999px', padding: '2px 8px', marginLeft: '8px' },
};

function Field({ label, value }) {
  return (
    <div style={styles.fieldBlock}>
      <div style={styles.fieldLabel}>{label}</div>
      <div style={styles.fieldValue}>{lbl(value) || '—'}</div>
    </div>
  );
}

function InquiryCard({ inquiry, onUpdate }) {
  const [status, setStatus] = useState(inquiry.status || 'new');
  const [notes, setNotes] = useState(inquiry.notes || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSaveNotes() {
    setSaving(true);
    try {
      await updateDoc(doc(dalSiteDb, 'enterprise_inquiries', inquiry.id), { notes, updatedAt: new Date().toISOString() });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      if (onUpdate) onUpdate({ ...inquiry, notes });
    } catch (e) {
      console.error('Save notes error', e);
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(newStatus) {
    setStatus(newStatus);
    try {
      await updateDoc(doc(dalSiteDb, 'enterprise_inquiries', inquiry.id), { status: newStatus, updatedAt: new Date().toISOString() });
      if (onUpdate) onUpdate({ ...inquiry, status: newStatus });
    } catch (e) {
      console.error('Status update error', e);
    }
  }

  const s = STATUS_MAP[status] || { color: '#94a3b8' };
  const challenges = Array.isArray(inquiry.challenges) ? inquiry.challenges : [];

  return (
    <div style={{ ...styles.card, borderLeft: `3px solid ${s.color}` }}>
      <div style={styles.cardHeader}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '4px' }}>
            <span style={{ fontSize: '16px', fontWeight: 700, color: '#fff', fontFamily: "'Space Grotesk', sans-serif" }}>
              {inquiry.businessName || '—'}
            </span>
            <span style={{ fontSize: '12px', color: '#fbbf24', background: 'rgba(217,119,6,0.12)', border: '1px solid rgba(217,119,6,0.3)', borderRadius: '999px', padding: '2px 8px' }}>
              {inquiry.businessType || 'Unknown type'}
            </span>
          </div>
          <div style={{ fontSize: '13px', color: '#8a8fa8' }}>
            {inquiry.contactName} &middot; <a href={`mailto:${inquiry.email}`} style={{ color: '#60a5fa', textDecoration: 'none' }}>{inquiry.email}</a>
            {inquiry.phone && <> &middot; {inquiry.phone}</>}
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>Submitted: {fmtDate(inquiry.createdAt)}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
          <span style={styles.badge(status)}>{STATUS_MAP[status]?.label || status}</span>
          <select
            style={styles.statusSelect}
            value={status}
            onChange={(e) => handleStatusChange(e.target.value)}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div style={styles.cardBody}>
        <div style={styles.grid}>
          <Field label="Recurring Customers" value={inquiry.recurringCustomers} />
          <Field label="Total Customers" value={inquiry.totalCustomers} />
          <Field label="Employees" value={inquiry.employees} />
          <Field label="Vehicles" value={inquiry.vehicles} />
          <Field label="Locations" value={inquiry.locations} />
          <Field label="Current Software" value={inquiry.currentSoftware === 'yes' ? (inquiry.currentSoftwareName || 'Yes') : lbl(inquiry.currentSoftware)} />
          <Field label="Has Website" value={inquiry.hasWebsite === 'yes' ? (inquiry.websiteUrl || 'Yes') : lbl(inquiry.hasWebsite)} />
          <Field label="Accounting" value={inquiry.accountingSoftware === 'other-online' ? (inquiry.accountingSoftwareOther || 'Other') : lbl(inquiry.accountingSoftware)} />
          <Field label="Needs Job Costing" value={inquiry.needsJobCosting} />
          <Field label="Has Warehouse" value={inquiry.hasWarehouse} />
          <Field label="Wants White Label" value={inquiry.wantsWhiteLabel} />
          <Field label="Preferred Contact" value={inquiry.preferredContact} />
          <Field label="Best Time" value={inquiry.bestTime} />
        </div>
        {challenges.length > 0 && (
          <div style={{ marginBottom: '12px' }}>
            <div style={styles.fieldLabel}>Challenges</div>
            <div style={styles.challenges}>
              {challenges.map((c, i) => (
                <span key={i} style={styles.challengeTag}>{c.replace(/-/g, ' ')}</span>
              ))}
            </div>
          </div>
        )}
        {inquiry.additionalNotes && (
          <div style={{ marginBottom: '12px' }}>
            <div style={styles.fieldLabel}>Their Notes</div>
            <div style={{ ...styles.fieldValue, background: 'rgba(255,255,255,0.03)', padding: '8px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)', fontSize: '12px', color: '#94a3b8', lineHeight: 1.6 }}>
              {inquiry.additionalNotes}
            </div>
          </div>
        )}
        <div>
          <div style={styles.fieldLabel}>Eddie's Notes</div>
          <textarea
            style={styles.notesArea}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add notes after each interaction — call summary, next steps, details, etc."
          />
          <button style={styles.saveBtn} onClick={handleSaveNotes} disabled={saving}>
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Notes'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function EnterpriseInquiriesTab() {
  const [inquiries, setInquiries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const q = query(collection(dalSiteDb, 'enterprise_inquiries'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setInquiries(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, (err) => {
      console.error('Enterprise inquiries error', err);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  function handleUpdate(updated) {
    setInquiries((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
  }

  const filtered = inquiries.filter((i) => {
    if (statusFilter && i.status !== statusFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      return (
        String(i.businessName || '').toLowerCase().includes(s) ||
        String(i.contactName || '').toLowerCase().includes(s) ||
        String(i.email || '').toLowerCase().includes(s) ||
        String(i.businessType || '').toLowerCase().includes(s)
      );
    }
    return true;
  });

  const counts = STATUS_OPTIONS.reduce((acc, o) => {
    acc[o.value] = inquiries.filter((i) => (i.status || 'new') === o.value).length;
    return acc;
  }, {});

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>
          ⭐ Enterprise Inquiries
          {inquiries.length > 0 && <span style={styles.countBadge}>{inquiries.length}</span>}
        </h1>
        <p style={styles.subtitle}>Enterprise plan inquiries from the DAL website &mdash; businesses with 1,000+ recurring customers</p>
      </div>

      {/* Status summary pills */}
      {!loading && inquiries.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
          {STATUS_OPTIONS.filter((o) => counts[o.value] > 0).map((o) => (
            <button
              key={o.value}
              onClick={() => setStatusFilter(statusFilter === o.value ? '' : o.value)}
              style={{
                padding: '4px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 700,
                border: `1px solid ${o.color}50`,
                background: statusFilter === o.value ? o.color : `${o.color}15`,
                color: statusFilter === o.value ? '#0a0a0f' : o.color,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {o.label} ({counts[o.value]})
            </button>
          ))}
          {statusFilter && (
            <button onClick={() => setStatusFilter('')} style={{ padding: '4px 10px', borderRadius: '999px', fontSize: '12px', border: '1px solid rgba(255,255,255,.12)', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontFamily: 'inherit' }}>
              Clear filter ✕
            </button>
          )}
        </div>
      )}

      <div style={styles.filters}>
        <input
          style={{ ...styles.select, minWidth: '200px', padding: '7px 12px' }}
          type="text"
          placeholder="Search by name, business, email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div style={styles.loadingMsg}>Loading enterprise inquiries…</div>
      ) : filtered.length === 0 ? (
        <div style={styles.emptyMsg}>
          {inquiries.length === 0
            ? 'No enterprise inquiries yet. They\'ll appear here when someone submits the enterprise intake form.'
            : 'No inquiries match your current filter.'}
        </div>
      ) : (
        filtered.map((inquiry) => (
          <InquiryCard key={inquiry.id} inquiry={inquiry} onUpdate={handleUpdate} />
        ))
      )}
    </div>
  );
}
