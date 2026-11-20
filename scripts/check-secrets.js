#!/usr/bin/env node
// Build guard: fails the Vercel build if a secret could reach the browser.
//
//   node scripts/check-secrets.js src     — before the build: source rules
//   node scripts/check-secrets.js bundle  — after the build: scan build/ output
//
// Why: Create React App inlines REACT_APP_* variables into the public
// JavaScript bundle, and a dynamic `process.env[name]` lookup inlines ALL of
// them. That is how ~20 provider keys ended up public in Nov 2026.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// REACT_APP_* names that are public by design (Firebase web config, URLs).
const PUBLIC_REACT_APP = [
  /^REACT_APP_FT_(API_KEY|AUTH_DOMAIN|PROJECT_ID|STORAGE_BUCKET|MESSAGING_SENDER_ID|APP_ID)$/,
  /^REACT_APP_ZERBIQ_FIREBASE_(API_KEY|AUTH_DOMAIN|PROJECT_ID|STORAGE_BUCKET|MESSAGING_SENDER_ID|APP_ID)$/,
  /^REACT_APP_DAL_SITE_FIREBASE_(API_KEY|AUTH_DOMAIN|PROJECT_ID|STORAGE_BUCKET|MESSAGING_SENDER_ID|APP_ID)$/,
  /^REACT_APP_DAL_SITE_URL$/,
  /^REACT_APP_VERCEL_[A-Z_]+$/, // Vercel system metadata (commit sha, env, url)
];
const isPublicName = (name) => PUBLIC_REACT_APP.some((re) => re.test(name));

const SECRET_PATTERNS = [
  ['GitHub token', /\b(gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,})\b/],
  ['Stripe secret key', /\b(sk|rk)_(live|test)_[A-Za-z0-9]{16,}\b/],
  ['Stripe webhook secret', /\bwhsec_[A-Za-z0-9]{16,}\b/],
  ['Brevo key', /\bxkeysib-[a-f0-9]{32,}/],
  ['Google OAuth client secret', /\bGOCSPX-[A-Za-z0-9_-]{20,}/],
  ['PostHog personal key', /\bphx_[A-Za-z0-9]{30,}/],
  ['Sentry auth token', /\bsntry[su]_[A-Za-z0-9_=]{20,}/],
  ['Private key', /-----BEGIN (RSA |EC )?PRIVATE KEY-----/],
  ['Mailgun key', /\bkey-[a-f0-9]{32}\b|\b[a-f0-9]{32}-[a-f0-9]{8}-[a-f0-9]{8}\b/],
  ['RevenueCat secret key', /\bsk_[A-Za-z0-9]{28,}\b/],
];

function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(p);
  }
  return out;
}

function checkSource() {
  const problems = [];
  for (const file of walk(path.join(ROOT, 'src'), ['.js', '.jsx', '.ts', '.tsx'])) {
    if (/\.test\.[jt]sx?$/.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    if (/process\.env\s*\[/.test(text)) problems.push(`${rel}: dynamic process.env[...] lookup inlines every REACT_APP_* var into the bundle`);
    if (/process\.env\s*[),;}]|\.\.\.\s*process\.env|Object\.\w+\(\s*process\.env/.test(text)) {
      problems.push(`${rel}: process.env used as a whole object (inlines every REACT_APP_* var)`);
    }
    for (const m of text.matchAll(/REACT_APP_[A-Z0-9_]+/g)) {
      if (!isPublicName(m[0])) problems.push(`${rel}: ${m[0]} is not an approved public variable — secrets belong in api/ with a non-REACT_APP name`);
    }
    for (const [label, re] of SECRET_PATTERNS) {
      if (re.test(text)) problems.push(`${rel}: looks like a hard-coded ${label}`);
    }
  }
  return problems;
}

function checkBundle() {
  const problems = [];
  const files = walk(path.join(ROOT, 'build'), ['.js', '.html', '.map', '.json']);
  if (!files.length) return ['build/ is empty — run the build first'];
  // Values of server-side secrets present in this build environment.
  const sensitiveValues = Object.entries(process.env).filter(
    ([k, v]) =>
      !k.startsWith('REACT_APP_') &&
      /SECRET|TOKEN|PASSWORD|PRIVATE|CREDENTIAL|API_KEY|_JSON$|ENCRYPTION_KEY/i.test(k) &&
      typeof v === 'string' &&
      v.length >= 12
  );
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    if (file.endsWith('.map')) problems.push(`${rel}: source maps must not be published (GENERATE_SOURCEMAP=false)`);
    for (const m of text.matchAll(/REACT_APP_([A-Z0-9_]+):"/g)) {
      const name = `REACT_APP_${m[1]}`;
      if (!isPublicName(name)) problems.push(`${rel}: ${name} value is inlined in the bundle`);
    }
    for (const [label, re] of SECRET_PATTERNS) {
      if (re.test(text)) problems.push(`${rel}: contains what looks like a ${label}`);
    }
    for (const [k, v] of sensitiveValues) {
      if (text.includes(v)) problems.push(`${rel}: contains the value of server env var ${k}`);
    }
  }
  return problems;
}

function main() {
  const mode = process.argv[2];
  if (!['src', 'bundle'].includes(mode)) {
    console.error('usage: check-secrets.js src|bundle');
    process.exit(2);
  }
  const problems = mode === 'src' ? checkSource() : checkBundle();
  if (problems.length) {
    console.error(`\n✖ Secret check (${mode}) failed:\n  - ` + [...new Set(problems)].join('\n  - ') + '\n');
    process.exit(1);
  }
  console.log(`✓ Secret check (${mode}) passed`);
}

if (require.main === module) main();
module.exports = { checkSource, checkBundle, isPublicName, SECRET_PATTERNS };
