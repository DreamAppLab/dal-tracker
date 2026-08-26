export const EXPENSE_CATEGORIES = [
  'Advertising & Marketing',
  'App Store Fees',
  'Domain & Hosting',
  'Hardware & Equipment',
  'Other',
  'Professional Services',
  'Software & Subscriptions',
  'Travel & Meals',
  'Utilities',
];

export const EXPENSE_APPS = [
  'DAL General',
  'FamilyLens',
  'FamilyThread',
  'Flarepad',
  'Logabode',
  'MyClassLog',
  'RV Vault',
  'Ten Miles Ahead',
  'The Shady Duck',
  'TravelWhirl',
];

export const TAX_YEARS = [2024, 2025, 2026, 2027];

export const SORT_OPTIONS = [
  { value: 'date-desc', label: 'Date (newest first)' },
  { value: 'date-asc', label: 'Date (oldest first)' },
  { value: 'amount-desc', label: 'Amount (highest first)' },
  { value: 'amount-asc', label: 'Amount (lowest first)' },
  { value: 'vendor-asc', label: 'Vendor (A-Z)' },
];

export const SOURCE_META = {
  email: { icon: '✉️', label: 'Email' },
  manual: { icon: '✏️', label: 'Manual' },
  pdf: { icon: '📄', label: 'PDF' },
  image: { icon: '🖼️', label: 'Image' },
  import: { icon: '📥', label: 'Import' },
};

export const CATEGORY_BADGE = {
  'Advertising & Marketing': { color: '#F59E0B', bg: 'rgba(245,158,11,0.18)' },
  'App Store Fees': { color: '#A855F7', bg: 'rgba(168,85,247,0.18)' },
  'Domain & Hosting': { color: '#3B82F6', bg: 'rgba(59,130,246,0.18)' },
  'Hardware & Equipment': { color: '#64748B', bg: 'rgba(100,116,139,0.22)' },
  'Other': { color: '#94A3B8', bg: 'rgba(148,163,184,0.18)' },
  'Professional Services': { color: '#14B8A6', bg: 'rgba(20,184,166,0.18)' },
  'Software & Subscriptions': { color: '#22C55E', bg: 'rgba(34,197,94,0.18)' },
  'Travel & Meals': { color: '#F97316', bg: 'rgba(249,115,22,0.18)' },
  'Utilities': { color: '#06B6D4', bg: 'rgba(6,182,212,0.18)' },
};

const RECEIPT_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
const RECEIPT_EXTS = ['pdf', 'jpg', 'jpeg', 'png'];

export function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function taxYearFromDate(dateStr) {
  const year = Number(String(dateStr || '').slice(0, 4));
  return Number.isFinite(year) && year > 1900 ? year : new Date().getFullYear();
}

export function formatMoney(amount) {
  return '$' + Number(amount || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function isValidReceiptFile(file) {
  if (!file) return false;
  if (RECEIPT_TYPES.includes(file.type)) return true;
  const ext = file.name.split('.').pop()?.toLowerCase();
  return RECEIPT_EXTS.includes(ext);
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Could not read receipt file.'));
    reader.readAsDataURL(file);
  });
}
