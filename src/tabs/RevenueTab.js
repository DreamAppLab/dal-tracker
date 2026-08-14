import React from 'react';
import { sumClientProjectRevenue } from '../utils/revenueTotals';

const TYPE_BADGE = {
  deposit: { label: 'Deposit', color: '#22C55E', bg: 'rgba(34, 197, 94, 0.16)' },
  balance: { label: 'Balance', color: '#2196F3', bg: 'rgba(33, 150, 243, 0.16)' },
  reversal: { label: 'Reversal', color: '#FF5B5B', bg: 'rgba(255, 91, 91, 0.16)' },
};

function formatMoney(amount) {
  const n = Number(amount) || 0;
  const formatted = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `-$${formatted}` : `$${formatted}`;
}

function formatEntryDate(value) {
  const iso = String(value || '').slice(0, 10);
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[parseInt(m, 10) - 1];
  if (!month || !d || !y) return iso;
  return `${month} ${parseInt(d, 10)}, ${y}`;
}

export default function ClientProjectRevenueSection({ entries = [], loading = false, error = '' }) {
  const totals = sumClientProjectRevenue(entries);

  return (
    <div className="client-revenue-section">
      <div className="section-label" style={{ marginBottom: 16 }}>
        Client Project Revenue
      </div>

      <div className="stats-grid client-revenue-summary">
        <div className="stat-card green">
          <div className="stat-label">Total deposits received</div>
          <div className="stat-value" style={{ color: 'var(--green)' }}>{formatMoney(totals.deposits)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total balances received</div>
          <div className="stat-value" style={{ color: '#2196F3' }}>{formatMoney(totals.balances)}</div>
        </div>
        <div className="stat-card coral">
          <div className="stat-label">Total reversals</div>
          <div className="stat-value" style={{ color: 'var(--coral)' }}>{formatMoney(-totals.reversals)}</div>
        </div>
        <div className="stat-card teal">
          <div className="stat-label">Net Client Revenue</div>
          <div
            className="stat-value"
            style={{ color: totals.net >= 0 ? 'var(--green)' : 'var(--coral)' }}
          >
            {formatMoney(totals.net)}
          </div>
        </div>
      </div>

      <div className="quotes-table-wrap client-revenue-table-wrap">
        {loading ? (
          <div className="empty-state">Loading client project revenue…</div>
        ) : error ? (
          <div className="empty-state">
            <div className="empty-state-text">{error}</div>
          </div>
        ) : entries.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-text">No client project revenue entries yet.</div>
          </div>
        ) : (
          <table className="stack-table quotes-table client-revenue-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Type</th>
                <th className="client-revenue-amount-col">Amount</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((row) => {
                const type = String(row.type || '').toLowerCase();
                const badge = TYPE_BADGE[type] || {
                  label: row.type || '—',
                  color: 'var(--text-secondary)',
                  bg: 'rgba(148, 163, 184, 0.16)',
                };
                const isReversal = type === 'reversal';
                const amount = Number(row.amount) || 0;
                const displayAmount = isReversal ? -Math.abs(amount) : amount;
                return (
                  <tr key={row.id}>
                    <td>{formatEntryDate(row.date)}</td>
                    <td>{row.description || row.note || '—'}</td>
                    <td>
                      <span
                        className="client-revenue-type-badge"
                        style={{ color: badge.color, background: badge.bg }}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td
                      className="client-revenue-amount-col"
                      style={{ color: displayAmount < 0 || isReversal ? 'var(--coral)' : 'var(--green)' }}
                    >
                      {formatMoney(displayAmount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
