import React, { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../firebase';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  BURNING_BUSH_LINE_ITEMS,
  calcRegularTotal,
  formatMoney,
} from '../data/burningBushQuoteItems';

const STATUS_META = {
  draft: { label: 'Draft', color: '#94a3b8', bg: 'rgba(148,163,184,0.14)' },
  sent: { label: 'Sent', color: '#60a5fa', bg: 'rgba(96,165,250,0.14)' },
  approved: { label: 'Approved', color: '#22c55e', bg: 'rgba(34,197,94,0.14)' },
  declined: { label: 'Declined', color: '#ef4444', bg: 'rgba(239,68,68,0.14)' },
};

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.draft;
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 12,
      fontSize: 11,
      fontWeight: 700,
      color: meta.color,
      background: meta.bg,
    }}>
      {meta.label}
    </span>
  );
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(value) {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function paymentPlanLabel(quote) {
  if (quote.payment_plan === 'monthly') {
    const n = Number(quote.monthly_payments) || 0;
    const amt = Number(quote.monthly_amount) || 0;
    return `${n} × ${formatMoney(amt)}`;
  }
  return 'Pay in full';
}

function paymentSummary(quote) {
  const price = Number(quote.adjusted_price);
  if (quote.payment_plan === 'monthly') {
    const n = Number(quote.monthly_payments) || 0;
    const amt = Number(quote.monthly_amount) || 0;
    return `${n} monthly payments of ${formatMoney(amt)} = ${formatMoney(n * amt)} total`;
  }
  return `Pay in full: ${formatMoney(price)}`;
}

export function ManualQuotesDraftListener({ onHasDrafts }) {
  useEffect(() => {
    const q = query(collection(db, 'quotes'), where('status', '==', 'draft'));
    const unsub = onSnapshot(q, (snap) => {
      onHasDrafts(snap.size > 0);
    }, () => onHasDrafts(false));
    return () => unsub();
  }, [onHasDrafts]);
  return null;
}

function ContactPicker({ value, onChange }) {
  const [contacts, setContacts] = useState([]);
  const [queryText, setQueryText] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    getDocs(collection(db, 'clients'))
      .then((snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
        setContacts(rows);
      })
      .catch((err) => console.error('Failed to load contacts', err));
  }, []);

  useEffect(() => {
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const filtered = useMemo(() => {
    const q = queryText.trim().toLowerCase();
    const list = !q
      ? contacts
      : contacts.filter((c) =>
          [c.name, c.company, c.email].some((v) => String(v || '').toLowerCase().includes(q))
        );
    return list.slice(0, 12);
  }, [contacts, queryText]);

  const display = value
    ? `${value.name || ''}${value.company ? ` — ${value.company}` : ''}`
    : queryText;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        className="form-input"
        value={display}
        onChange={(e) => { onChange(null); setQueryText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search contacts..."
        autoComplete="off"
      />
      {value && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => { onChange(null); setQueryText(''); setOpen(true); }}
          style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)' }}
        >
          ×
        </button>
      )}
      {open && !value && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
          background: 'var(--bg-card)', border: '1px solid var(--border-active)',
          borderRadius: 8, maxHeight: 220, overflowY: 'auto',
        }}>
          {filtered.length === 0 ? (
            <div className="quotes-muted" style={{ padding: '9px 12px' }}>
              {contacts.length === 0 ? 'Loading contacts…' : 'No matching contacts'}
            </div>
          ) : filtered.map((c) => (
            <button
              key={c.id}
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ display: 'block', width: '100%', textAlign: 'left' }}
              onClick={() => { onChange(c); setQueryText(''); setOpen(false); }}
            >
              <div>{c.name}</div>
              {c.company ? <div className="quotes-muted">{c.company}</div> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function emptyItem() {
  return { name: '', price: 0, included: false };
}

function QuoteModal({ quote, onClose, onSaved }) {
  const isEdit = Boolean(quote);
  const [contact, setContact] = useState(
    quote?.contact_id
      ? { id: quote.contact_id, name: quote.contact_name, email: quote.contact_email }
      : null
  );
  const [projectName, setProjectName] = useState(quote?.project_name || '');
  const [lineItems, setLineItems] = useState(
    Array.isArray(quote?.line_items) && quote.line_items.length
      ? quote.line_items.map((i) => ({ name: i.name || '', price: Number(i.price) || 0, included: Boolean(i.included) }))
      : [emptyItem()]
  );
  const [adjustedPrice, setAdjustedPrice] = useState(quote?.adjusted_price ?? '');
  const [adjustmentNote, setAdjustmentNote] = useState(quote?.adjustment_note || '');
  const [paymentPlan, setPaymentPlan] = useState(quote?.payment_plan || 'full');
  const [monthlyAmount, setMonthlyAmount] = useState(quote?.monthly_amount ?? '');
  const [monthlyPayments, setMonthlyPayments] = useState(quote?.monthly_payments ?? '');
  const [stripeLink, setStripeLink] = useState(quote?.stripe_payment_link || '');
  const [status, setStatus] = useState(quote?.status || 'draft');
  const [notes, setNotes] = useState(quote?.notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const regularTotal = calcRegularTotal(lineItems);
  const monthlyTotal = (Number(monthlyAmount) || 0) * (Number(monthlyPayments) || 0);

  const updateItem = (idx, patch) => {
    setLineItems((prev) => prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  };

  const handleSave = async () => {
    if (!contact?.id) { setError('Contact is required'); return; }
    if (!projectName.trim()) { setError('Project name is required'); return; }
    setSaving(true);
    setError('');
    const payload = {
      contact_id: contact.id,
      contact_name: contact.name || '',
      contact_email: contact.email || '',
      project_name: projectName.trim(),
      status,
      line_items: lineItems.map((i) => ({
        name: i.name.trim(),
        price: Number(i.price) || 0,
        included: Boolean(i.included),
      })),
      regular_total: regularTotal,
      adjusted_price: Number(adjustedPrice) || 0,
      adjustment_note: adjustmentNote.trim(),
      payment_plan: paymentPlan,
      monthly_amount: paymentPlan === 'monthly' ? Number(monthlyAmount) || 0 : 0,
      monthly_payments: paymentPlan === 'monthly' ? Number(monthlyPayments) || 0 : 0,
      stripe_payment_link: stripeLink.trim(),
      notes: notes.trim(),
      updated_at: serverTimestamp(),
    };
    try {
      if (isEdit) {
        await updateDoc(doc(db, 'quotes', quote.id), payload);
        onSaved({ ...quote, ...payload, id: quote.id });
      } else {
        const ref = await addDoc(collection(db, 'quotes'), {
          ...payload,
          created_at: serverTimestamp(),
        });
        onSaved({ ...payload, id: ref.id });
      }
    } catch (e) {
      setError(e.message || 'Could not save quote');
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-active)',
        borderRadius: 14, padding: 28, width: 720, maxHeight: '92vh', overflowY: 'auto',
      }}>
        <h3 style={{ margin: '0 0 18px', fontSize: 18 }}>{isEdit ? 'Edit Quote' : 'New Quote'}</h3>
        {error && <div className="quotes-error" style={{ marginBottom: 12 }}>{error}</div>}

        <div className="form-group">
          <label className="form-label">Contact</label>
          <ContactPicker value={contact} onChange={setContact} />
        </div>

        <div className="form-group">
          <label className="form-label">Project Name</label>
          <input className="form-input" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Client website" />
        </div>

        <div className="form-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <label className="form-label" style={{ marginBottom: 0 }}>Line Items</label>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setLineItems(BURNING_BUSH_LINE_ITEMS.map((i) => ({ ...i })))}
            >
              Load Burning Bush Items
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {lineItems.map((item, idx) => (
              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 110px auto auto', gap: 8, alignItems: 'center' }}>
                <input
                  className="form-input"
                  value={item.name}
                  onChange={(e) => updateItem(idx, { name: e.target.value })}
                  placeholder="Item name"
                />
                <input
                  className="form-input"
                  type="number"
                  min="0"
                  step="1"
                  value={item.included ? '' : item.price}
                  disabled={item.included}
                  placeholder={item.included ? 'Included' : '0'}
                  onChange={(e) => updateItem(idx, { price: e.target.value === '' ? 0 : Number(e.target.value) })}
                />
                <label className="quotes-muted" style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                  <input
                    type="checkbox"
                    checked={item.included}
                    onChange={(e) => updateItem(idx, { included: e.target.checked })}
                  />
                  Included
                </label>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLineItems((prev) => prev.filter((_, i) => i !== idx))} title="Remove">×</button>
              </div>
            ))}
          </div>
          <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} onClick={() => setLineItems((prev) => [...prev, emptyItem()])}>
            + Add Line Item
          </button>
        </div>

        <div className="form-group">
          <label className="form-label">Regular Total</label>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{formatMoney(regularTotal)}</div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Adjusted Price (what client pays)</label>
            <input className="form-input" type="number" min="0" value={adjustedPrice} onChange={(e) => setAdjustedPrice(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Reason for adjustment (internal only)</label>
            <input className="form-input" value={adjustmentNote} onChange={(e) => setAdjustmentNote(e.target.value)} placeholder="BNI member discount" />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Payment Plan</label>
          <div style={{ display: 'flex', gap: 18 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="radio" name="payment_plan" checked={paymentPlan === 'full'} onChange={() => setPaymentPlan('full')} />
              Pay in Full
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="radio" name="payment_plan" checked={paymentPlan === 'monthly'} onChange={() => setPaymentPlan('monthly')} />
              Monthly Payments
            </label>
          </div>
        </div>

        {paymentPlan === 'monthly' && (
          <>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Monthly Amount</label>
                <input className="form-input" type="number" min="0" value={monthlyAmount} onChange={(e) => setMonthlyAmount(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Number of Payments</label>
                <input className="form-input" type="number" min="1" value={monthlyPayments} onChange={(e) => setMonthlyPayments(e.target.value)} />
              </div>
            </div>
            <p className="quotes-muted" style={{ marginTop: -8, marginBottom: 16 }}>
              Total collected: {formatMoney(monthlyTotal)}
            </p>
          </>
        )}

        <div className="form-group">
          <label className="form-label">Stripe payment link (paste after creating in Stripe)</label>
          <input className="form-input" value={stripeLink} onChange={(e) => setStripeLink(e.target.value)} placeholder="https://buy.stripe.com/…" />
        </div>

        <div className="form-group">
          <label className="form-label">Status</label>
          <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="approved">Approved</option>
            <option value="declined">Declined</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Internal Notes</label>
          <textarea className="form-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Never shown to the client" />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function QuoteDetail({ quote, onBack, onEdit }) {
  const regular = quote.regular_total ?? calcRegularTotal(quote.line_items || []);
  const adjusted = Number(quote.adjusted_price) || 0;
  const showAdjusted = adjusted !== regular;

  return (
    <div className="page quotes-page">
      <button type="button" className="btn btn-ghost quotes-back" onClick={onBack}>← Back to quotes</button>

      <div className="quotes-detail-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: 6 }}>{quote.contact_name || 'Quote'}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 16, color: 'var(--text-secondary)' }}>{quote.project_name}</span>
            <StatusBadge status={quote.status} />
          </div>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => onEdit(quote)}>✏️ Edit</button>
      </div>

      <section className="quotes-section">
        <h3>Line Items</h3>
        <div className="quotes-table-wrap">
          <table className="stack-table quotes-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody>
              {(quote.line_items || []).map((item, i) => (
                <tr key={`${item.name}-${i}`}>
                  <td>{item.name}</td>
                  <td>
                    {item.included
                      ? <span className="status-badge" style={{ color: '#22c55e', background: 'rgba(34,197,94,0.12)', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700 }}>Included</span>
                      : formatMoney(item.price)}
                  </td>
                </tr>
              ))}
              <tr>
                <td style={{ fontWeight: 700 }}>Regular Total</td>
                <td style={{ fontWeight: 700 }}>{formatMoney(regular)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {showAdjusted && (
        <section className="quotes-section">
          <h3>Adjusted Price</h3>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--teal)' }}>{formatMoney(adjusted)}</div>
          {quote.adjustment_note && (
            <p className="quotes-muted" style={{ marginTop: 6 }}>{quote.adjustment_note}</p>
          )}
        </section>
      )}

      <section className="quotes-section">
        <h3>Payment Plan</h3>
        <p style={{ margin: 0, fontSize: 15 }}>{paymentSummary(quote)}</p>
      </section>

      {quote.stripe_payment_link && (
        <section className="quotes-section">
          <a
            className="btn btn-primary"
            href={quote.stripe_payment_link}
            target="_blank"
            rel="noreferrer"
          >
            Open Stripe Payment Link →
          </a>
        </section>
      )}

      {quote.notes && (
        <section className="quotes-section">
          <h3>Internal Notes</h3>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{quote.notes}</p>
        </section>
      )}
    </div>
  );
}

export default function ManualQuotes({ selectedId, onSelectId }) {
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    const q = query(collection(db, 'quotes'), orderBy('created_at', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setQuotes(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, (err) => {
      setError(err.message);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const selected = selectedId ? quotes.find((q) => q.id === selectedId) : null;

  const openCreate = () => { setEditing(null); setShowModal(true); };
  const openEdit = (quote) => { setEditing(quote); setShowModal(true); };

  const handleDelete = async (quote, e) => {
    e.stopPropagation();
    if (!window.confirm(`Delete quote for ${quote.contact_name || 'this contact'}?`)) return;
    try {
      await deleteDoc(doc(db, 'quotes', quote.id));
      if (selectedId === quote.id) onSelectId(null);
    } catch (err) {
      alert(err.message || 'Delete failed');
    }
  };

  if (selected) {
    return (
      <>
        <QuoteDetail
          quote={selected}
          onBack={() => onSelectId(null)}
          onEdit={openEdit}
        />
        {showModal && (
          <QuoteModal
            quote={editing}
            onClose={() => setShowModal(false)}
            onSaved={() => setShowModal(false)}
          />
        )}
      </>
    );
  }

  return (
    <div className="page quotes-page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="page-title">Quotes</h1>
        <button type="button" className="btn btn-primary" onClick={openCreate}>+ New Quote</button>
      </div>

      {error && <div className="quotes-error">{error}</div>}

      {loading && <div className="empty-state">Loading quotes…</div>}

      {!loading && quotes.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-text">No quotes yet. Click + New Quote to create one.</div>
        </div>
      )}

      {!loading && quotes.length > 0 && (
        <div className="quotes-table-wrap">
          <table className="stack-table quotes-table">
            <thead>
              <tr>
                <th>Contact Name</th>
                <th>Project Name</th>
                <th>Regular Price</th>
                <th>Adjusted Price</th>
                <th>Payment Plan</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((quote) => (
                <tr key={quote.id} className="quotes-row" onClick={() => onSelectId(quote.id)}>
                  <td style={{ fontWeight: 600 }}>{quote.contact_name || '—'}</td>
                  <td>{quote.project_name || '—'}</td>
                  <td>{formatMoney(quote.regular_total)}</td>
                  <td>{formatMoney(quote.adjusted_price)}</td>
                  <td>{paymentPlanLabel(quote)}</td>
                  <td><StatusBadge status={quote.status} /></td>
                  <td>{formatDate(quote.created_at)}</td>
                  <td>
                    <button type="button" className="btn btn-ghost btn-sm" title="Edit" onClick={(e) => { e.stopPropagation(); openEdit(quote); }}>✏️</button>
                    <button type="button" className="btn btn-ghost btn-sm" title="Delete" onClick={(e) => handleDelete(quote, e)}>🗑️</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <QuoteModal
          quote={editing}
          onClose={() => setShowModal(false)}
          onSaved={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
