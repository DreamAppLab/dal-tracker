import {
  batchScanLabel,
  buildScansByDay,
  computeScanTotals,
  easternDateKey,
  isLegacyQrBatch,
  lastNDateKeys,
  scanCellLabel,
} from './postcardStats';

describe('postcard scan totals', () => {
  const cards = [
    { id: 'a', firstScanAt: '2026-10-08T15:00:00Z', batchId: '2026-10-10' },
    { id: 'b', firstScanAt: null, batchId: '2026-10-01' },
    { id: 'c', batchId: '2026-10-01' },
    { id: 'd', firstScanAt: { seconds: 1759900000 }, batchId: '2026-10-10' },
  ];

  test('scanned = tracked firstScanAt + legacy uniqueScans', () => {
    const t = computeScanTotals(cards, 7);
    expect(t.tracked).toBe(2);
    expect(t.legacy).toBe(7);
    expect(t.scanned).toBe(9);
    expect(t.mailed).toBe(4);
    expect(t.scanRate).toBeCloseTo(9 / 4);
  });

  test('scan rate is total scanned / real cards mailed', () => {
    expect(computeScanTotals([], 5)).toEqual({
      tracked: 0,
      legacy: 5,
      scanned: 5,
      mailed: 0,
      scanRate: 0,
    });
  });
});

describe('legacy QR batches Sept 30–Oct 9', () => {
  test('flags the static-QR window and leaves later batches alone', () => {
    expect(isLegacyQrBatch('2026-09-30')).toBe(true);
    expect(isLegacyQrBatch('2026-10-09')).toBe(true);
    expect(isLegacyQrBatch('2026-10-01')).toBe(true);
    expect(isLegacyQrBatch('2026-10-10')).toBe(false);
    expect(isLegacyQrBatch('2026-09-29')).toBe(false);
  });

  test('per-batch and per-card cells say Legacy QR instead of 0 or No', () => {
    expect(batchScanLabel({ batchId: '2026-10-02', scanCount: 0 })).toBe('Legacy QR');
    expect(batchScanLabel({ batchId: '2026-10-10', scanCount: 0 })).toBe('0');
    expect(batchScanLabel({ batchId: '2026-10-10', scanCount: 3 })).toBe('3');
    expect(scanCellLabel({ batchId: '2026-09-30', firstScanAt: null })).toBe('Legacy QR');
    expect(scanCellLabel({ batchId: '2026-10-10', firstScanAt: null })).toBe('No');
    expect(scanCellLabel({ batchId: '2026-10-10', firstScanAt: '2026-10-11', formatDate: () => 'Oct 11' })).toBe('Yes Oct 11');
  });
});

describe('scans by day', () => {
  test('merges last 14 daily docs with tracked firstScanAt dates', () => {
    const now = new Date('2026-10-09T18:00:00-04:00');
    const today = easternDateKey(now);
    const rows = buildScansByDay({
      now,
      days: 14,
      dailyDocs: [
        { id: today, uniqueScans: 4 },
        { id: '2026-10-08', uniqueScans: 1 },
      ],
      cards: [
        { firstScanAt: '2026-10-09T12:00:00-04:00' },
        { firstScanAt: '2026-10-09T20:00:00-04:00' },
        { firstScanAt: '2026-10-07T09:00:00-04:00' },
      ],
    });
    expect(rows).toHaveLength(14);
    expect(rows[0].date).toBe(today);
    expect(rows[0].legacy).toBe(4);
    expect(rows[0].tracked).toBe(2);
    expect(rows[0].total).toBe(6);
    const oct8 = rows.find((r) => r.date === '2026-10-08');
    expect(oct8.legacy).toBe(1);
    expect(oct8.tracked).toBe(0);
    const oct7 = rows.find((r) => r.date === '2026-10-07');
    expect(oct7.tracked).toBe(1);
    expect(lastNDateKeys(14, now)[13]).toBe('2026-09-26');
  });
});
