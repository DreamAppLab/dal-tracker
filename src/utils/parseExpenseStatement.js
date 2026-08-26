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

const MONTH_NAME = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9,
  sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

function monthFromName(name) {
  return MONTH_NAME[String(name || '').toLowerCase().replace(/\./g, '')] || 0;
}

function detectStatementYear(lines) {
  const header = lines.slice(0, 80).join(' ');
  const month = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec';

  const labeledPeriod = header.match(
    new RegExp(
      `(?:statement\\s+period|billing\\s+period|for\\s+the\\s+period|closing\\s+date)[:\\s]+[\\s\\S]{0,80}?\\b(${month})\\.?\\s+(\\d{1,2})(?:\\s*[-–]\\s*(${month})\\.?\\s+(\\d{1,2}))?,?\\s+(20\\d{2})`,
      'i'
    )
  );
  if (labeledPeriod) {
    return {
      year: Number(labeledPeriod[5]),
      startMonth: monthFromName(labeledPeriod[1]),
      endMonth: monthFromName(labeledPeriod[3] || labeledPeriod[1]),
      endYear: Number(labeledPeriod[5]),
    };
  }

  const range = header.match(
    new RegExp(`\\b(${month})\\.?\\s+(\\d{1,2})\\s*[-–]\\s*(${month})\\.?\\s+(\\d{1,2}),?\\s+(20\\d{2})`, 'i')
  );
  if (range) {
    const endYear = Number(range[5]);
    const startMonth = monthFromName(range[1]);
    const endMonth = monthFromName(range[3]);
    const startYear = startMonth > endMonth ? endYear - 1 : endYear;
    return { year: endYear, startMonth, endMonth, startYear, endYear };
  }

  const closingNumeric = header.match(/closing\s+date[:\s]+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
  if (closingNumeric) {
    let year = Number(closingNumeric[3]);
    if (year < 100) year += 2000;
    return { year, endMonth: Number(closingNumeric[1]), endYear: year };
  }

  const monthYear = header.match(new RegExp(`\\b(${month})\\.?\\s+(20\\d{2})\\b`, 'i'));
  if (monthYear) return { year: Number(monthYear[2]), endMonth: monthFromName(monthYear[1]), endYear: Number(monthYear[2]) };

  const years = [];
  const re = /\b(20[2-3]\d)\b/g;
  let m;
  while ((m = re.exec(header))) years.push(Number(m[1]));
  if (!years.length) return { year: new Date().getFullYear() };
  years.sort((a, b) => a - b);
  const year = years[Math.floor(years.length / 2)];
  return { year, endYear: year };
}

function yearForMonth(month, info) {
  const endYear = info.endYear || info.year;
  const startYear = info.startYear;
  if (startYear && startYear !== endYear && info.startMonth && info.endMonth) {
    return month >= info.startMonth ? startYear : endYear;
  }
  return info.year || endYear || new Date().getFullYear();
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

function cleanVendorName(vendor) {
  return String(vendor || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s#*·•\-]+[A-Z0-9]{4,}\s*$/i, '')
    .replace(/\s+\d{4,}\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function shouldSkipPurchaseLine(vendor) {
  const text = String(vendor || '');
  if (/\b(payment|credit|balance|minimum|interest)\b/i.test(text)) return true;
  if (/\bfee\b/i.test(text) && !/\b(annual|membership|foreign|late)\b/i.test(text)) return true;
  return false;
}

function toRow(dateIso, vendor, amount) {
  const cleaned = cleanVendorName(vendor);
  if (!cleaned || cleaned.length < 2) return null;
  if (shouldSkipPurchaseLine(cleaned)) return null;
  return {
    date: dateIso,
    vendor: cleaned,
    amount,
    category: categorizeVendor(cleaned),
    appId: DEFAULT_APP,
    taxYear: taxYearFromDate(dateIso),
    selected: true,
  };
}

function parseCapOneLine(raw, yearInfo) {
  const line = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!line) return null;

  const lastToken = line.split(' ').pop() || '';
  if (/^[-+(]/.test(lastToken) || /^-/.test(lastToken.replace('$', ''))) return null;

  const normalized = line.replace(/\$/g, '').replace(/,/g, '').replace(/\s+/g, ' ').trim();
  const capOne = normalized.match(/^(\d{1,2}\/\d{1,2})\s+(.+?)\s+(\d+\.\d{2})$/);
  if (capOne) {
    const [month, day] = capOne[1].split('/').map(Number);
    const amount = Number(capOne[3]);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const iso = toIsoDate(month, day, yearForMonth(month, yearInfo));
    return toRow(iso, capOne[2], amount);
  }

  const withYear = normalized.match(/^(\d{1,2}\/\d{1,2})\/(\d{2,4})\s+(.+?)\s+(\d+\.\d{2})$/);
  if (withYear) {
    const [month, day] = withYear[1].split('/').map(Number);
    const amount = Number(withYear[4]);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const iso = toIsoDate(month, day, withYear[2]);
    return toRow(iso, withYear[3], amount);
  }

  const twoDates = normalized.match(/^(\d{1,2}\/\d{1,2})(?:\/\d{2,4})?\s+(\d{1,2}\/\d{1,2})(?:\/\d{2,4})?\s+(.+?)\s+(\d+\.\d{2})$/);
  if (twoDates) {
    const [month, day] = twoDates[1].split('/').map(Number);
    const amount = Number(twoDates[4]);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const iso = toIsoDate(month, day, yearForMonth(month, yearInfo));
    return toRow(iso, twoDates[3], amount);
  }

  return null;
}

function sectionFromLine(line) {
  const text = String(line || '').trim();
  if (/^purchases?\b/i.test(text) || /\bpurchases\s+and\s+adjustments\b/i.test(text)) return 'purchases';
  if (/^credits?\b/i.test(text) || /^payments?\b/i.test(text) || /\bpayments?\s+and\s+credits\b/i.test(text)) return 'skip';
  return null;
}

function stitchCapOneLines(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] || '').replace(/\s+/g, ' ').trim();
    const next = String(lines[i + 1] || '').replace(/\s+/g, ' ').trim();
    if (/^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?$/.test(line) && next) {
      out.push(`${line} ${next}`);
      i += 1;
      continue;
    }
    const stripped = line.replace(/\$/g, '').replace(/,/g, '').trim();
    if (/^\d{1,2}\/\d{1,2}/.test(stripped) && !/\d+\.\d{2}$/.test(stripped) && /^\(?[+-]?\$?\d[\d,]*\.\d{2}\)?$/.test(next)) {
      out.push(`${line} ${next}`);
      i += 1;
      continue;
    }
    out.push(line);
  }
  return out;
}

/** Capital One–first parser: MM/DD + vendor + amount, statement-year dates, skip credits/payments. */
export function parseTransactions(lines) {
  const yearInfo = detectStatementYear(lines);
  const seen = new Set();
  const rows = [];
  let section = 'purchases';

  stitchCapOneLines(lines).forEach((raw) => {
    const line = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!line) return;
    const nextSection = sectionFromLine(line);
    if (nextSection) {
      section = nextSection;
      return;
    }
    if (section === 'skip') return;
    if (looksLikeHeader(line)) return;

    const row = parseCapOneLine(line, yearInfo);
    if (!row) return;
    const key = `${row.date}|${row.amount}|${row.vendor.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  });

  return rows;
}

export function parseStatementLines(lines) {
  const capOne = parseTransactions(lines);
  if (capOne.length) return capOne;

  const yearInfo = detectStatementYear(lines);
  const year = yearInfo.year;
  const seen = new Set();
  const rows = [];

  lines.forEach((line) => {
    if (!line || looksLikeHeader(line)) return;
    if (shouldSkipPurchaseLine(line)) return;
    const dates = extractDates(line, year);
    const amounts = extractAmounts(line);
    if (!dates.length || !amounts.length) return;

    const date = dates[0];
    const lastRaw = String(line).trim().split(/\s+/).pop() || '';
    if (/^[-+(]/.test(lastRaw) || /^-/.test(lastRaw.replace('$', ''))) return;

    const dollarPref = amounts.filter((a) => /\$/.test(a.raw));
    const amountHit = (dollarPref.length ? dollarPref : amounts)[0];
    const vendor = cleanVendorName(cleanVendor(line, dates, amounts));
    if (!vendor || vendor.length < 2) return;
    if (shouldSkipPurchaseLine(vendor)) return;

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
  const fullText = lines.join('\n');
  console.log('=== RAW PDF TEXT ===');
  console.log(fullText);
  console.log('=== END RAW TEXT ===');
  return parseStatementLines(lines);
}
