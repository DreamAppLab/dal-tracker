import React, { useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import ImportStatementModal from '../components/ImportStatementModal';
import {
  CATEGORY_BADGE,
  EXPENSE_APPS,
  EXPENSE_CATEGORIES,
  SORT_OPTIONS,
  SOURCE_META,
  TAX_YEARS,
  formatMoney,
  isValidReceiptFile,
  taxYearFromDate,
  todayISO,
  fileToBase64,
} from '../data/expensesData';

const CURRENT_YEAR = new Date().getFullYear();

function emptyFilters() {
  return {
    taxYear: String(TAX_YEARS.includes(CURRENT_YEAR) ? CURRENT_YEAR : 2026),
    from: '',
    to: '',
    category: '',
    appId: '',
    search: '',
    sort: 'date-desc',
  };
}

function emptyForm() {
  return {
    vendor: '',
    amount: '',
    date: todayISO(),
    category: EXPENSE_CATEGORIES[0],
    appId: EXPENSE_APPS[0],
    notes: '',
    description: '',
  };
}

function formatExpenseDate(value) {
  if (!value) return '—';
  try {
    return format(parseISO(String(value).slice(0, 10)), 'MMM d, yyyy');
  } catch (_) {
    return String(value);
  }
}

function csvEscape(value) {
  const s = String(value == null ? '' : value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function filterSlug(filters) {
  const parts = [`TaxYear${filters.taxYear}`];
  if (filters.appId) parts.push(filters.appId.replace(/\s+/g, ''));
  if (filters.category) parts.push(filters.category.replace(/[^a-zA-Z0-9]+/g, ''));
  if (filters.from || filters.to) parts.push(`${filters.from || 'start'}-to-${filters.to || 'end'}`);
  if (filters.search) parts.push('Search');
  return parts.join('_');
}

function sumAmount(rows) {
  return rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
}

function groupEntries(rows, key) {
  const map = new Map();
  rows.forEach((row) => {
    const name = String(row[key] || '—');
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(row);
  });
  return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

function reportScopeLabel(report) {
  const app = report.appId || 'All Apps';
  const year = report.taxYear || 'All Years';
  return `${app} — ${year}`;
}

function reportTypeLabel(type) {
  if (type === 'category') return 'Category Summary';
  if (type === 'app') return 'App Summary';
  if (type === 'vendor') return 'Vendor Summary';
  return 'Full Expense Report';
}

function filterExpensesForReport(expenses, tabFilters, report) {
  const search = String(tabFilters.search || '').trim().toLowerCase();
  return expenses.filter((row) => {
    if (report.taxYear && String(row.taxYear || taxYearFromDate(row.date)) !== String(report.taxYear)) return false;
    if (report.appId && row.appId !== report.appId) return false;
    if (report.from && String(row.date || '') < report.from) return false;
    if (report.to && String(row.date || '') > report.to) return false;
    if (tabFilters.category && row.category !== tabFilters.category) return false;
    if (search) {
      const vendor = String(row.vendor || '').toLowerCase();
      const description = String(row.description || row.notes || '').toLowerCase();
      if (!vendor.includes(search) && !description.includes(search)) return false;
    }
    return true;
  });
}

function vendorSummaryRows(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const name = String(row.vendor || '—');
    if (!map.has(name)) map.set(name, { vendor: name, count: 0, total: 0 });
    const rec = map.get(name);
    rec.count += 1;
    rec.total += Number(row.amount || 0);
  });
  const grand = sumAmount(rows);
  return Array.from(map.values())
    .sort((a, b) => b.total - a.total)
    .map((rec) => ({
      ...rec,
      pct: grand ? (rec.total / grand) * 100 : 0,
    }));
}

function categoryByAppRows(rows) {
  const apps = groupEntries(rows, 'appId');
  return apps.map(([app, appRows]) => ({
    app,
    categories: groupEntries(appRows, 'category').map(([category, catRows]) => ({
      category,
      count: catRows.length,
      total: sumAmount(catRows),
    })),
    count: appRows.length,
    total: sumAmount(appRows),
  }));
}

function companyCategoryRows(rows) {
  return groupEntries(rows, 'category').map(([category, catRows]) => ({
    category,
    count: catRows.length,
    total: sumAmount(catRows),
  }));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.getAttribute('data-loaded') === '1' || window.docx) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Could not load Word exporter.')));
      return;
    }
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => {
      el.setAttribute('data-loaded', '1');
      resolve();
    };
    el.onerror = () => reject(new Error('Could not load Word exporter.'));
    document.head.appendChild(el);
  });
}

async function loadDocxLib() {
  if (window.docx) return window.docx;
  const urls = [
    'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.min.js',
    'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.iife.js',
    'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js',
  ];
  let lastErr = null;
  for (let i = 0; i < urls.length; i += 1) {
    try {
      await loadScriptOnce(urls[i]);
      if (window.docx) return window.docx;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Could not load Word exporter.');
}

function printStyles(generated) {
  return `
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 36px 48px 64px; font-family: Georgia, "Times New Roman", serif; color: #1a2744; background: #fff; }
    .hdr { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; border-bottom: 2px solid #1a2744; padding-bottom: 12px; margin-bottom: 24px; }
    .brand { font-family: system-ui, Segoe UI, sans-serif; font-size: 26px; font-weight: 800; margin: 0; }
    .sub { font-family: system-ui, Segoe UI, sans-serif; font-size: 16px; margin: 4px 0 0; }
    .meta { font-family: system-ui, Segoe UI, sans-serif; font-size: 13px; color: #334; text-align: right; }
    h2.sec { font-family: system-ui, Segoe UI, sans-serif; font-size: 14px; letter-spacing: 0.04em; text-transform: uppercase; background: #1a2744; color: #fff; padding: 8px 12px; margin: 28px 0 0; }
    table { width: 100%; border-collapse: collapse; margin: 0 0 8px; font-family: system-ui, Segoe UI, sans-serif; font-size: 12px; }
    th, td { padding: 7px 10px; border-bottom: 1px solid #d8dee8; text-align: left; }
    th { background: #1a2744; color: #fff; font-weight: 700; }
    tbody tr:nth-child(even) td { background: #f8f9fa; }
    tbody tr:nth-child(odd) td { background: #fff; }
    .amt { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .subtotal td { font-weight: 700; background: #eef1f6 !important; }
    .grand { margin-top: 28px; padding: 14px 16px; border: 2px solid #1a2744; font-family: system-ui, Segoe UI, sans-serif; font-size: 18px; font-weight: 800; display: flex; justify-content: space-between; }
    .top10 td { background: #eef6ff !important; }
    @media print {
      body { padding: 0; }
      .sec, h2.sec { break-before: page; }
      .sec:first-of-type, h2.sec:first-of-type { break-before: auto; }
      thead { display: table-header-group; }
    }
    @page {
      margin: 0.8in 0.75in 1in;
      @bottom-left { content: "Dream App Lab LLC — Confidential"; font-size: 9px; color: #445; }
      @bottom-center { content: "Page " counter(page) " of " counter(pages); font-size: 9px; color: #445; }
      @bottom-right { content: "${generated}"; font-size: 9px; color: #445; }
    }
  `;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPrintHtml(type, rows, report, generated) {
  const title = reportTypeLabel(type);
  const scope = reportScopeLabel(report);
  const grand = sumAmount(rows);
  let body = '';

  if (type === 'full') {
    groupEntries(rows, 'category').forEach(([category, catRows], idx) => {
      const sorted = [...catRows].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
      body += `<h2 class="sec"${idx === 0 ? ' style="break-before:auto"' : ''}>${escapeHtml(category)}</h2>
        <table><thead><tr><th>Date</th><th>Vendor</th><th>App</th><th class="amt">Amount</th></tr></thead><tbody>`;
      sorted.forEach((row) => {
        body += `<tr><td>${escapeHtml(formatExpenseDate(row.date))}</td><td>${escapeHtml(row.vendor || '—')}</td><td>${escapeHtml(row.appId || '—')}</td><td class="amt">${formatMoney(row.amount)}</td></tr>`;
      });
      body += `<tr class="subtotal"><td colspan="3">Subtotal</td><td class="amt">${formatMoney(sumAmount(catRows))}</td></tr></tbody></table>`;
    });
    body += `<div class="grand"><span>Company-wide total</span><span>${formatMoney(grand)}</span></div>`;
  } else if (type === 'category') {
    const byApp = categoryByAppRows(rows);
    byApp.forEach((block, idx) => {
      body += `<h2 class="sec"${idx === 0 ? ' style="break-before:auto"' : ''}>${escapeHtml(block.app)}</h2>
        <table><thead><tr><th>Category</th><th>Transaction Count</th><th class="amt">Total Amount</th></tr></thead><tbody>`;
      block.categories.forEach((c) => {
        body += `<tr><td>${escapeHtml(c.category)}</td><td>${c.count}</td><td class="amt">${formatMoney(c.total)}</td></tr>`;
      });
      body += `<tr class="subtotal"><td>Subtotal</td><td>${block.count}</td><td class="amt">${formatMoney(block.total)}</td></tr></tbody></table>`;
    });
    body += `<h2 class="sec">Company-Wide Totals</h2>
      <table><thead><tr><th>Category</th><th>Transaction Count</th><th class="amt">Total Amount</th></tr></thead><tbody>`;
    companyCategoryRows(rows).forEach((c) => {
      body += `<tr><td>${escapeHtml(c.category)}</td><td>${c.count}</td><td class="amt">${formatMoney(c.total)}</td></tr>`;
    });
    body += `<tr class="subtotal"><td>Grand total</td><td>${rows.length}</td><td class="amt">${formatMoney(grand)}</td></tr></tbody></table>`;
  } else if (type === 'app') {
    categoryByAppRows(rows).forEach((block, idx) => {
      body += `<h2 class="sec"${idx === 0 ? ' style="break-before:auto"' : ''}>${escapeHtml(block.app)}</h2>
        <table><thead><tr><th>Category</th><th>Count</th><th class="amt">Amount</th></tr></thead><tbody>`;
      block.categories.forEach((c) => {
        body += `<tr><td>${escapeHtml(c.category)}</td><td>${c.count}</td><td class="amt">${formatMoney(c.total)}</td></tr>`;
      });
      body += `<tr class="subtotal"><td>App subtotal</td><td>${block.count}</td><td class="amt">${formatMoney(block.total)}</td></tr></tbody></table>`;
    });
    body += `<div class="grand"><span>Grand total</span><span>${formatMoney(grand)}</span></div>`;
  } else {
    const vendors = vendorSummaryRows(rows);
    body += `<table><thead><tr><th>Vendor</th><th>Transactions</th><th class="amt">Total Spend</th><th class="amt">% of Total</th></tr></thead><tbody>`;
    vendors.forEach((v, i) => {
      body += `<tr class="${i < 10 ? 'top10' : ''}"><td>${escapeHtml(v.vendor)}</td><td>${v.count}</td><td class="amt">${formatMoney(v.total)}</td><td class="amt">${v.pct.toFixed(1)}%</td></tr>`;
    });
    body += `<tr class="subtotal"><td>Grand total</td><td>${rows.length}</td><td class="amt">${formatMoney(grand)}</td><td class="amt">100.0%</td></tr></tbody></table>`;
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
    <style>${printStyles(generated)}</style></head><body>
    <div class="hdr">
      <div>
        <p class="brand">Dream App Lab LLC</p>
        <p class="sub">Expense Report</p>
        <p class="sub">${escapeHtml(title)} — ${escapeHtml(scope)}</p>
      </div>
      <div class="meta">Generated ${escapeHtml(generated)}</div>
    </div>
    ${body}
    <script>window.onload=function(){window.focus();window.print();};</script>
    </body></html>`;
}

function openPrintReport(type, rows, report) {
  const generated = format(new Date(), 'MMM d, yyyy');
  const html = buildPrintHtml(type, rows, report, generated);
  const tab = window.open('', '_blank');
  if (!tab) throw new Error('Pop-up blocked. Allow pop-ups to print the report.');
  tab.document.open();
  tab.document.write(html);
  tab.document.close();
}

function buildReportCsv(type, rows, report) {
  const generated = todayISO();
  const title = reportTypeLabel(type);
  const range = [report.from || 'start', report.to || 'end'].join(' to ');
  const lines = [
    csvEscape(`${title} — ${reportScopeLabel(report)}`),
    csvEscape(`Generated ${generated} · Date range ${range}`),
    '',
  ];
  if (type === 'full') {
    lines.push(['Date', 'Vendor', 'Category', 'App', 'Amount', 'Tax Year', 'Source'].join(','));
    [...rows].sort((a, b) => {
      const c = String(a.category || '').localeCompare(String(b.category || ''));
      if (c) return c;
      return String(a.date || '').localeCompare(String(b.date || ''));
    }).forEach((row) => {
      lines.push([
        csvEscape(row.date || ''),
        csvEscape(row.vendor || ''),
        csvEscape(row.category || ''),
        csvEscape(row.appId || ''),
        csvEscape(Number(row.amount || 0).toFixed(2)),
        csvEscape(row.taxYear || ''),
        csvEscape(row.source || ''),
      ].join(','));
    });
  } else if (type === 'category') {
    lines.push(['Category', 'App', 'Transaction Count', 'Total Amount'].join(','));
    categoryByAppRows(rows).forEach((block) => {
      block.categories.forEach((c) => {
        lines.push([csvEscape(c.category), csvEscape(block.app), c.count, c.total.toFixed(2)].join(','));
      });
    });
  } else if (type === 'app') {
    lines.push(['App', 'Category', 'Transaction Count', 'Total Amount'].join(','));
    categoryByAppRows(rows).forEach((block) => {
      block.categories.forEach((c) => {
        lines.push([csvEscape(block.app), csvEscape(c.category), c.count, c.total.toFixed(2)].join(','));
      });
    });
  } else {
    lines.push(['Vendor', 'Transaction Count', 'Total Spend', '% of Total'].join(','));
    vendorSummaryRows(rows).forEach((v) => {
      lines.push([csvEscape(v.vendor), v.count, v.total.toFixed(2), `${v.pct.toFixed(1)}%`].join(','));
    });
  }
  return lines.join('\n');
}

function dxaCell(docx, text, width, opts) {
  const { Paragraph, TextRun, TableCell, WidthType, AlignmentType, ShadingType } = docx;
  const o = opts || {};
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill } : undefined,
    children: [
      new Paragraph({
        alignment: o.align || AlignmentType.LEFT,
        children: [
          new TextRun({
            text: String(text == null ? '' : text),
            bold: !!o.bold,
            color: o.color || '1A2744',
            size: o.size || 20,
            font: 'Calibri',
          }),
        ],
      }),
    ],
  });
}

function dxaTable(docx, widths, header, bodyRows) {
  const { Table, TableRow, WidthType } = docx;
  const total = widths.reduce((s, w) => s + w, 0);
  const head = new TableRow({
    children: header.map((label, i) => dxaCell(docx, label, widths[i], {
      fill: '1A2744',
      color: 'FFFFFF',
      bold: true,
      align: i === header.length - 1 || label.toLowerCase().includes('amount') || label.includes('%') || label.includes('Spend') ? docx.AlignmentType.RIGHT : docx.AlignmentType.LEFT,
    })),
  });
  const rows = bodyRows.map((cells, r) => new TableRow({
    children: cells.map((cell, i) => dxaCell(docx, cell.text, widths[i], {
      fill: cell.fill || (r % 2 === 1 ? 'F8F9FA' : 'FFFFFF'),
      bold: !!cell.bold,
      align: cell.align,
    })),
  }));
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: widths,
    rows: [head, ...rows],
  });
}

async function downloadWordReport(type, rows, report) {
  const docx = await loadDocxLib();
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak, Footer, PageNumber,
  } = docx;
  const generated = format(new Date(), 'MMM d, yyyy');
  const title = reportTypeLabel(type);
  const scope = reportScopeLabel(report);
  const grand = sumAmount(rows);
  const children = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: 'Dream App Lab LLC', bold: true, size: 56, font: 'Calibri', color: '1A2744' })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: 'EXPENSE REPORT', bold: true, size: 36, font: 'Calibri', color: '00B5A4' })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: `${title} — ${scope}`, size: 24, font: 'Calibri', color: '1A2744' })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 }, children: [new TextRun({ text: `Generated: ${generated}`, size: 22, font: 'Calibri', color: '334155' })] }),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  if (type === 'full' || type === 'category') {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Contents', bold: true })] }));
    const tocItems = type === 'full'
      ? groupEntries(rows, 'category').map(([name]) => name)
      : ['By app', 'Company-wide totals'];
    tocItems.forEach((name) => {
      children.push(new Paragraph({
        spacing: { after: 80 },
        children: [new TextRun({ text: `${name} .......... see section below`, font: 'Calibri', size: 22 })],
      }));
    });
    children.push(new Paragraph({ children: [new PageBreak()] }));
  }

  const txWidths = [1440, 6480, 2160, 1880];
  const sumWidths = [5000, 2800, 4160];
  const vendorWidths = [5000, 2160, 2400, 2400];

  if (type === 'full') {
    groupEntries(rows, 'category').forEach(([category, catRows], idx) => {
      if (idx > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: category, bold: true })] }));
      const sorted = [...catRows].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
      const body = sorted.map((row) => ([
        { text: formatExpenseDate(row.date) },
        { text: row.vendor || '—' },
        { text: row.appId || '—' },
        { text: formatMoney(row.amount), align: AlignmentType.RIGHT },
      ]));
      body.push([
        { text: 'Subtotal', bold: true, fill: 'EEF1F6' },
        { text: '', bold: true, fill: 'EEF1F6' },
        { text: '', bold: true, fill: 'EEF1F6' },
        { text: formatMoney(sumAmount(catRows)), bold: true, align: AlignmentType.RIGHT, fill: 'EEF1F6' },
      ]);
      children.push(dxaTable(docx, txWidths, ['Date', 'Vendor', 'App', 'Amount'], body));
    });
    children.push(new Paragraph({ spacing: { before: 400 }, children: [new TextRun({ text: `Company-wide total: ${formatMoney(grand)}`, bold: true, size: 28 })] }));
  } else if (type === 'category') {
    categoryByAppRows(rows).forEach((block, idx) => {
      if (idx > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: block.app, bold: true })] }));
      const body = block.categories.map((c) => ([
        { text: c.category },
        { text: String(c.count) },
        { text: formatMoney(c.total), align: AlignmentType.RIGHT },
      ]));
      body.push([
        { text: 'Subtotal', bold: true, fill: 'EEF1F6' },
        { text: String(block.count), bold: true, fill: 'EEF1F6' },
        { text: formatMoney(block.total), bold: true, align: AlignmentType.RIGHT, fill: 'EEF1F6' },
      ]);
      children.push(dxaTable(docx, sumWidths, ['Category', 'Transaction Count', 'Total Amount'], body));
    });
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Company-Wide Totals', bold: true })] }));
    const company = companyCategoryRows(rows).map((c) => ([
      { text: c.category },
      { text: String(c.count) },
      { text: formatMoney(c.total), align: AlignmentType.RIGHT },
    ]));
    company.push([
      { text: 'Grand total', bold: true, fill: 'EEF1F6' },
      { text: String(rows.length), bold: true, fill: 'EEF1F6' },
      { text: formatMoney(grand), bold: true, align: AlignmentType.RIGHT, fill: 'EEF1F6' },
    ]);
    children.push(dxaTable(docx, sumWidths, ['Category', 'Transaction Count', 'Total Amount'], company));
  } else if (type === 'app') {
    categoryByAppRows(rows).forEach((block, idx) => {
      if (idx > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: block.app, bold: true })] }));
      const body = block.categories.map((c) => ([
        { text: c.category },
        { text: String(c.count) },
        { text: formatMoney(c.total), align: AlignmentType.RIGHT },
      ]));
      body.push([
        { text: 'App subtotal', bold: true, fill: 'EEF1F6' },
        { text: String(block.count), bold: true, fill: 'EEF1F6' },
        { text: formatMoney(block.total), bold: true, align: AlignmentType.RIGHT, fill: 'EEF1F6' },
      ]);
      children.push(dxaTable(docx, sumWidths, ['Category', 'Count', 'Amount'], body));
    });
    children.push(new Paragraph({ spacing: { before: 400 }, children: [new TextRun({ text: `Grand total: ${formatMoney(grand)}`, bold: true, size: 28 })] }));
  } else {
    const vendors = vendorSummaryRows(rows);
    const body = vendors.map((v, i) => ([
      { text: v.vendor, fill: i < 10 ? 'EEF6FF' : undefined },
      { text: String(v.count), fill: i < 10 ? 'EEF6FF' : undefined },
      { text: formatMoney(v.total), align: AlignmentType.RIGHT, fill: i < 10 ? 'EEF6FF' : undefined },
      { text: `${v.pct.toFixed(1)}%`, align: AlignmentType.RIGHT, fill: i < 10 ? 'EEF6FF' : undefined },
    ]));
    body.push([
      { text: 'Grand total', bold: true, fill: 'EEF1F6' },
      { text: String(rows.length), bold: true, fill: 'EEF1F6' },
      { text: formatMoney(grand), bold: true, align: AlignmentType.RIGHT, fill: 'EEF1F6' },
      { text: '100.0%', bold: true, align: AlignmentType.RIGHT, fill: 'EEF1F6' },
    ]);
    children.push(dxaTable(docx, vendorWidths, ['Vendor', 'Transactions', 'Total Spend', '% of Total'], body));
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } },
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: 'Dream App Lab LLC — Confidential', size: 16, font: 'Calibri', color: '444455' }),
                new TextRun({ text: '     Page ', size: 16, font: 'Calibri', color: '444455' }),
                new TextRun({ children: [PageNumber.CURRENT], size: 16, font: 'Calibri', color: '444455' }),
                new TextRun({ text: `     ${generated}`, size: 16, font: 'Calibri', color: '444455' }),
              ],
            }),
          ],
        }),
      },
      children,
    }],
  });

  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, `DAL_${title.replace(/\s+/g, '_')}_${todayISO()}.docx`);
}

async function apiJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.detail || 'Request failed');
  return data;
}

function ExpenseFormModal({ expense, onClose, onSaved }) {
  const [form, setForm] = useState(() => {
    if (!expense) return emptyForm();
    return {
      vendor: expense.vendor || '',
      amount: expense.amount == null ? '' : String(expense.amount),
      date: expense.date || todayISO(),
      category: expense.category || EXPENSE_CATEGORIES[0],
      appId: expense.appId || EXPENSE_APPS[0],
      notes: expense.notes || expense.description || '',
      description: expense.description || expense.notes || '',
    };
  });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const isEdit = Boolean(expense && expense.id);

  const handleFile = (next) => {
    if (!next) {
      setFile(null);
      return;
    }
    if (!isValidReceiptFile(next)) {
      setError('Receipt must be a PDF, JPG, or PNG.');
      return;
    }
    if (next.size > 4 * 1024 * 1024) {
      setError('Receipt must be 4MB or smaller.');
      return;
    }
    setError('');
    setFile(next);
  };

  const handleSave = async () => {
    const vendor = form.vendor.trim();
    const amount = Number(form.amount);
    if (!vendor) {
      setError('Vendor is required.');
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      setError('Amount is required.');
      return;
    }
    if (!form.date) {
      setError('Date is required.');
      return;
    }
    if (!form.category || !form.appId) {
      setError('Category and App are required.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const notes = (form.notes || form.description || '').trim();
      const payload = {
        vendor,
        amount,
        date: form.date,
        category: form.category,
        appId: form.appId,
        notes,
        description: notes,
        taxYear: taxYearFromDate(form.date),
      };

      if (file) {
        payload.attachmentBase64 = await fileToBase64(file);
        payload.attachmentName = file.name;
        payload.attachmentType = file.type || 'application/octet-stream';
      }

      if (isEdit) {
        await updateDoc(doc(db, 'expenses', expense.id), {
          vendor: payload.vendor,
          amount: payload.amount,
          date: payload.date,
          category: payload.category,
          appId: payload.appId,
          notes: payload.notes,
          description: payload.description,
          taxYear: payload.taxYear,
          needsReview: false,
          updatedAt: serverTimestamp(),
        });
      } else {
        payload.source = 'manual';
        payload.parsedByAI = false;
        payload.needsReview = false;
        await apiJson('/api/expenses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      onSaved();
    } catch (err) {
      setError(err.message || 'Could not save expense.');
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{isEdit ? 'Edit Expense' : 'Add Expense'}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={saving}>✕</button>
        </div>
        <div className="modal-body">
          {expense && expense.needsReview && (
            <div className="expenses-review-banner">
              This expense was parsed from email and needs review. Confirm the fields and save.
            </div>
          )}
          {isEdit ? (
            <>
              <div className="form-group">
                <label className="form-label">Date *</label>
                <input
                  className="form-input"
                  type="date"
                  value={form.date}
                  onChange={(e) => set('date', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Vendor *</label>
                <input
                  className="form-input"
                  value={form.vendor}
                  onChange={(e) => set('vendor', e.target.value)}
                  placeholder="e.g. Firebase, Apple Developer, Starbucks"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Amount *</label>
                <input
                  className="form-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => set('amount', e.target.value)}
                  placeholder="25.00"
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Category *</label>
                  <select className="form-select" value={form.category} onChange={(e) => set('category', e.target.value)}>
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">App *</label>
                  <select className="form-select" value={form.appId} onChange={(e) => set('appId', e.target.value)}>
                    {EXPENSE_APPS.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Notes</label>
                <input
                  className="form-input"
                  value={form.notes}
                  onChange={(e) => set('notes', e.target.value)}
                  placeholder="Optional note"
                />
              </div>
            </>
          ) : (
            <>
          <div className="form-group">
            <label className="form-label">Vendor *</label>
            <input
              className="form-input"
              value={form.vendor}
              onChange={(e) => set('vendor', e.target.value)}
              placeholder="e.g. Firebase, Apple Developer, Starbucks"
            />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Amount *</label>
              <input
                className="form-input"
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => set('amount', e.target.value)}
                placeholder="25.00"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Date *</label>
              <input
                className="form-input"
                type="date"
                value={form.date}
                onChange={(e) => set('date', e.target.value)}
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Category *</label>
              <select className="form-select" value={form.category} onChange={(e) => set('category', e.target.value)}>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">App *</label>
              <select className="form-select" value={form.appId} onChange={(e) => set('appId', e.target.value)}>
                {EXPENSE_APPS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea
              className="form-textarea"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Optional note"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Receipt (PDF, JPG, PNG)</label>
            <input
              className="form-input"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              onChange={(e) => handleFile(e.target.files && e.target.files[0])}
            />
            {file && <div className="expenses-file-name">{file.name}</div>}
            {!file && expense && expense.attachmentUrl && (
              <a className="expenses-receipt-link" href={expense.attachmentUrl} target="_blank" rel="noreferrer">
                Current receipt
              </a>
            )}
          </div>
            </>
          )}
          {error && <div className="ft-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : (isEdit ? 'Save Changes' : 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReportsModal({ expenses, tabFilters, onClose }) {
  const [type, setType] = useState('full');
  const [format, setFormat] = useState('print');
  const [taxYear, setTaxYear] = useState(tabFilters.taxYear || '');
  const [appId, setAppId] = useState(tabFilters.appId || '');
  const [from, setFrom] = useState(tabFilters.from || '');
  const [to, setTo] = useState(tabFilters.to || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const report = { taxYear, appId, from, to };
  const rows = useMemo(
    () => filterExpensesForReport(expenses, tabFilters, report),
    [expenses, tabFilters, taxYear, appId, from, to]
  );

  const generate = async () => {
    if (!rows.length) {
      setError('No expenses match these report filters.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (format === 'print') {
        openPrintReport(type, rows, report);
      } else if (format === 'csv') {
        const csv = buildReportCsv(type, rows, report);
        downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `DAL_${reportTypeLabel(type).replace(/\s+/g, '_')}_${todayISO()}.csv`);
      } else {
        await downloadWordReport(type, rows, report);
      }
      onClose();
    } catch (err) {
      setError(err.message || 'Could not generate report.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="modal-header">
          <div className="modal-title">Reports</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Report type</label>
            {[
              ['full', 'Full Expense Report — every transaction, sorted by category then date'],
              ['category', 'Category Summary — totals per category per app + company-wide totals'],
              ['app', 'App Summary — totals per app broken down by category'],
              ['vendor', 'Vendor Summary — top vendors by spend, with transaction count'],
            ].map(([value, label]) => (
              <label key={value} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8, fontSize: 13, color: 'var(--text-primary)' }}>
                <input type="radio" name="report-type" checked={type === value} onChange={() => setType(value)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Tax Year</label>
              <select className="form-select" value={taxYear} onChange={(e) => setTaxYear(e.target.value)}>
                {TAX_YEARS.map((y) => (
                  <option key={y} value={String(y)}>{y}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">App</label>
              <select className="form-select" value={appId} onChange={(e) => setAppId(e.target.value)}>
                <option value="">All Apps</option>
                {EXPENSE_APPS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">From (optional)</label>
              <input className="form-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">To (optional)</label>
              <input className="form-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Format</label>
            {[
              ['print', 'Print / PDF — opens a print-optimized page in a new tab'],
              ['csv', 'CSV — downloads a spreadsheet'],
              ['docx', 'Word (.docx) — downloads a formatted Word document'],
            ].map(([value, label]) => (
              <label key={value} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8, fontSize: 13, color: 'var(--text-primary)' }}>
                <input type="radio" name="report-format" checked={format === value} onChange={() => setFormat(value)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {rows.length} expense{rows.length === 1 ? '' : 's'} in this report · {formatMoney(sumAmount(rows))}
          </div>
          {error && <div className="ft-error" style={{ marginTop: 12 }}>{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={generate} disabled={busy}>
            {busy ? 'Generating…' : 'Generate Report'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ExpensesTab() {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(emptyFilters);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const [viewSort, setViewSort] = useState('date');
  const [editing, setEditing] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'expenses'),
      (snapshot) => {
        setExpenses(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, []);

  const yearBounds = useMemo(() => {
    const y = filters.taxYear;
    return { min: `${y}-01-01`, max: `${y}-12-31` };
  }, [filters.taxYear]);

  const setFilter = (key, value) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'taxYear') {
        if (next.from && !next.from.startsWith(value)) next.from = '';
        if (next.to && !next.to.startsWith(value)) next.to = '';
      }
      return next;
    });
  };

  const filtered = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    const rows = expenses.filter((row) => {
      if (filters.taxYear && String(row.taxYear || taxYearFromDate(row.date)) !== String(filters.taxYear)) {
        return false;
      }
      if (filters.category && row.category !== filters.category) return false;
      if (filters.appId && row.appId !== filters.appId) return false;
      if (filters.from && String(row.date || '') < filters.from) return false;
      if (filters.to && String(row.date || '') > filters.to) return false;
      if (search) {
        const vendor = String(row.vendor || '').toLowerCase();
        const description = String(row.description || '').toLowerCase();
        if (!vendor.includes(search) && !description.includes(search)) return false;
      }
      return true;
    });

    rows.sort((a, b) => {
      if (viewSort === 'vendor') return String(a.vendor || '').localeCompare(String(b.vendor || ''));
      if (viewSort === 'category') {
        const c = String(a.category || '').localeCompare(String(b.category || ''));
        if (c) return c;
        return String(b.date || '').localeCompare(String(a.date || ''));
      }
      if (viewSort === 'app') {
        const c = String(a.appId || '').localeCompare(String(b.appId || ''));
        if (c) return c;
        return String(b.date || '').localeCompare(String(a.date || ''));
      }
      if (filters.sort === 'date-asc') return String(a.date || '').localeCompare(String(b.date || ''));
      if (filters.sort === 'amount-desc') return Number(b.amount || 0) - Number(a.amount || 0);
      if (filters.sort === 'amount-asc') return Number(a.amount || 0) - Number(b.amount || 0);
      if (filters.sort === 'vendor-asc') return String(a.vendor || '').localeCompare(String(b.vendor || ''));
      return String(b.date || '').localeCompare(String(a.date || ''));
    });

    return rows;
  }, [expenses, filters, viewSort]);

  const groupedView = useMemo(() => {
    if (viewSort === 'category') return groupEntries(filtered, 'category');
    if (viewSort === 'app') return groupEntries(filtered, 'appId');
    return null;
  }, [filtered, viewSort]);

  const total = filtered.reduce((sum, row) => sum + Number(row.amount || 0), 0);

  const exportCsv = () => {
    const header = ['Date', 'Vendor', 'Category', 'App', 'Amount', 'Description', 'Source', 'Tax Year'];
    const lines = [header.join(',')];
    filtered.forEach((row) => {
      lines.push([
        csvEscape(row.date || ''),
        csvEscape(row.vendor || ''),
        csvEscape(row.category || ''),
        csvEscape(row.appId || ''),
        csvEscape(Number(row.amount || 0).toFixed(2)),
        csvEscape(row.description || ''),
        csvEscape(row.source || ''),
        csvEscape(row.taxYear || ''),
      ].join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `DAL_Expenses_${filterSlug(filters)}_${todayISO()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const confirmDelete = async (row) => {
    if (!row || !row.id) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteDoc(doc(db, 'expenses', row.id));
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(err.message || 'Could not delete expense.');
    } finally {
      setDeleting(false);
    }
  };

  const renderExpenseRow = (row) => {
    const badge = CATEGORY_BADGE[row.category] || CATEGORY_BADGE.Other;
    const source = SOURCE_META[row.source] || SOURCE_META.manual;
    return (
      <tr key={row.id} className={row.needsReview ? 'expenses-row-review' : ''}>
        <td>{formatExpenseDate(row.date)}</td>
        <td>
          <div className="expenses-vendor">{row.vendor || '—'}</div>
          {row.needsReview && <span className="expenses-review-badge">Needs review</span>}
        </td>
        <td>
          <span className="expenses-cat-badge" style={{ color: badge.color, background: badge.bg }}>
            {row.category || '—'}
          </span>
        </td>
        <td>{row.appId || '—'}</td>
        <td className="expenses-amount-col">{formatMoney(row.amount)}</td>
        <td>
          <span className="expenses-source" title={source.label}>
            {source.icon}
            {row.attachmentUrl && (
              <a href={row.attachmentUrl} target="_blank" rel="noreferrer" title="Open receipt">📎</a>
            )}
          </span>
        </td>
        <td>
          {pendingDelete && pendingDelete.id === row.id ? (
            <div className="item-actions" style={{ flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                Delete this expense?
              </span>
              <button
                className="btn btn-sm btn-danger"
                disabled={deleting}
                onClick={() => confirmDelete(row)}
              >
                {deleting ? 'Deleting…' : 'Yes, Delete'}
              </button>
              <button
                className="btn btn-sm btn-secondary"
                disabled={deleting}
                onClick={() => { setPendingDelete(null); setDeleteError(''); }}
              >
                Cancel
              </button>
              {deleteError && (
                <span className="ft-error" style={{ width: '100%', margin: 0 }}>{deleteError}</span>
              )}
            </div>
          ) : (
            <div className="item-actions">
              <button
                className="icon-btn"
                title="Edit"
                onClick={() => { setEditing(row); setShowForm(true); }}
              >
                ✎
              </button>
              <button
                className="icon-btn danger"
                title="Delete"
                onClick={() => { setDeleteError(''); setPendingDelete(row); }}
              >
                🗑
              </button>
            </div>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="page expenses-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Expenses</h1>
          <p className="page-subtitle">
            Track receipts for tax time. Forward to expenses@inbound.dreamapplab.com or add them here.
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setShowReports(true)} disabled={!filtered.length}>
            📄 Reports
          </button>
          <button className="btn btn-secondary" onClick={exportCsv} disabled={!filtered.length}>
            Export
          </button>
          <button className="btn btn-secondary" onClick={() => setShowImport(true)}>
            Import Statement
          </button>
          <button className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>
            + Add Expense
          </button>
        </div>
      </div>

      <div className="expenses-filters">
        <div className="form-group">
          <label className="form-label">Tax Year</label>
          <select className="form-select" value={filters.taxYear} onChange={(e) => setFilter('taxYear', e.target.value)}>
            {TAX_YEARS.map((y) => (
              <option key={y} value={String(y)}>{y}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">From</label>
          <input
            className="form-input"
            type="date"
            min={yearBounds.min}
            max={yearBounds.max}
            value={filters.from}
            onChange={(e) => setFilter('from', e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label">To</label>
          <input
            className="form-input"
            type="date"
            min={yearBounds.min}
            max={yearBounds.max}
            value={filters.to}
            onChange={(e) => setFilter('to', e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Category</label>
          <select className="form-select" value={filters.category} onChange={(e) => setFilter('category', e.target.value)}>
            <option value="">All</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">App</label>
          <select className="form-select" value={filters.appId} onChange={(e) => setFilter('appId', e.target.value)}>
            <option value="">All</option>
            {EXPENSE_APPS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <div className="form-group expenses-search">
          <label className="form-label">Search</label>
          <input
            className="form-input"
            value={filters.search}
            onChange={(e) => setFilter('search', e.target.value)}
            placeholder="Vendor or description"
          />
        </div>
        <div className="form-group">
          <label className="form-label">Sort by</label>
          <select className="form-select" value={filters.sort} onChange={(e) => setFilter('sort', e.target.value)}>
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="form-group expenses-clear">
          <button className="btn btn-secondary" onClick={() => setFilters(emptyFilters())}>
            Clear filters
          </button>
        </div>
      </div>

      <div className="expenses-summary">
        <div>
          Total expenses for current filter: <strong>{formatMoney(total)}</strong>
        </div>
        <div>
          Number of expenses: <strong>{filtered.length}</strong> {filtered.length === 1 ? 'item' : 'items'}
        </div>
        {filters.appId && (
          <div>Showing {filtered.length} expenses for {filters.appId}</div>
        )}
        {filters.taxYear && (
          <div>Tax Year {filters.taxYear} — Total: {formatMoney(total)}</div>
        )}
      </div>

      <div className="expenses-sort-bar" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <span className="form-label" style={{ margin: 0 }}>Sort</span>
        {[
          ['date', 'By Date'],
          ['category', 'By Category'],
          ['vendor', 'By Vendor'],
          ['app', 'By App'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`btn btn-sm ${viewSort === value ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setViewSort(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="quotes-table-wrap expenses-table-wrap">
        {loading ? (
          <div className="empty-state">Loading expenses…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🧾</div>
            <div className="empty-state-text">No expenses match these filters.</div>
          </div>
        ) : (
          <table className="quotes-table expenses-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Vendor</th>
                <th>Category</th>
                <th>App</th>
                <th className="expenses-amount-col">Amount</th>
                <th>Source</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {groupedView
                ? groupedView.map(([name, groupRows]) => (
                  <React.Fragment key={name}>
                    <tr className="expenses-group-header">
                      <td colSpan={7} style={{ fontWeight: 800, background: 'rgba(255,255,255,0.06)', letterSpacing: '0.03em' }}>
                        {name}
                      </td>
                    </tr>
                    {groupRows.map((row) => renderExpenseRow(row))}
                    <tr className="expenses-subtotal-row">
                      <td colSpan={4} />
                      <td className="expenses-amount-col" style={{ fontWeight: 800 }}>
                        Subtotal: {formatMoney(sumAmount(groupRows))}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </React.Fragment>
                ))
                : filtered.map((row) => renderExpenseRow(row))}
            </tbody>
          </table>
        )}
      </div>

      {showForm && (
        <ExpenseFormModal
          expense={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); }}
        />
      )}

      {showImport && (
        <ImportStatementModal
          onClose={() => setShowImport(false)}
          onManualEntry={() => {
            setShowImport(false);
            setEditing(null);
            setShowForm(true);
          }}
        />
      )}

      {showReports && (
        <ReportsModal
          expenses={expenses}
          tabFilters={filters}
          onClose={() => setShowReports(false)}
        />
      )}
    </div>
  );
}
