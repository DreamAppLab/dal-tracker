// Statement import logic (pure): CSV parsing, column mappings, fingerprints,
// duplicate detection, matching existing entries, vendor rules and
// card-payment (transfer) detection.


const { parseMoneyToCents } = require('./money');
const { DATE_RE } = require('./constants');

// ── Hashing (non-cryptographic, stable ids for fingerprints) ──────────────
function fnv1a32(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
function stableHash(str) {
  const s = String(str);
  return fnv1a32(s, 0x811c9dc5).toString(16).padStart(8, '0') + fnv1a32(s, 0x2b5f9e1d).toString(16).padStart(8, '0');
}

// ── Payee normalization ───────────────────────────────────────────────────
function normalizePayee(payee) {
  return String(payee || '')
    .toUpperCase()
    .replace(/[*#]/g, ' ')
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/[^A-Z0-9&./ -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function baseKey(accountId, row) {
  return `${accountId}|${row.date}|${row.amountCents}|${normalizePayee(row.payee)}`;
}

/**
 * Give every row a fingerprint. Identical rows in one file (two $5 charges at
 * the same coffee shop on the same day) get occurrence numbers #1, #2 …, so a
 * re-import maps each one to the same fingerprint again.
 */
function withFingerprints(accountId, rows) {
  const seen = new Map();
  return rows.map((row) => {
    // Bank-issued unique ids (OFX FITID) make an exact fingerprint.
    if (row.fitid) return { ...row, fingerprint: stableHash(`${accountId}|fitid|${row.fitid}`) };
    const key = baseKey(accountId, row);
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    return { ...row, fingerprint: stableHash(`${key}#${n}`) };
  });
}

function dayDiff(a, b) {
  const pa = Date.UTC(...a.split('-').map((x, i) => (i === 1 ? Number(x) - 1 : Number(x))));
  const pb = Date.UTC(...b.split('-').map((x, i) => (i === 1 ? Number(x) - 1 : Number(x))));
  return Math.round(Math.abs(pa - pb) / 86400000);
}

function similarPayee(a, b) {
  if (!a || !b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  return a.slice(0, 10) === b.slice(0, 10);
}

/**
 * Classify incoming rows against existing transactions in the same account:
 *   - 'duplicate'   fingerprint already imported → skipped (re-import is a no-op)
 *   - 'match'       an existing entry without a fingerprint (manual entry, a
 *                   transfer leg created from the other statement, a
 *                   settlement) has the same amount within ±windowDays → the
 *                   row is attached to it instead of creating a new one
 *   - 'possible'    same date/amount/payee as an existing entry → unchecked
 *   - 'new'
 */
function classifyRows(rows, existing, opts) {
  const windowDays = (opts && opts.windowDays) || 5;
  const live = existing.filter((t) => !t.deleted);
  // Deleted rows still count: a row you deleted must not come back on re-import.
  const fps = new Set(existing.map((t) => t.fingerprint).filter(Boolean));
  const baseKeys = new Map();
  for (const t of live) {
    const k = `${t.date}|${t.amountCents}|${normalizePayee(t.payee)}`;
    baseKeys.set(k, (baseKeys.get(k) || 0) + 1);
  }
  const used = new Set();
  const nearUsed = new Set();
  return rows.map((row) => {
    if (fps.has(row.fingerprint)) return { ...row, status: 'duplicate', selected: false };
    const candidates = live
      .filter((t) => !t.fingerprint && !used.has(t.id) && t.amountCents === row.amountCents && dayDiff(t.date, row.date) <= windowDays)
      .sort((a, b) => dayDiff(a.date, row.date) - dayDiff(b.date, row.date));
    if (candidates.length) {
      used.add(candidates[0].id);
      return { ...row, status: 'match', matchTxnId: candidates[0].id, selected: true };
    }
    const k = `${row.date}|${row.amountCents}|${normalizePayee(row.payee)}`;
    if (baseKeys.get(k)) {
      baseKeys.set(k, baseKeys.get(k) - 1);
      return { ...row, status: 'possible', selected: false };
    }
    // Same money already imported in another format (QFX vs CSV: OFX NAME is
    // cut at 32 chars and uses the posted date): flag it, unselected.
    const p = normalizePayee(row.payee);
    const near = live.find((t) => t.fingerprint && !nearUsed.has(t.id) && t.amountCents === row.amountCents
      && dayDiff(t.date, row.date) <= 3 && similarPayee(normalizePayee(t.payee), p));
    if (near) {
      nearUsed.add(near.id);
      return { ...row, status: 'possible', selected: false, possibleOf: near.id };
    }
    return { ...row, status: 'new', selected: true };
  });
}

// ── Vendor rules ──────────────────────────────────────────────────────────
/** Best matching vendor rule (longest pattern contained in the payee), or null. */
function matchVendorRule(payee, rules) {
  const hay = normalizePayee(payee);
  if (!hay) return null;
  let best = null;
  for (const r of rules || []) {
    const pat = normalizePayee(r.pattern);
    if (!pat || !hay.includes(pat)) continue;
    if (!best || pat.length > best.len) best = { len: pat.length, rule: r };
  }
  return best ? best.rule : null;
}

function applyVendorRules(payee, rules) {
  const r = matchVendorRule(payee, rules);
  return r ? r.categoryId : null;
}

// ── Card payments (transfers) ─────────────────────────────────────────────
const CARD_SIDE = /\b(PAYMENT|AUTOPAY|AUTO PAY|THANK YOU|PYMT|PMT)\b/;
const BANK_SIDE = /(CHASE CREDIT CRD|PAYMENT TO CHASE CARD|CHASE CARD|CAPITAL ONE|CAPITALONE|CRCARDPMT|CARD ?PMT|CREDIT CARD|CC PAYMENT|AUTOPAY|AUTO PAY|AMEX|EPAY|CITI CARD|DISCOVER)/;

function isLikelyCardPayment(row, accountKind) {
  const p = normalizePayee(row.payee);
  if (accountKind === 'credit_card') return row.amountCents > 0 && CARD_SIDE.test(p) && !/REFUND|RETURN|CREDIT ADJ/.test(p);
  if (accountKind === 'checking') return row.amountCents < 0 && BANK_SIDE.test(p);
  return false;
}

/**
 * Suggest how to treat likely card payments: link to an existing unlinked
 * opposite entry in the other account (±windowDays), or create a transfer.
 */
function suggestTransfer(row, accountKind, otherAccountId, otherAccountTxns, usedIds, opts) {
  if (!otherAccountId || !isLikelyCardPayment(row, accountKind)) return null;
  const windowDays = (opts && opts.windowDays) || 5;
  const otherKind = accountKind === 'credit_card' ? 'checking' : 'credit_card';
  // Only adopt an entry that is clearly the other side of a card payment and
  // has no category yet — never re-book a categorized expense (e.g. rent of
  // the same amount) as a transfer.
  const candidates = (otherAccountTxns || [])
    .filter((t) => !t.deleted && t.role === 'main' && !t.transferAccountId && !t.categoryId && !t.settlementId
      && !(t.splits && t.splits.length) && !(usedIds && usedIds.has(t.id))
      && t.amountCents === -row.amountCents && dayDiff(t.date, row.date) <= windowDays
      && isLikelyCardPayment(t, otherKind))
    .sort((a, b) => dayDiff(a.date, row.date) - dayDiff(b.date, row.date));
  if (candidates.length) return { transferAccountId: otherAccountId, pairTxnId: candidates[0].id };
  return { transferAccountId: otherAccountId, pairTxnId: null };
}

// ── CSV ───────────────────────────────────────────────────────────────────
function detectDelimiter(text) {
  const first = String(text).split(/\r?\n/).find((l) => l.trim()) || '';
  const counts = { ',': 0, '\t': 0, ';': 0 };
  let inQ = false;
  for (const ch of first) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && counts[ch] != null) counts[ch] += 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';
}

/** RFC-4180-ish CSV → array of rows (quoted fields, escaped quotes, newlines in quotes). */
function parseCsvText(text, delimiter) {
  const src = String(text || '').replace(/^﻿/, '');
  const d = delimiter || detectDelimiter(src);
  const rows = [];
  let row = [];
  let cell = '';
  let inQ = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else inQ = false;
      } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === d) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      if (row.some((c) => String(c).trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => String(c).trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((c) => String(c).trim()));
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

function iso(y, m, d) {
  let yy = Number(y);
  if (yy < 100) yy += yy >= 70 ? 1900 : 2000;
  const s = `${yy}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return DATE_RE.test(s) ? s : '';
}

/** Parse statement dates. fmt: 'auto' | 'MDY' | 'DMY' | 'YMD'. Excel serials supported. */
function parseFlexibleDate(value, fmt) {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return iso(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const dt = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) return fmt === 'DMY' ? iso(m[3], m[2], m[1]) : iso(m[3], m[1], m[2]);
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && MONTHS[m[1].slice(0, 4).toLowerCase()] != null) return iso(m[3], MONTHS[m[1].slice(0, 4).toLowerCase()], m[2]);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()] != null) return iso(m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], m[2]);
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()] != null) return iso(m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], m[1]);
  return '';
}

// Chase first: both companies bank with Chase. Chase's own exports:
//   credit card: Transaction Date, Post Date, Description, Category, Type, Amount, Memo
//                (Amount is signed: purchases negative, payments positive)
//   checking:    Details, Posting Date, Description, Amount, Type, Balance, Check or Slip #
//                (Amount is signed: debits negative)
const PRESETS = Object.freeze({
  chase_card: {
    label: 'Chase credit card (CSV)',
    match: ['transaction date', 'post date', 'description', 'type', 'amount'],
    mapping: { dateCol: 'Transaction Date', payeeCol: 'Description', amountCol: 'Amount', memoCol: 'Memo', amountSign: 'signed' },
  },
  chase_bank: {
    label: 'Chase checking (CSV)',
    match: ['details', 'posting date', 'description', 'amount', 'type', 'balance'],
    mapping: { dateCol: 'Posting Date', payeeCol: 'Description', amountCol: 'Amount', memoCol: 'Check or Slip #', amountSign: 'signed' },
  },
  capone_card: {
    label: 'Capital One card (CSV)',
    match: ['transaction date', 'posted date', 'card no.', 'description', 'debit', 'credit'],
    mapping: { dateCol: 'Transaction Date', payeeCol: 'Description', debitCol: 'Debit', creditCol: 'Credit', memoCol: 'Category' },
  },
  capone_bank: {
    label: 'Capital One bank (CSV)',
    match: ['transaction description', 'transaction date', 'transaction type', 'transaction amount'],
    mapping: { dateCol: 'Transaction Date', payeeCol: 'Transaction Description', amountCol: 'Transaction Amount', typeCol: 'Transaction Type', amountSign: 'positive' },
  },
  generic_signed: {
    label: 'Date, Description, Amount',
    match: ['date', 'description', 'amount'],
    mapping: { dateCol: 'Date', payeeCol: 'Description', amountCol: 'Amount', amountSign: 'signed' },
  },
});

function detectPreset(headers) {
  const h = headers.map((x) => String(x || '').trim().toLowerCase());
  for (const [key, p] of Object.entries(PRESETS)) {
    if (p.match.every((col) => h.includes(col))) return key;
  }
  return null;
}

function colIndex(headers, name) {
  if (name == null || name === '') return -1;
  if (typeof name === 'number') return name;
  const i = headers.findIndex((h) => String(h).trim().toLowerCase() === String(name).trim().toLowerCase());
  return i;
}

/**
 * Apply a column mapping to a parsed table.
 * mapping: { dateCol, payeeCol, memoCol?, amountCol? | debitCol?/creditCol?,
 *            typeCol?, amountSign: 'signed' | 'inverted' | 'positive',
 *            dateFormat: 'auto'|'MDY'|'DMY'|'YMD', headerRow: 0 }
 *   signed   — negative = money out (checking exports)
 *   inverted — positive = money out (most card exports)
 *   positive — amounts are positive; typeCol says Debit/Credit
 * Debit = money out (−), Credit = money in (+), in every account type.
 * Returns { rows, errors }.
 */
function applyMapping(table, mapping) {
  const headerRow = mapping.headerRow || 0;
  const headers = table[headerRow] || [];
  const ix = {
    date: colIndex(headers, mapping.dateCol),
    payee: colIndex(headers, mapping.payeeCol),
    memo: colIndex(headers, mapping.memoCol),
    amount: colIndex(headers, mapping.amountCol),
    debit: colIndex(headers, mapping.debitCol),
    credit: colIndex(headers, mapping.creditCol),
    type: colIndex(headers, mapping.typeCol),
  };
  const errors = [];
  if (ix.date < 0) errors.push('Pick the date column.');
  if (ix.payee < 0) errors.push('Pick the description / payee column.');
  if (ix.amount < 0 && ix.debit < 0 && ix.credit < 0) errors.push('Pick an amount column, or debit/credit columns.');
  if (errors.length) return { rows: [], errors };
  const rows = [];
  table.slice(headerRow + 1).forEach((cells, n) => {
    const date = parseFlexibleDate(cells[ix.date], mapping.dateFormat || 'auto');
    const payee = String(cells[ix.payee] || '').replace(/\s+/g, ' ').trim();
    let cents = null;
    if (ix.amount >= 0 && String(cells[ix.amount] || '').trim() !== '') {
      const raw = parseMoneyToCents(cells[ix.amount]);
      if (raw != null) {
        if (mapping.amountSign === 'inverted') cents = -raw;
        else if (mapping.amountSign === 'positive' && ix.type >= 0) {
          const ty = String(cells[ix.type] || '').toLowerCase();
          cents = /credit|deposit/.test(ty) ? Math.abs(raw) : -Math.abs(raw);
        } else cents = raw;
      }
    } else {
      const debit = ix.debit >= 0 ? parseMoneyToCents(cells[ix.debit]) : null;
      const credit = ix.credit >= 0 ? parseMoneyToCents(cells[ix.credit]) : null;
      if (debit) cents = -Math.abs(debit);
      else if (credit) cents = Math.abs(credit);
    }
    if (!date && !payee && cents == null) return;
    if (!date || cents == null || cents === 0) {
      errors.push(`Row ${headerRow + n + 2}: skipped (could not read ${!date ? 'date' : 'amount'}).`);
      return;
    }
    rows.push({ date, payee: payee || '(no description)', memo: ix.memo >= 0 ? String(cells[ix.memo] || '').trim().slice(0, 300) : '', amountCents: cents });
  });
  return { rows, errors };
}

// ── OFX / QFX (Chase "Quicken Web Connect" download) ──────────────────────
function ofxTag(block, tag) {
  const m = new RegExp(`<${tag}>([^<\r\n]*)`, 'i').exec(block);
  return m ? m[1].trim() : '';
}
function decodeEntities(s) {
  return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
}

/**
 * Parse OFX/QFX (SGML or XML). Amounts are signed from the account holder's
 * side (debits/charges negative) — the ledger's own sign convention.
 * FITID is the bank's unique transaction id; rows carry it so dedupe is exact.
 */
function parseOfx(text) {
  const src = String(text || '');
  if (!/<OFX>/i.test(src)) return { rows: [], accountType: '', last4: '', errors: ['Not an OFX/QFX file.'] };
  const accountType = /<CCSTMTRS>|<CCACCTFROM>/i.test(src) ? 'credit_card' : 'checking';
  const acct = ofxTag(src, 'ACCTID');
  const rows = [];
  const errors = [];
  const blocks = src.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0]);
  blocks.forEach((b, i) => {
    const dt = ofxTag(b, 'DTPOSTED');
    const date = /^\d{8}/.test(dt) ? `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}` : '';
    const cents = parseMoneyToCents(ofxTag(b, 'TRNAMT'));
    const name = decodeEntities(ofxTag(b, 'NAME') || ofxTag(b, 'PAYEE'));
    const memo = decodeEntities(ofxTag(b, 'MEMO'));
    if (!DATE_RE.test(date) || !cents) {
      errors.push(`Transaction ${i + 1}: skipped (missing date or amount).`);
      return;
    }
    rows.push({ date, payee: (name || memo || '(no description)').replace(/\s+/g, ' ').trim(), memo: name && memo && memo !== name ? memo.slice(0, 300) : '', amountCents: cents, fitid: ofxTag(b, 'FITID') });
  });
  return { rows, accountType, last4: acct.replace(/\D/g, '').slice(-4), errors };
}

/** Capital One PDF parser rows ({date, vendor, amount, credit?}) → ledger rows. */
function fromCapOnePdfRows(parsed) {
  return parsed.map((r) => {
    const cents = parseMoneyToCents(r.amount);
    return { date: r.date, payee: r.vendor, memo: r.credit ? 'Payment / credit' : '', amountCents: r.credit ? Math.abs(cents) : -Math.abs(cents) };
  }).filter((r) => r.date && r.amountCents);
}

module.exports = {
  stableHash,
  normalizePayee,
  baseKey,
  withFingerprints,
  classifyRows,
  applyVendorRules,
  matchVendorRule,
  isLikelyCardPayment,
  suggestTransfer,
  detectDelimiter,
  parseCsvText,
  parseFlexibleDate,
  PRESETS,
  detectPreset,
  applyMapping,
  parseOfx,
  fromCapOnePdfRows,
  dayDiff,
};
