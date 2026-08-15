import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { addDoc, collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { db } from '../firebase';

const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;

const FORM_TYPE_LABELS = {
  'instant-quote': 'Website',
  instant: 'Website',
  'app-quote': 'Mobile App',
  app: 'Mobile App',
  'webapp-quote': 'Custom Business App',
  'pwa-quote': 'Business Web App',
};

const DAL_SITE_QUOTE_REPLY = 'https://www.dreamapplab.com/api/quote-reply';

const STATUS_META = {
  submitted: { label: 'Submitted', color: '#94A3B8', bg: 'rgba(148,163,184,0.18)' },
  accepted: { label: 'Ready to Review', color: '#3B82F6', bg: 'rgba(59,130,246,0.18)' },
  thinking: { label: 'Thinking', color: '#F59E0B', bg: 'rgba(245,158,11,0.18)' },
  questions_sent: { label: 'Questions Sent', color: '#F97316', bg: 'rgba(249,115,22,0.18)' },
  client_replied: { label: 'Client Replied', color: '#A855F7', bg: 'rgba(168,85,247,0.2)', pulse: true },
  deposit_sent: { label: 'Deposit Sent', color: '#14B8A6', bg: 'rgba(20,184,166,0.18)' },
  in_build: { label: 'In Build', color: '#22C55E', bg: 'rgba(34,197,94,0.18)' },
  in_build_board: { label: 'On Build Board', color: '#22C55E', bg: 'rgba(34,197,94,0.28)' },
  balance_sent: { label: 'Balance Sent', color: '#7DD3FC', bg: 'rgba(125,211,252,0.2)' },
  complete: { label: 'Complete', color: '#166534', bg: 'rgba(22,101,52,0.4)' },
  no_action: { label: 'No Action', color: '#F87171', bg: 'rgba(248,113,113,0.14)' },
};

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'accepted', label: 'Ready to Review' },
  { value: 'thinking', label: 'Thinking' },
  { value: 'questions_sent', label: 'Questions Sent' },
  { value: 'client_replied', label: 'Client Replied' },
  { value: 'deposit_sent', label: 'Deposit Sent' },
  { value: 'in_build', label: 'In Build' },
  { value: 'in_build_board', label: 'On Build Board' },
  { value: 'balance_sent', label: 'Balance Sent' },
  { value: 'complete', label: 'Complete' },
  { value: 'no_action', label: 'No Action' },
];

const FORM_TYPE_FILTER_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'Website', label: 'Website' },
  { value: 'Mobile App', label: 'Mobile App' },
  { value: 'Custom Business App', label: 'Custom Business App' },
  { value: 'Business Web App', label: 'Business Web App' },
];

function toDate(value) {
  if (value == null || value === '') return null;
  if (typeof value.toDate === 'function') {
    try {
      return value.toDate();
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDateTime(value) {
  const d = toDate(value);
  if (!d) return '—';
  return format(d, 'MMM d, yyyy h:mm a');
}

function money(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function firstName(name) {
  const n = String(name || '').trim();
  if (!n) return 'there';
  return n.split(/\s+/)[0];
}

function formTypeLabel(formType) {
  const key = String(formType || '').toLowerCase();
  return FORM_TYPE_LABELS[key] || 'Website';
}

function rawStatus(quote) {
  const status = String(quote.status || 'submitted');
  if (status === 'welcome_sent') return 'deposit_sent';
  return status;
}

function displayStatus(quote) {
  const status = rawStatus(quote);
  if (status === 'submitted') {
    const created = toDate(quote.createdAt);
    if (created && Date.now() - created.getTime() > FORTY_EIGHT_HOURS) {
      return 'no_action';
    }
  }
  return status;
}

function businessName(quote) {
  return quote.business || quote.biz || '';
}

function normalizeItems(d) {
  if (Array.isArray(d.items) && d.items.length) {
    return d.items.map((it) => ({
      name: it.name || it.label || '',
      description: it.description || it.desc || '',
    }));
  }
  if (Array.isArray(d.selections) && d.selections.length) {
    return d.selections.map((it) => ({
      name: it.label || it.name || '',
      description: it.description || it.desc || '',
    }));
  }
  return [];
}

function designLines(d) {
  const lines = [];
  if (Array.isArray(d.design)) {
    d.design.forEach((x) => {
      if (typeof x === 'string' && x.trim()) lines.push(x.trim());
      else if (x && (x.label || x.name)) lines.push(x.label || x.name);
    });
  } else if (d.design && typeof d.design === 'object') {
    Object.keys(d.design).forEach((k) => lines.push(k + ': ' + d.design[k]));
  } else if (typeof d.design === 'string' && d.design.trim()) {
    lines.push(d.design.trim());
  }
  [
    ['Brand status', d.brand_status || d.brandStatus],
    ['Colors', d.colors],
    ['Inspirations', d.inspirations || d.designInspirations],
  ].forEach(([label, val]) => {
    if (val == null || val === '') return;
    const text = Array.isArray(val) ? val.join(', ') : String(val);
    if (text) lines.push(label + ': ' + text);
  });
  return lines;
}

function managementInfo(d) {
  const choice = String(d.managementChoice || '').toLowerCase();
  const tier = d.managedTier || d.plan || '';
  const monthly = d.monthlyFee;
  const transfer = d.transferFee;

  if (choice === 'managed' || choice === 'dal' || choice === 'dal-managed' || choice === 'dal_managed') {
    return {
      label: 'DAL Managed' + (tier ? ' — ' + tier : ''),
      monthly,
      transfer: null,
    };
  }
  if (
    choice === 'handover' ||
    choice === 'full-handover' ||
    choice === 'full_handover' ||
    choice === 'self' ||
    choice === 'wix' ||
    choice === 'self-managed'
  ) {
    return { label: 'Full Handover', monthly: null, transfer };
  }
  if (d.path === 'dal' || (d.plan && !choice)) {
    return {
      label: 'DAL Managed' + (d.plan ? ' — ' + d.plan : ''),
      monthly,
      transfer: null,
    };
  }
  if (d.path === 'wix' || d.path === 'self') {
    return { label: 'Full Handover', monthly: null, transfer };
  }
  if (choice || tier) {
    return {
      label: [d.managementChoice, tier].filter(Boolean).join(' — ') || '—',
      monthly,
      transfer,
    };
  }
  return { label: '—', monthly, transfer };
}

function quotePricing(q) {
  const clientDiscount = Number(q.discountAmount || 0);
  const original =
    q.originalTotal != null
      ? Number(q.originalTotal)
      : Number(q.total || 0) + clientDiscount;
  const afterClient =
    q.originalTotal != null ? Number(q.total || 0) : Math.max(0, original - clientDiscount);
  const dalDiscount = Number(q.dalDiscount || 0);
  const finalTotal = Math.max(0, afterClient - dalDiscount);
  const deposit = Math.round(finalTotal * 0.2);
  const balance = finalTotal - deposit;
  return { original, clientDiscount, afterClient, dalDiscount, finalTotal, deposit, balance };
}

function omitUndefined(obj) {
  const out = {};
  Object.keys(obj || {}).forEach((key) => {
    if (key === 'id') return;
    const val = obj[key];
    if (val !== undefined) out[key] = val;
  });
  return out;
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function dateKey(value) {
  const d = toDate(value);
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isUnread(quote) {
  return quote.readAt == null || quote.readAt === '';
}

function QuoteStatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.submitted;
  return (
    <span className="quotes-status-text" style={{ color: meta.color }}>
      {meta.label}
    </span>
  );
}

function InfoRow({ label, children }) {
  return (
    <div className="quotes-info-row">
      <div className="quotes-info-label">{label}</div>
      <div className="quotes-info-value">{children || '—'}</div>
    </div>
  );
}

function MessageBubble({ message, clientLabel }) {
  const outbound = String(message.direction || '').toLowerCase() === 'outbound';
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: outbound ? 'flex-end' : 'flex-start',
        marginBottom: 10,
      }}
    >
      <div
        style={{
          maxWidth: '78%',
          padding: '10px 12px',
          borderRadius: 10,
          background: outbound ? 'rgba(76,193,243,0.12)' : '#1A2234',
          border: outbound
            ? '1px solid rgba(76,193,243,0.45)'
            : '1px solid rgba(255,255,255,0.12)',
          textAlign: outbound ? 'right' : 'left',
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: outbound ? '#4cc1f3' : '#94A3B8',
            marginBottom: 4,
          }}
        >
          {outbound ? 'Dream App Lab' : clientLabel}
        </div>
        <div
          style={{
            fontSize: 14,
            color: '#E2E8F0',
            whiteSpace: 'pre-wrap',
            lineHeight: 1.5,
          }}
        >
          {message.text || ''}
        </div>
        <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 6 }}>
          {formatDateTime(message.sentAt)}
        </div>
      </div>
    </div>
  );
}

function QuoteDetail({ quote, onBack, onQuotePatched, onQuoteMoved }) {
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountMode, setDiscountMode] = useState('dollar');
  const [discountValue, setDiscountValue] = useState('');
  const [discountNote, setDiscountNote] = useState(quote.dalDiscountNote || '');
  const [actionError, setActionError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [questionsText, setQuestionsText] = useState(quote.questionsText || quote.clientQuestions || '');
  const [startDate, setStartDate] = useState(dateKey(quote.estimatedStart));
  const [completionDate, setCompletionDate] = useState(dateKey(quote.estimatedCompletion));
  const [confirmDeposit, setConfirmDeposit] = useState(false);
  const [confirmMoveBoard, setConfirmMoveBoard] = useState(false);
  const [localDone, setLocalDone] = useState({
    deposit: false,
    balance: false,
    inBuild: false,
    complete: false,
    movedToBoard: false,
    resend: false,
  });
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(true);

  const status = rawStatus(quote);
  const shownStatus = displayStatus(quote);
  const pricing = quotePricing(quote);
  const items = normalizeItems(quote);
  const design = designLines(quote);
  const mgmt = managementInfo(quote);
  const biz = businessName(quote) || quote.name || 'Project';

  useEffect(() => {
    if (!isUnread(quote)) return undefined;
    const readAt = new Date().toISOString();
    if (onQuotePatched) onQuotePatched(quote.id, { readAt });
    fetch('/api/quotes?id=' + encodeURIComponent(quote.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ readAt }),
    }).catch((err) => console.error('Failed to mark quote read', err));
    return undefined;
  }, [quote.id]);

  useEffect(() => {
    let cancelled = false;
    async function loadMessages() {
      setMessagesLoading(true);
      try {
        const res = await fetch('/api/quotes/messages?id=' + encodeURIComponent(quote.id));
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          throw new Error(data.error || data.detail || 'Failed to load messages');
        }
        setMessages(Array.isArray(data.messages) ? data.messages : []);
      } catch (err) {
        console.error(err);
        if (!cancelled) setMessages([]);
      } finally {
        if (!cancelled) setMessagesLoading(false);
      }
    }
    loadMessages();
    return () => {
      cancelled = true;
    };
  }, [quote.id]);

  const timeline = [
    { label: 'Submitted', at: quote.createdAt || quote.submittedAt },
    { label: 'Ready to Review', at: quote.acceptedAt },
    { label: 'Questions sent', at: quote.questionsSentAt },
    { label: 'Client replied', at: quote.clientRepliedAt },
  ].filter((step) => toDate(step.at));

  async function patchQuote(fields) {
    const res = await fetch('/api/quotes?id=' + encodeURIComponent(quote.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || data.detail || 'Failed to update quote');
    }
    if (onQuotePatched) onQuotePatched(quote.id, data.quote || { ...quote, ...fields });
  }

  async function postRevenue({ amount, type, description }) {
    await setDoc(
      doc(db, 'revenue', 'dal-website'),
      { appId: 'dal-website' },
      { merge: true }
    );
    await addDoc(collection(db, 'revenue', 'dal-website', 'manualSales'), {
      appId: 'dal-website',
      amount,
      type,
      description,
      note: description,
      date: todayISO(),
      quoteId: quote.id,
      createdAt: new Date().toISOString(),
    });
  }

  async function sendPaymentLink(kind) {
    const amount = kind === 'deposit' ? pricing.deposit : pricing.balance;
    const res = await fetch('/api/quote-payment-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind,
        email: quote.email,
        firstName: firstName(quote.name),
        amount,
        businessName: biz,
        quoteId: quote.id,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || data.detail || 'Failed to send payment link');
    }
    return data.url;
  }

  async function runAction(name, fn) {
    setActionError('');
    setBusyAction(name);
    try {
      await fn();
    } catch (err) {
      console.error(err);
      setActionError(err.message || String(err));
    } finally {
      setBusyAction('');
    }
  }

  const handleApplyDiscount = () =>
    runAction('discount', async () => {
      const raw = Number(discountValue);
      if (!Number.isFinite(raw) || raw <= 0) {
        throw new Error('Enter a discount amount or percentage greater than 0.');
      }
      if (!String(discountNote || '').trim()) {
        throw new Error('Reason / note is required when applying a discount.');
      }
      const dalDiscount =
        discountMode === 'percent'
          ? Math.round(pricing.afterClient * (raw / 100))
          : Math.round(raw);
      await patchQuote({
        dalDiscount,
        dalDiscountNote: String(discountNote).trim(),
        dalDiscountAppliedAt: new Date().toISOString(),
      });
      setDiscountOpen(false);
    });

  const handleSendBalance = () =>
    runAction('balance', async () => {
      const url = await sendPaymentLink('balance');
      await patchQuote({
        status: 'balance_sent',
        balanceSentAt: new Date().toISOString(),
        stripeBalanceUrl: url,
      });
      setLocalDone((s) => ({ ...s, balance: true }));
    });

  const handleMarkComplete = () =>
    runAction('complete', async () => {
      await patchQuote({
        status: 'complete',
        completedAt: new Date().toISOString(),
      });
      await postRevenue({
        amount: pricing.balance,
        type: 'balance',
        description: `Project balance — ${biz}`,
      });
      setLocalDone((s) => ({ ...s, complete: true }));
    });

  const handleSendQuestions = () =>
    runAction('questions', async () => {
      if (!String(questionsText || '').trim()) {
        throw new Error('Enter at least one question.');
      }
      const res = await fetch(DAL_SITE_QUOTE_REPLY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: quote.id,
          questions: questionsText,
          startDate,
          completionDate,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || data.detail || 'Failed to send questions');
      }
      const sentAt = new Date().toISOString();
      if (onQuotePatched) {
        onQuotePatched(quote.id, {
          status: 'questions_sent',
          questionsText,
          estimatedStart: startDate,
          estimatedCompletion: completionDate,
          questionsSentAt: sentAt,
        });
      }
      setMessages((prev) => [
        ...prev,
        {
          id: 'local-' + sentAt,
          direction: 'outbound',
          text: String(questionsText || '').trim(),
          sentAt,
          from: 'lab@dreamapplab.com',
        },
      ]);
      setQuestionsOpen(false);
      setConfirmDeposit(false);
      setActionNotice('Questions sent — waiting for client reply.');
    });

  const handleSendDeposit = () =>
    runAction('deposit', async () => {
      const url = await sendPaymentLink('deposit');
      await patchQuote({
        status: 'deposit_sent',
        depositSentAt: new Date().toISOString(),
        stripeDepositUrl: url,
      });
      setConfirmDeposit(false);
      setLocalDone((s) => ({ ...s, deposit: true }));
    });

  const handleMoveToBuildBoard = () =>
    runAction('move_board', async () => {
      const now = new Date().toISOString();
      const buildRef = doc(db, 'builds', 'quote-' + quote.id);
      const named = await getDocs(query(collection(db, 'builds'), where('quoteId', '==', quote.id)));
      if (named.empty) {
        await setDoc(buildRef, {
          ...omitUndefined(quote),
          quoteId: quote.id,
          clientName: quote.name || '',
          email: quote.email || '',
          businessName: biz,
          formType: quote.formType || '',
          total: pricing.finalTotal,
          deposit: pricing.deposit,
          balance: pricing.balance,
          managementChoice: quote.managementChoice || '',
          managedTier: quote.managedTier || quote.plan || '',
          monthlyFee: quote.monthlyFee != null ? Number(quote.monthlyFee) : null,
          status: 'in_progress',
          source: 'quote',
          depositPostedToRevenue: false,
          balancePostedToRevenue: false,
          projectNotes: '',
          createdAt: now,
          movedToBuildAt: now,
        });
      }
      await patchQuote({
        status: 'in_build',
        movedToBuildAt: now,
      });
      setConfirmMoveBoard(false);
      setLocalDone((s) => ({ ...s, movedToBoard: true }));
      setActionNotice('Moved to Build Board');
      if (onQuoteMoved) onQuoteMoved(quote.id);
    });

  const handleResendEstimate = () =>
    runAction('resend', async () => {
      const res = await fetch('/api/quotes/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: quote.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || data.detail || 'Failed to resend estimate');
      }
      setLocalDone((s) => ({ ...s, resend: true }));
      setActionNotice('Estimate email resent.');
    });

  const showQuestions =
    shownStatus !== 'no_action' &&
    (status === 'submitted' || status === 'accepted' || status === 'questions_sent' || status === 'client_replied');
  const showDeposit =
    shownStatus !== 'no_action' &&
    (status === 'submitted' || status === 'accepted' || status === 'client_replied');
  const showBalance = status === 'in_build' || status === 'in_build_board' || status === 'in_progress';
  const showMoveToBoard = status === 'deposit_sent';
  const showComplete = status === 'balance_sent';
  const showNoAction = shownStatus === 'no_action';
  const depositDone = localDone.deposit || status === 'deposit_sent' || !!quote.stripeDepositUrl;
  const balanceDone = localDone.balance || status === 'balance_sent' || !!quote.stripeBalanceUrl;
  const completeDone = localDone.complete || status === 'complete' || !!quote.completedAt;
  const movedToBoard = localDone.movedToBoard || status === 'in_build_board' || status === 'in_build';
  const questionsLabel =
    status === 'questions_sent' || status === 'client_replied' ? 'Ask More Questions' : 'Ask Questions';

  return (
    <div className="quotes-detail">
      <button
        type="button"
        className="btn btn-ghost quotes-back"
        onClick={(e) => {
          e.preventDefault();
          if (typeof onBack === 'function') onBack();
        }}
      >
        ← Back to quotes
      </button>

      <div className="quotes-detail-header">
        <div>
          <h1 className="page-title">{quote.name || 'Untitled client'}</h1>
          <p className="page-subtitle">{biz} · {formTypeLabel(quote.formType)}</p>
        </div>
        <QuoteStatusBadge status={shownStatus} />
      </div>

      <section className="quotes-section">
        <h2>Client Info</h2>
        <div className="quotes-info-grid">
          <InfoRow label="Name">{quote.name}</InfoRow>
          <InfoRow label="Email">{quote.email}</InfoRow>
          <InfoRow label="Phone">{quote.phone || quote.phoneNumber}</InfoRow>
          <InfoRow label="Business">{businessName(quote) || '—'}</InfoRow>
          <InfoRow label="Form type">{formTypeLabel(quote.formType)}</InfoRow>
          <InfoRow label="Submitted">{formatDateTime(quote.createdAt)}</InfoRow>
        </div>
        {timeline.length > 0 && (
          <div className="quotes-timeline">
            {timeline.map((step, i) => (
              <span key={step.label}>
                {i > 0 ? ' | ' : ''}
                {step.label} at {formatDateTime(step.at)}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="quotes-section">
        <h2>Messages</h2>
        {messagesLoading ? (
          <p className="quotes-muted">Loading messages…</p>
        ) : messages.length === 0 ? (
          <p className="quotes-muted">
            No messages yet — use Ask Questions to start the conversation.
          </p>
        ) : (
          <div>
            {messages.map((message, i) => (
              <MessageBubble
                key={message.id || message.sentAt || i}
                message={message}
                clientLabel={String(quote.name || '').trim().split(/\s+/)[0] || 'Client'}
              />
            ))}
          </div>
        )}
      </section>

      <section className="quotes-section">
        <h2>Project Summary</h2>
        {items.length ? (
          <ul className="quotes-feature-list">
            {items.map((it, i) => (
              <li key={i}>
                <div className="quotes-feature-name">{it.name || 'Feature'}</div>
                {it.description ? (
                  <div className="quotes-feature-desc">{it.description}</div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="quotes-muted">No features recorded.</p>
        )}
        {design.length > 0 && (
          <div className="quotes-subblock">
            <h3>Design direction</h3>
            {design.map((line, i) => (
              <div key={i} className="quotes-muted">{line}</div>
            ))}
          </div>
        )}
        {quote.notes ? (
          <div className="quotes-subblock">
            <h3>Notes</h3>
            <p className="quotes-muted">{quote.notes}</p>
          </div>
        ) : null}
      </section>

      <section className="quotes-section">
        <h2>Pricing</h2>
        <div className="quotes-price-rows">
          <div className="quotes-price-row">
            <span>Original total</span>
            <span>{money(pricing.original)}</span>
          </div>
          {quote.discountCode && pricing.clientDiscount > 0 && (
            <div className="quotes-price-row quotes-discount">
              <span>
                Client discount — Code: {quote.discountCode}
                {quote.discountPercent != null ? ` — ${quote.discountPercent}% off` : ''}
              </span>
              <span>-{money(pricing.clientDiscount)}</span>
            </div>
          )}
          {pricing.dalDiscount > 0 && (
            <div className="quotes-price-row quotes-discount">
              <span>
                DAL-applied discount
                {quote.dalDiscountNote ? ` — ${quote.dalDiscountNote}` : ''}
              </span>
              <span>-{money(pricing.dalDiscount)}</span>
            </div>
          )}
          <div className="quotes-price-row quotes-price-final">
            <span>Final total</span>
            <span>{money(pricing.finalTotal)}</span>
          </div>
          <div className="quotes-price-row">
            <span>20% deposit</span>
            <span>{money(pricing.deposit)}</span>
          </div>
          <div className="quotes-price-row">
            <span>80% balance</span>
            <span>{money(pricing.balance)}</span>
          </div>
        </div>
      </section>

      <section className="quotes-section">
        <button
          type="button"
          className="quotes-collapse-toggle"
          onClick={() => setDiscountOpen((v) => !v)}
        >
          {discountOpen ? '▾' : '▸'} DAL-Applied Discount
        </button>
        {discountOpen && (
          <div className="quotes-discount-form">
            <div className="quotes-mode-toggle">
              <button
                type="button"
                className={`btn btn-sm ${discountMode === 'dollar' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setDiscountMode('dollar')}
              >
                Dollar amount
              </button>
              <button
                type="button"
                className={`btn btn-sm ${discountMode === 'percent' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setDiscountMode('percent')}
              >
                Percentage
              </button>
            </div>
            <div className="form-group">
              <label className="form-label">
                {discountMode === 'percent' ? 'Percent off' : 'Dollar amount'}
              </label>
              <input
                className="form-input"
                type="number"
                min="0"
                step={discountMode === 'percent' ? '1' : '1'}
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                placeholder={discountMode === 'percent' ? 'e.g. 10' : 'e.g. 250'}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Reason / note (required)</label>
              <input
                className="form-input"
                type="text"
                value={discountNote}
                onChange={(e) => setDiscountNote(e.target.value)}
                placeholder='e.g. "Referral from BNI", "Returning client"'
              />
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!!busyAction}
              onClick={handleApplyDiscount}
            >
              {busyAction === 'discount' ? 'Applying…' : 'Apply Discount'}
            </button>
          </div>
        )}
      </section>

      <section className="quotes-section">
        <h2>Management Selection</h2>
        <div className="quotes-info-grid">
          <InfoRow label="Choice">{mgmt.label}</InfoRow>
          <InfoRow label="Transfer fee">
            {mgmt.transfer != null && mgmt.transfer !== '' ? money(mgmt.transfer) : '—'}
          </InfoRow>
          <InfoRow label="Monthly fee">
            {mgmt.monthly != null && mgmt.monthly !== '' ? money(mgmt.monthly) + '/mo' : '—'}
          </InfoRow>
        </div>
      </section>

      <section className="quotes-section quotes-actions">
        <h2>Actions</h2>
        {actionNotice && <div className="quotes-success-notice">{actionNotice}</div>}

        {showNoAction && (
          <div className="quotes-wait-notice">Client has not responded to their estimate.</div>
        )}
        {status === 'questions_sent' && (
          <div className="quotes-wait-notice">
            Waiting for client reply — check lab@dreamapplab.com for their response.
          </div>
        )}
        {status === 'client_replied' && (
          <div className="quotes-reply-notice">
            Client has replied — check lab@dreamapplab.com for their response.
          </div>
        )}
        {status === 'client_replied' && quote.clientReplyText && (
          <div className="quotes-reply-preview">{quote.clientReplyText}</div>
        )}
        {status === 'deposit_sent' && (
          <div className="quotes-wait-notice">Deposit link sent — waiting for payment.</div>
        )}
        {status === 'in_build_board' || status === 'in_build' ? (
          <div className="quotes-wait-notice">This project is on the Build Board.</div>
        ) : null}
        {status === 'balance_sent' && (
          <div className="quotes-wait-notice">Balance link sent — waiting for final payment.</div>
        )}
        {status === 'complete' && (
          <div className="quotes-wait-notice">
            Project complete.{quote.completedAt ? ` Completed ${formatDateTime(quote.completedAt)}.` : ''}
          </div>
        )}
        {status === 'thinking' && shownStatus !== 'no_action' && (
          <div className="quotes-wait-notice">Client is still thinking about their estimate.</div>
        )}

        {showQuestions && questionsOpen && (
          <div className="quotes-questions-form">
            <div className="form-group">
              <label className="form-label">Questions for the client</label>
              <textarea
                className="form-input"
                style={{ minHeight: 120, resize: 'vertical' }}
                value={questionsText}
                onChange={(e) => setQuestionsText(e.target.value)}
                placeholder="One question per line"
              />
            </div>
            <div className="quotes-info-grid" style={{ marginBottom: 12 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Estimated start</label>
                <input
                  className="form-input"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Estimated completion</label>
                <input
                  className="form-input"
                  type="date"
                  value={completionDate}
                  onChange={(e) => setCompletionDate(e.target.value)}
                />
              </div>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!!busyAction}
              onClick={handleSendQuestions}
            >
              {busyAction === 'questions' ? 'Sending…' : 'Send Questions'}
            </button>
          </div>
        )}

        {showDeposit && confirmDeposit && !depositDone && (
          <div className="quotes-confirm-box">
            <p>
              Send deposit link of <strong>{money(pricing.deposit)}</strong> to <strong>{quote.email}</strong>?
            </p>
            <div className="quotes-action-row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!!busyAction}
                onClick={handleSendDeposit}
              >
                {busyAction === 'deposit' ? 'Sending…' : 'Confirm'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!!busyAction}
                onClick={() => setConfirmDeposit(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {showMoveToBoard && confirmMoveBoard && !movedToBoard && (
          <div className="quotes-confirm-box">
            <p>Move this project to the Build Board?</p>
            <div className="quotes-action-row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!!busyAction}
                onClick={handleMoveToBuildBoard}
              >
                {busyAction === 'move_board' ? 'Moving…' : 'Confirm'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!!busyAction}
                onClick={() => setConfirmMoveBoard(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="quotes-action-row">
          {showQuestions && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!!busyAction}
              onClick={() => {
                setConfirmDeposit(false);
                setQuestionsOpen((v) => !v);
              }}
            >
              {questionsOpen ? 'Cancel questions' : questionsLabel}
            </button>
          )}
          {showDeposit && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!!busyAction || depositDone}
              onClick={() => {
                if (depositDone) return;
                setQuestionsOpen(false);
                setConfirmDeposit(true);
              }}
            >
              {depositDone
                ? 'Deposit Link Sent ✓'
                : busyAction === 'deposit'
                  ? 'Sending…'
                  : 'Send Deposit Link'}
            </button>
          )}
          {showBalance && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!!busyAction || balanceDone}
              onClick={handleSendBalance}
            >
              {balanceDone
                ? 'Balance Link Sent ✓'
                : busyAction === 'balance'
                  ? 'Sending…'
                  : 'Send Balance Link'}
            </button>
          )}
          {showMoveToBoard && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!!busyAction || movedToBoard}
              onClick={() => {
                if (movedToBoard) return;
                setConfirmMoveBoard(true);
              }}
            >
              {movedToBoard
                ? 'Moved to Build Board ✓'
                : busyAction === 'move_board'
                  ? 'Moving…'
                  : 'Move to Build Board'}
            </button>
          )}
          {showComplete && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!!busyAction || completeDone}
              onClick={handleMarkComplete}
            >
              {completeDone
                ? 'Marked Complete ✓'
                : busyAction === 'complete'
                  ? 'Saving…'
                  : 'Mark Complete'}
            </button>
          )}
          {showNoAction && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!!busyAction || localDone.resend}
              onClick={handleResendEstimate}
            >
              {localDone.resend
                ? 'Estimate resent ✓'
                : busyAction === 'resend'
                  ? 'Sending…'
                  : 'Resend estimate email'}
            </button>
          )}
        </div>
        {actionError && <div className="quotes-error">{actionError}</div>}
      </section>
    </div>
  );
}

const EMPTY_FILTERS = {
  from: '',
  to: '',
  status: '',
  formType: '',
  search: '',
};

export default function QuotesTab() {
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [listNotice, setListNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadQuotes() {
      setLoading(true);
      try {
        const res = await fetch('/api/quotes');
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          throw new Error(data.error || data.detail || 'Failed to load quotes');
        }
        if (cancelled) return;
        setQuotes(Array.isArray(data.quotes) ? data.quotes : []);
        setError('');
      } catch (err) {
        console.error(err);
        if (cancelled) return;
        setError(
          err.message ||
            'Could not load quotes. Add DAL_SITE_FIREBASE_* env vars in Vercel for dal-tracker.'
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadQuotes();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return quotes.filter((quote) => {
      const status = displayStatus(quote);
      if (filters.status && status !== filters.status) return false;
      if (filters.formType && formTypeLabel(quote.formType) !== filters.formType) return false;
      const createdKey = dateKey(quote.createdAt);
      if (filters.from && createdKey && createdKey < filters.from) return false;
      if (filters.to && createdKey && createdKey > filters.to) return false;
      if (q) {
        const hay = [quote.name, businessName(quote), quote.email]
          .map((v) => String(v || '').toLowerCase())
          .join(' ');
        if (!hay.includes(q)) return false;
      }
      const hiddenUnlessFiltered = ['in_build', 'in_build_board', 'deposit_paid'].includes(rawStatus(quote));
      if (hiddenUnlessFiltered && filters.status !== rawStatus(quote)) {
        return false;
      }
      return true;
    });
  }, [quotes, filters]);

  const selected = selectedId ? quotes.find((q) => q.id === selectedId) : null;

  const openQuote = (quote) => {
    if (isUnread(quote)) {
      const readAt = new Date().toISOString();
      setQuotes((prev) => prev.map((q) => (q.id === quote.id ? { ...q, readAt } : q)));
      fetch('/api/quotes?id=' + encodeURIComponent(quote.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ readAt }),
      }).catch((err) => console.error('Failed to mark quote read', err));
    }
    setSelectedId(quote.id);
  };

  const handleDeleteQuote = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setError('');
    try {
      const res = await fetch('/api/quotes?id=' + encodeURIComponent(pendingDelete.id), {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || data.detail || 'Failed to delete quote');
      }
      setQuotes((prev) => prev.filter((q) => q.id !== pendingDelete.id));
      if (selectedId === pendingDelete.id) setSelectedId(null);
      setPendingDelete(null);
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
    } finally {
      setDeleting(false);
    }
  };

  if (selected) {
    return (
      <div className="page quotes-page">
        <QuoteDetail
          quote={selected}
          onBack={() => setSelectedId(null)}
          onQuotePatched={(id, updated) => {
            setQuotes((prev) => prev.map((q) => (q.id === id ? { ...q, ...updated, id } : q)));
          }}
          onQuoteMoved={(id) => {
            setQuotes((prev) => prev.filter((q) => q.id !== id));
            setSelectedId(null);
            setListNotice('Moved to Build Board');
          }}
        />
      </div>
    );
  }

  return (
    <div className="page quotes-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Quotes</h1>
          <p className="page-subtitle">Quote pipeline from dreamapplab.com</p>
        </div>
      </div>

      <div className="quotes-filters">
        <div className="form-group">
          <label className="form-label">From</label>
          <input
            className="form-input"
            type="date"
            value={filters.from}
            onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
          />
        </div>
        <div className="form-group">
          <label className="form-label">To</label>
          <input
            className="form-input"
            type="date"
            value={filters.to}
            onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Status</label>
          <select
            className="form-select"
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
          >
            {STATUS_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value || 'all'} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Form type</label>
          <select
            className="form-select"
            value={filters.formType}
            onChange={(e) => setFilters((f) => ({ ...f, formType: e.target.value }))}
          >
            {FORM_TYPE_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value || 'all'} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="form-group quotes-search">
          <label className="form-label">Search</label>
          <input
            className="form-input"
            type="text"
            placeholder="Client, business, or email"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          />
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setFilters(EMPTY_FILTERS)}
        >
          Clear filters
        </button>
      </div>

      {error && <div className="quotes-error">{error}</div>}
      {listNotice && <div className="quotes-success-notice">{listNotice}</div>}

      {loading ? (
        <div className="empty-state">Loading quotes…</div>
      ) : (
        <div className="quotes-table-wrap">
          <table className="stack-table quotes-table">
            <thead>
              <tr>
                <th className="quotes-unread-col" aria-label="Unread" />
                <th>Date</th>
                <th>Client</th>
                <th>Business</th>
                <th>Type</th>
                <th>Total</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="quotes-muted" style={{ textAlign: 'center', padding: 28 }}>
                    No quotes match the current filters.
                  </td>
                </tr>
              ) : (
                filtered.map((quote) => {
                  const pricing = quotePricing(quote);
                  const unread = isUnread(quote);
                  return (
                    <tr
                      key={quote.id}
                      className={`quotes-row${unread ? ' quotes-row-unread' : ''}`}
                      onClick={() => openQuote(quote)}
                    >
                      <td className="quotes-unread-col">
                        {unread ? <span className="quotes-unread-dot" aria-label="Unread" /> : null}
                      </td>
                      <td>{formatDateTime(quote.createdAt)}</td>
                      <td>{quote.name || '—'}</td>
                      <td>{businessName(quote) || '—'}</td>
                      <td>{formTypeLabel(quote.formType)}</td>
                      <td>{money(pricing.finalTotal)}</td>
                      <td>
                        <QuoteStatusBadge status={displayStatus(quote)} />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="icon-btn danger"
                          title="Delete quote"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingDelete(quote);
                          }}
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {pendingDelete && (
        <div className="modal-overlay" onClick={() => !deleting && setPendingDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Delete quote</div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={deleting}
                onClick={() => setPendingDelete(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p style={{ lineHeight: 1.5 }}>
                Delete this quote from <strong>{pendingDelete.name || 'this client'}</strong>? This cannot be undone.
              </p>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={deleting}
                onClick={() => setPendingDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={deleting}
                onClick={handleDeleteQuote}
              >
                {deleting ? 'Deleting…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
