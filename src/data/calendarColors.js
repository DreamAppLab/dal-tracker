export const ACCOUNT_COLORS = [
  { name: 'teal', value: '#00D4B8', dim: 'rgba(0,212,184,0.15)' },
  { name: 'amber', value: '#F59E0B', dim: 'rgba(245,158,11,0.2)' },
  { name: 'purple', value: '#A855F7', dim: 'rgba(168,85,247,0.15)' },
  { name: 'blue', value: '#3B82F6', dim: 'rgba(59,130,246,0.15)' },
];

export function assignAccountColor(existingCount) {
  return ACCOUNT_COLORS[existingCount % ACCOUNT_COLORS.length].name;
}

export function getAccountColorStyle(colorName) {
  const color = ACCOUNT_COLORS.find(c => c.name === colorName) || ACCOUNT_COLORS[0];
  return { color: color.value, background: color.dim };
}
