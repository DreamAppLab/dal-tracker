// src/tabs/PostcardsTab.js
import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';

const COST_PER_CARD = 0.905;

// ── helpers ────────────────────────────────────────────────────────────────

function todayBatchId() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') {
    try { return value.toDate(); } catch { return null; }
  }
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(value) {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(value) {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatMoney(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPct(n) {
  return (Number(n || 0) * 100).toFixed(1) + '%';
}

// ── sub-components ──────────────────────────────────────────────────────────

function StatCard({ label, value, accent, sub }) {
  return (
    <div className="stat-card" style={{ borderTop: `2px solid ${accent}` }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color: accent }}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function DrawerOverlay({ card, onClose }) {
  if (!card) return null;

  const fields = [
    { label: 'Business Name', value: card.businessName },
    { label: 'County', value: card.county },
    { label: 'City', value: card.city },
    { label: 'Industry Keyword', value: card.industryKeyword },
    { label: 'Batch ID', value: card.batchId },
    { label: 'Mailed At', value: formatDateTime(card.mailedAt) },
    { label: 'Scanned', value: card.firstScanAt ? 'Yes — ' + formatDateTime(card.firstScanAt) : 'No' },
    { label: 'Quotes', value: (card.quoteIds && card.quoteIds.length > 0) ? 'Yes (' + card.quoteIds.length + ')' : 'No' },
    { label: 'Quote IDs', value: (card.quoteIds && card.quoteIds.length > 0) ? card.quoteIds.join(', ') : '—' },
    { label: 'LOB Postcard ID', value: card.lobPostcardId || '—' },
    { label: 'File Date', value: card.fileDate || '—' },
    { label: 'Is Test', value: card.isTest ? 'Yes' : 'No' },
    { label: 'Firestore ID', value: card.id },
  ];

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      style={{ justifyContent: 'flex-end', alignItems: 'stretch', padding: 0 }}
    >
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 420,
          width: '100%',
          maxHeight: '100vh',
          borderRadius: '12px 0 0 12px',
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div className="modal-header">
          <div className="modal-title" style={{ fontSize: 16 }}>
            {card.businessName || 'Postcard Detail'}
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ flex: 1, overflowY: 'auto' }}>
          {fields.map(({ label, value }) => (
            <div key={label} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 3 }}>
                {label}
              </div>
              <div style={{ fontSize: 14, color: 'var(--text-primary)', fontFamily: label === 'LOB Postcard ID' || label === 'Firestore ID' ? 'var(--font-mono)' : 'var(--font-body)', wordBreak: 'break-all' }}>
                {value || '—'}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── exported badge count helper ─────────────────────────────────────────────

export function PostcardsCountListener({ onCount }) {
  useEffect(() => {
    if (!onCount) return;
    const today = todayBatchId();
    const q = query(
      collection(db, 'postcard_mailings'),
      where('batchId', '==', today),
      where('isTest', '==', false)
    );
    const unsub = onSnapshot(q, (snap) => onCount(snap.size), () => onCount(0));
    return () => unsub();
  }, [onCount]);
  return null;
}

// ── main tab ────────────────────────────────────────────────────────────────

export default function PostcardsTab() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedBatch, setSelectedBatch] = useState(null); // batchId string or null
  const [drawerCard, setDrawerCard] = useState(null);

  // Real-time listener — production cards only
  useEffect(() => {
    const q = query(
      collection(db, 'postcard_mailings'),
      where('isTest', '==', false)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setCards(docs);
        setLoading(false);
        setError('');
      },
      (err) => {
        console.error('[PostcardsTab] Firestore error:', err);
        setError(err.message || 'Failed to load postcard data.');
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  // ── computed summary stats ───────────────────────────────────────────────
  const totalMailed = cards.length;
  const totalSpend = totalMailed * COST_PER_CARD;
  const scannedCount = cards.filter((c) => c.firstScanAt != null).length;
  const quoteCount = cards.filter((c) => Array.isArray(c.quoteIds) && c.quoteIds.length > 0).length;
  const scanRate = totalMailed > 0 ? scannedCount / totalMailed : 0;
  const quoteRate = totalMailed > 0 ? quoteCount / totalMailed : 0;

  // ── batch history ────────────────────────────────────────────────────────
  const batches = useMemo(() => {
    const map = {};
    cards.forEach((c) => {
      const bid = c.batchId || 'unknown';
      if (!map[bid]) map[bid] = { batchId: bid, cards: [] };
      map[bid].cards.push(c);
    });
    return Object.values(map).sort((a, b) => b.batchId.localeCompare(a.batchId));
  }, [cards]);

  // ── filtered card list ───────────────────────────────────────────────────
  const filteredCards = useMemo(() => {
    const list = selectedBatch
      ? cards.filter((c) => c.batchId === selectedBatch)
      : cards;
    return [...list].sort((a, b) => {
      const ta = toDate(a.mailedAt)?.getTime() ?? 0;
      const tb = toDate(b.mailedAt)?.getTime() ?? 0;
      return tb - ta;
    });
  }, [cards, selectedBatch]);

  // ── render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="data-section">
        <div className="empty-state">Loading postcard data…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="data-section">
        <div className="quotes-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="data-section">

      {/* SECTION 1 — Summary Cards */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 12 }}>
          Overview
        </div>
        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 0 }}>
          <StatCard
            label="Total Mailed"
            value={totalMailed.toLocaleString()}
            accent="var(--teal)"
            sub="production cards"
          />
          <StatCard
            label="Total Spend"
            value={formatMoney(totalSpend)}
            accent="var(--coral)"
            sub={`@ $${COST_PER_CARD}/card`}
          />
          <StatCard
            label="Scan Rate"
            value={formatPct(scanRate)}
            accent="var(--indigo)"
            sub={`${scannedCount} of ${totalMailed} scanned`}
          />
          <StatCard
            label="Quote Rate"
            value={formatPct(quoteRate)}
            accent="var(--green)"
            sub={`${quoteCount} of ${totalMailed} quoted`}
          />
        </div>
      </div>

      {/* SECTION 2 — Batch History */}
      <div style={{ marginBottom: 28 }}>
        <div className="data-section-header">
          <h3 className="data-section-title">Batch History</h3>
          {selectedBatch && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setSelectedBatch(null)}
            >
              Clear filter
            </button>
          )}
        </div>
        {batches.length === 0 ? (
          <div className="empty-state"><div className="empty-state-text">No batches found.</div></div>
        ) : (
          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg-card)' }}>
            <table className="stack-table" style={{ minWidth: 600 }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Cards Sent</th>
                  <th>Counties</th>
                  <th>Est. Cost</th>
                  <th>Scans</th>
                  <th>Quotes</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => {
                  const bCards = batch.cards;
                  const counties = [...new Set(bCards.map((c) => c.county).filter(Boolean))].sort().join(', ');
                  const bScans = bCards.filter((c) => c.firstScanAt != null).length;
                  const bQuotes = bCards.filter((c) => Array.isArray(c.quoteIds) && c.quoteIds.length > 0).length;
                  const bCost = bCards.length * COST_PER_CARD;
                  const isSelected = selectedBatch === batch.batchId;
                  return (
                    <tr
                      key={batch.batchId}
                      style={{
                        cursor: 'pointer',
                        background: isSelected ? 'rgba(76,193,243,0.08)' : undefined,
                        outline: isSelected ? '1px solid rgba(76,193,243,0.4)' : undefined,
                      }}
                      onClick={() => setSelectedBatch(isSelected ? null : batch.batchId)}
                    >
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: isSelected ? 'var(--teal)' : 'var(--text-primary)' }}>
                        {batch.batchId}
                      </td>
                      <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{bCards.length.toLocaleString()}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 280, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{counties || '—'}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--coral)' }}>{formatMoney(bCost)}</td>
                      <td style={{ color: bScans > 0 ? 'var(--indigo)' : 'var(--text-muted)' }}>{bScans}</td>
                      <td style={{ color: bQuotes > 0 ? 'var(--green)' : 'var(--text-muted)' }}>{bQuotes}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SECTION 3 — Card List */}
      <div>
        <div className="data-section-header">
          <h3 className="data-section-title">
            {selectedBatch ? `Cards — Batch ${selectedBatch}` : 'All Cards'}
            <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: 'var(--text-secondary)' }}>
              ({filteredCards.length.toLocaleString()})
            </span>
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="live-indicator">
              <span className="live-dot" />
              Live
            </span>
          </div>
        </div>

        {filteredCards.length === 0 ? (
          <div className="empty-state"><div className="empty-state-text">No cards found.</div></div>
        ) : (
          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg-card)' }}>
            <table className="stack-table" style={{ minWidth: 780 }}>
              <thead>
                <tr>
                  <th>Business Name</th>
                  <th>County</th>
                  <th>City</th>
                  <th>Keyword</th>
                  <th>Mailed</th>
                  <th>Scanned</th>
                  <th>Quote</th>
                </tr>
              </thead>
              <tbody>
                {filteredCards.map((card) => {
                  const scanned = card.firstScanAt != null;
                  const quoted = Array.isArray(card.quoteIds) && card.quoteIds.length > 0;
                  return (
                    <tr
                      key={card.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setDrawerCard(card)}
                    >
                      <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        {card.businessName || '—'}
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{card.county || '—'}</td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{card.city || '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{card.industryKeyword || '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {formatDate(card.mailedAt)}
                      </td>
                      <td>
                        {scanned ? (
                          <span style={{ color: 'var(--indigo)', fontWeight: 600, fontSize: 12 }}>
                            Yes<span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 4 }}>{formatDate(card.firstScanAt)}</span>
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>No</span>
                        )}
                      </td>
                      <td>
                        {quoted ? (
                          <span style={{ color: 'var(--green)', fontWeight: 600, fontSize: 12 }}>Yes</span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>No</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Slide-out drawer */}
      {drawerCard && (
        <DrawerOverlay card={drawerCard} onClose={() => setDrawerCard(null)} />
      )}
    </div>
  );
}
