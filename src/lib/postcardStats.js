export const LEGACY_QR_BATCH_START = '2026-09-30';
export const LEGACY_QR_BATCH_END = '2026-10-09';

export function isLegacyQrBatch(batchId) {
  const id = String(batchId || '');
  return id >= LEGACY_QR_BATCH_START && id <= LEGACY_QR_BATCH_END;
}

export function easternDateKey(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function toDate(value) {
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

export function computeScanTotals(cards, legacyUniqueScans) {
  const list = Array.isArray(cards) ? cards : [];
  const tracked = list.filter((c) => c && c.firstScanAt != null).length;
  const legacy = Number(legacyUniqueScans) || 0;
  const scanned = tracked + legacy;
  const mailed = list.length;
  return {
    tracked,
    legacy,
    scanned,
    mailed,
    scanRate: mailed > 0 ? scanned / mailed : 0,
  };
}

export function lastNDateKeys(n, now = new Date()) {
  const todayKey = easternDateKey(now);
  const [y, m, d] = todayKey.split('-').map(Number);
  const keys = [];
  for (let i = 0; i < n; i++) {
    const utc = new Date(Date.UTC(y, m - 1, d - i, 17, 0, 0));
    keys.push(easternDateKey(utc));
  }
  return keys;
}

export function buildScansByDay({ dailyDocs = [], cards = [], now = new Date(), days = 14 } = {}) {
  const dailyMap = {};
  dailyDocs.forEach((doc) => {
    const id = doc.id || doc.date;
    if (!id) return;
    dailyMap[id] = Number(doc.uniqueScans || 0);
  });

  const trackedMap = {};
  cards.forEach((c) => {
    const dt = toDate(c && c.firstScanAt);
    if (!dt) return;
    const key = easternDateKey(dt);
    trackedMap[key] = (trackedMap[key] || 0) + 1;
  });

  return lastNDateKeys(days, now).map((date) => {
    const tracked = trackedMap[date] || 0;
    const legacy = dailyMap[date] || 0;
    return { date, tracked, legacy, total: tracked + legacy };
  });
}

export function scanCellLabel({ batchId, firstScanAt, formatDate }) {
  if (isLegacyQrBatch(batchId)) return 'Legacy QR';
  if (firstScanAt != null) {
    const when = formatDate ? formatDate(firstScanAt) : '';
    return when ? `Yes ${when}` : 'Yes';
  }
  return 'No';
}

export function batchScanLabel({ batchId, scanCount }) {
  if (isLegacyQrBatch(batchId)) return 'Legacy QR';
  return String(scanCount || 0);
}
