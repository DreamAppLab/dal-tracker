// Money helpers for the ledger. All amounts are INTEGER CENTS — never floats.
// CommonJS on purpose: shared by the React app (webpack), node:test suites and
// the node migration script.


function isCents(v) {
  return Number.isSafeInteger(v);
}

function assertCents(v, label) {
  if (!isCents(v)) {
    throw new Error(`${label || 'amount'} must be an integer number of cents (got ${v})`);
  }
  return v;
}

/**
 * Parse user / statement text into cents without going through float math.
 * Accepts "1,234.56", "$12", "-4.5", "(12.30)", "12.30 CR", "12.30-".
 * Returns null when the text is not a money amount.
 */
function parseMoneyToCents(input) {
  if (input == null) return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    // Numbers from spreadsheets: round half away from zero on the decimal string.
    return parseMoneyToCents(input.toFixed(6));
  }
  let s = String(input).trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/\s*CR$/i.test(s)) {
    s = s.replace(/\s*CR$/i, '');
  } else if (/\s*DR$/i.test(s)) {
    s = s.replace(/\s*DR$/i, '');
  }
  s = s.replace(/USD|US\$|\$|,|\s/gi, '');
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (!/^\d*(\.\d*)?$/.test(s) || s === '' || s === '.') return null;
  const [whole, frac = ''] = s.split('.');
  const fracPadded = (frac + '000000').slice(0, 6);
  let cents = Number(whole || '0') * 100 + Number(fracPadded.slice(0, 2));
  // Round half away from zero using the remaining digits.
  if (Number(fracPadded.slice(2, 3)) >= 5) cents += 1;
  if (!Number.isSafeInteger(cents)) return null;
  return negative && cents !== 0 ? -cents : cents;
}

/** Legacy float dollars (old `expenses.amount`) → cents, rounding on the decimal string. */
function dollarsToCents(dollars) {
  const c = parseMoneyToCents(dollars);
  if (c == null) throw new Error(`Not a money amount: ${dollars}`);
  return c;
}

function sumCents(values) {
  let total = 0;
  for (const v of values) {
    assertCents(v);
    total += v;
  }
  assertCents(total, 'total');
  return total;
}

/** "1234.5" style plain decimal string for CSV exports. */
function centsToDecimalString(cents) {
  assertCents(cents);
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}

/** "$1,234.56" / "-$1,234.56" (or "($1,234.56)" with { parens: true }). */
function formatCents(cents, opts) {
  const o = opts || {};
  if (cents == null || !isCents(cents)) return o.blank != null ? o.blank : '—';
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  const body = `$${dollars}.${String(abs % 100).padStart(2, '0')}`;
  if (!neg) return o.plus && cents > 0 ? `+${body}` : body;
  return o.parens ? `(${body})` : `-${body}`;
}

/**
 * Split `total` cents across `weights` proportionally with largest-remainder
 * rounding so the parts always sum exactly to the total.
 */
function allocateCents(total, weights) {
  assertCents(total, 'total');
  const w = weights.map((x) => Math.max(0, Number(x) || 0));
  const sumW = w.reduce((a, b) => a + b, 0);
  if (!w.length) return [];
  if (!sumW) {
    const out = w.map(() => 0);
    out[0] = total;
    return out;
  }
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const raw = w.map((x) => (abs * x) / sumW);
  const floors = raw.map(Math.floor);
  let rest = abs - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < order.length && rest > 0; k += 1, rest -= 1) floors[order[k].i] += 1;
  return floors.map((x) => x * sign);
}

module.exports = {
  isCents,
  assertCents,
  parseMoneyToCents,
  dollarsToCents,
  sumCents,
  centsToDecimalString,
  formatCents,
  allocateCents,
};
