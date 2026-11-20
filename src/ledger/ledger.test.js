import { parseStatementLines } from './import/capOnePdf';
import { lineFromPick, pickFromLine, pickFromTxn } from './ui';
import * as core from './core';

test('Capital One PDF lines: charges, payments/credits and Dec→Jan years', () => {
  const lines = [
    'Capital One Spark',
    'Dec 15, 2025 - Jan 14, 2026',
    'EDDIE SKEHAN #1234: Transactions',
    'Trans Date Post Date Description Amount',
    'Dec 20 Dec 21 VERCEL INC. $20.00',
    'Jan 3 Jan 4 GITHUB $4.00',
    'EDDIE SKEHAN #1234: Total Transactions $24.00',
    'EDDIE SKEHAN #1234: Payments, Credits and Adjustments',
    'Jan 5 Jan 5 CAPITAL ONE AUTOPAY PYMT - $500.00',
    'EDDIE SKEHAN #1234: Total Payments, Credits and Adjustments -$500.00',
  ];
  const rows = parseStatementLines(lines);
  const ledgerRows = core.fromCapOnePdfRows(rows);
  expect(ledgerRows).toEqual([
    { date: '2025-12-20', payee: 'VERCEL INC.', memo: '', amountCents: -2000 },
    { date: '2026-01-03', payee: 'GITHUB', memo: '', amountCents: -400 },
    { date: '2026-01-05', payee: 'CAPITAL ONE AUTOPAY PYMT', memo: 'Payment / credit', amountCents: 50000 },
  ]);
  expect(core.isLikelyCardPayment(ledgerRows[2], 'credit_card')).toBe(true);
});

test('category picker values round-trip to line fields', () => {
  expect(lineFromPick('cat:dal_cat_software', 'dal')).toEqual({ categoryId: 'dal_cat_software', transferAccountId: null, icCategoryId: null });
  expect(lineFromPick('xfer:dal_card', 'dal')).toEqual({ categoryId: null, transferAccountId: 'dal_card', icCategoryId: null });
  expect(lineFromPick('ic:zerbiq_cat_supabase', 'dal')).toEqual({ categoryId: null, transferAccountId: 'dal_ic_zerbiq', icCategoryId: 'zerbiq_cat_supabase' });
  expect(lineFromPick('ic:', 'zerbiq')).toEqual({ categoryId: null, transferAccountId: 'zerbiq_ic_dal', icCategoryId: null });
  expect(lineFromPick('', 'dal')).toEqual({ categoryId: null, transferAccountId: null, icCategoryId: null });
  for (const v of ['cat:dal_cat_software', 'xfer:dal_card', 'ic:zerbiq_cat_supabase', '']) {
    expect(pickFromLine(lineFromPick(v, 'dal'))).toBe(v);
  }
  expect(pickFromTxn({ splits: [{}, {}] })).toBe('split');
});
