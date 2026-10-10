export const BURNING_BUSH_LINE_ITEMS = [
  { name: 'Home Page', price: 350, included: false },
  { name: 'Contact (page + form)', price: 150, included: false },
  { name: 'About Page', price: 125, included: false },
  { name: 'FAQ Page', price: 100, included: false },
  { name: 'Policies Page', price: 100, included: false },
  { name: 'Online Store — connected to Square', price: 300, included: false },
  { name: 'Classes / Workshops — connected to Square', price: 250, included: false },
  { name: 'Simple Events List', price: 150, included: false },
  { name: 'Blog (page + system)', price: 450, included: false },
  { name: 'Self-Manage Content', price: 400, included: false },
  { name: 'Business Dashboard', price: 500, included: false },
  { name: 'Basic On-Page SEO', price: 200, included: false },
  { name: 'Google Indexing Setup', price: 100, included: false },
  { name: 'Local SEO Setup', price: 175, included: false },
  { name: 'Email Marketing Setup', price: 150, included: false },
  { name: 'Social Media Connections', price: 75, included: false },
  { name: 'Visual Layout Enhancements', price: 250, included: true },
  { name: 'Image Optimization & Cleanup', price: 100, included: true },
];

export function calcRegularTotal(items = []) {
  return items.reduce((sum, item) => {
    if (item.included) return sum;
    const price = Number(item.price);
    return sum + (Number.isFinite(price) ? price : 0);
  }, 0);
}

export function formatMoney(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
