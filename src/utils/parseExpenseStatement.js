import { taxYearFromDate } from '../data/expensesData';

const PDFJS_VERSION = '3.11.174';
const PDFJS_CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

const DEFAULT_APP = 'DAL General';
const DEFAULT_CATEGORY = 'Other';

/** More specific keywords first (length-sorted at runtime). Mapped onto existing expense categories. */
const VENDOR_CATEGORY_RULES = [
  { category: 'Domain & Hosting', keywords: ['Vercel', 'GoDaddy', 'Cloudflare', 'Namecheap', 'DigitalOcean', 'AWS', 'Google Cloud', 'Firebase'] },
  { category: 'Software & Subscriptions', keywords: ['App Store', 'Google Play', 'RevenueCat', 'ChatGPT', 'Anthropic', 'OpenAI', 'Expo', 'GitHub', 'Sentry', 'Twilio', 'Mailgun', 'Stripe', 'Adobe', 'Figma', 'Notion', 'Slack', 'Zoom', 'Microsoft', 'Apple'] },
  { category: 'Advertising & Marketing', keywords: ['Google Ads', 'Facebook', 'Instagram', 'Meta'] },
  { category: 'Other', keywords: ['Amazon Business', 'Office Depot', 'Staples', 'FedEx', 'UPS'] },
  { category: 'Travel & Meals', keywords: ['Uber Eats', 'DoorDash', 'Grubhub', 'Starbucks', 'Restaurants', 'Airbnb', 'Marriott', 'Hilton', 'Airlines', 'Hotels', 'Uber', 'Lyft'] },
  { category: 'Hardware & Equipment', keywords: ['Best Buy', 'B&H', 'Newegg', 'Apple Store'] },
  { category: 'Professional Services', keywords: ['BNI'] },
];

const KEYWORD_RULES = VENDOR_CATEGORY_RULES.flatMap((rule) =>
  rule.keywords.map((keyword) => ({ keyword, category: rule.category, len: keyword.length }))
).sort((a, b) => b.len - a.len);

const SKIP_LINE = /^(date|description|amount|balance|trans(?:action)?\s*date|post(?:ing)?\s*date|merchant|details|page\s+\d+|account\s+(?:number|summary)|previous\s+balance|new\s+balance|minimum\s+payment|payment\s+thank\s+you|total\s+(?:fees|interest|payments)|purchases|fees\s+charged)$/i;

const DATE_FULL = /\b(0?[1-9]|1[0-2])[/\-](0?[1-9]|[12]\d|3[01])[/\-](\d{2}|\d{4})\b/g;
const DATE_SHORT = /\b(0?[1-9]|1[0-2])[/\-](0?[1-9]|[12]\d|3[01])\b/g;
const AMOUNT = /(?:USD|US\$|\$)?\s*(-?\(?\d{1,3}(?:,\d{3})*(?:\.\d{2})\)?)(?:\s*(?:CR|DR))?/gi;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (window.pdfjsLib) resolve();
      else existing.addEventListener('load', () => resolve());
      return;
    }
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('Could not load PDF.js from CDN.'));
    document.head.appendChild(el);
  });
}

export async function loadPdfJs() {
  if (!window.pdfjsLib) {
    await loadScript(`${PDFJS_CDN}/pdf.min.js`);
  }
  if (!window.pdfjsLib) {
    throw new Error('PDF.js failed to initialize.');
  }
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;
  return window.pdfjsLib;
}

function roundY(y) {
  return Math.round(y / 2) * 2;
}

async function extractLinesFromPdf(file) {
  const pdfjsLib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const lines = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const rows = new Map();

    content.items.forEach((item) => {
      const str = String(item.str || '').replace(/\s+/g, ' ').trim();
      if (!str) return;
      const y = item.transform ? roundY(item.transform[5]) : 0;
      const x = item.transform ? item.transform[4] : 0;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x, str });
    });

    Array.from(rows.entries())
      .sort((a, b) => b[0] - a[0])
      .forEach(([, parts]) => {
        parts.sort((a, b) => a.x - b.x);
        const text = parts.map((p) => p.str).join(' ').replace(/\s+/g, ' ').trim();
        if (text) lines.push(text);
      });
  }

  return lines;
}

function inferYear(lines) {
  const years = [];
  const re = /\b(20[2-3]\d)\b/g;
  lines.forEach((line) => {
    let m;
    while ((m = re.exec(line))) years.push(Number(m[1]));
  });
  if (!years.length) return new Date().getFullYear();
  years.sort((a, b) => a - b);
  return years[Math.floor(years.length / 2)];
}

function toIsoDate(month, day, year) {
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  let y = Number(year);
  if (y < 100) y += y >= 70 ? 1900 : 2000;
  return `${y}-${m}-${d}`;
}

function parseAmountToken(raw) {
  if (!raw) return null;
  const num = Number(String(raw).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.abs(num);
}

function extractAmounts(line) {
  const found = [];
  let m;
  const re = new RegExp(AMOUNT.source, 'gi');
  while ((m = re.exec(line))) {
    const amount = parseAmountToken(m[1] || m[0]);
    if (amount != null && amount < 1000000) {
      found.push({ amount, index: m.index, raw: m[0] });
    }
  }
  return found;
}

function extractDates(line, fallbackYear) {
  const dates = [];
  let m;
  const full = new RegExp(DATE_FULL.source, 'g');
  while ((m = full.exec(line))) {
    dates.push({
      iso: toIsoDate(m[1], m[2], m[3]),
      index: m.index,
      length: m[0].length,
      text: m[0],
    });
  }
  if (dates.length) return dates;

  const short = new RegExp(DATE_SHORT.source, 'g');
  while ((m = short.exec(line))) {
    dates.push({
      iso: toIsoDate(m[1], m[2], fallbackYear),
      index: m.index,
      length: m[0].length,
      text: m[0],
    });
  }
  return dates;
}

function cleanVendor(line, dates, amounts) {
  let text = line;
  [...dates, ...amounts].sort((a, b) => (b.index || 0) - (a.index || 0)).forEach((hit) => {
    const len = hit.length || String(hit.raw || hit.text || '').length;
    text = text.slice(0, hit.index) + ' ' + text.slice(hit.index + len);
  });
  return text
    .replace(/\b(USD|US\$|CR|DR)\b/gi, ' ')
    .replace(/[#*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function categorizeVendor(vendor) {
  const hay = String(vendor || '').toLowerCase();
  const hit = KEYWORD_RULES.find((rule) => hay.includes(rule.keyword.toLowerCase()));
  return hit ? hit.category : DEFAULT_CATEGORY;
}

function looksLikeHeader(line) {
  if (SKIP_LINE.test(line.trim())) return true;
  if (/payment\s+received|thank you for your payment|autopay/i.test(line)) return true;
  return false;
}

export function parseStatementLines(lines) {
  const year = inferYear(lines);
  const seen = new Set();
  const rows = [];

  lines.forEach((line) => {
    if (!line || looksLikeHeader(line)) return;
    const dates = extractDates(line, year);
    const amounts = extractAmounts(line);
    if (!dates.length || !amounts.length) return;

    const date = dates[0];
    const dollarPref = amounts.filter((a) => /\$/.test(a.raw));
    const amountHit = (dollarPref.length ? dollarPref : amounts)[0];
    const vendor = cleanVendor(line, dates, amounts);
    if (!vendor || vendor.length < 2) return;
    if (/^(total|subtotal|balance|interest)$/i.test(vendor)) return;

    const key = `${date.iso}|${amountHit.amount}|${vendor.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);

    rows.push({
      date: date.iso,
      vendor,
      amount: amountHit.amount,
      category: categorizeVendor(vendor),
      appId: DEFAULT_APP,
      taxYear: taxYearFromDate(date.iso),
      selected: true,
    });
  });

  return rows;
}

export async function parseStatementPdf(file) {
  const lines = await extractLinesFromPdf(file);
  return parseStatementLines(lines);
}
