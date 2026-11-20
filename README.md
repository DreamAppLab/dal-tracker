# DAL Mission Control

Dream App Lab's internal operations hub: apps, websites, client projects, quotes,
revenue, expenses, maintenance, and the **Companies** vault for Dream App Lab LLC
and Zerbiq.

**Read [CLAUDE.md](./CLAUDE.md) before changing anything** — it holds the security
rules every change must follow.

## Stack
- React 18 (Create React App), hosted on Vercel (`dal-tracker.vercel.app`)
- Vercel serverless functions in `api/` (all wrapped by `api/_lib/security.js`)
- Firebase project `dal-mission-control`: Auth, Firestore, Storage
- Mailgun (email), Twilio (SMS), Stripe (payments)

## Security model (summary)
- One admin account, verified email required, enforced in Firestore/Storage rules
  and in every API function.
- No secrets in the browser bundle; server-only env vars; build-time secret scan.
- Deny-by-default rules; server-only `auditLog`; 30-minute idle sign-out;
  recent sign-in required for sensitive actions; strict security headers.
- The public client feedback widget (`public/widget/feedback-widget.js`) talks
  only to the validated, rate-limited `/api/feedback/*` endpoints. Admin controls
  on a preview site are unlocked with a 12-hour signed link from
  Web Projects → **Open as admin**.

## Companies vault
Company profiles (`companies/dal`, `companies/zerbiq`), bank accounts and credit
cards (`companies/{id}/bankAccounts`, `.../creditCards`).
- EIN, LLC/document number, routing, account and card numbers are encrypted in
  `api/vault.js` with AES-256-GCM (`VAULT_ENCRYPTION_KEY`, production only; the AAD
  binds each ciphertext to its record and field). Ciphertext lives in the
  server-only `vaultSecrets` collection; client-readable docs hold masked values
  and last 4 only, so the ledger module can read them.
- All writes go through `/api/vault/*` (transactions, sign-in within 15 minutes).
  Reveal/Copy need a sign-in within 5 minutes, are audited before the value is
  returned, and auto-hide after 30 seconds (also when the tab is hidden).
  Copied values are cleared from the clipboard after 30 seconds if this tab has
  focus, otherwise as soon as you return to it (browsers block clipboard writes
  from background tabs; Firefox and Safari allow it only on a click, so there use
  the button); until then a banner offers "Clear clipboard now". Closing the tab
  first leaves the value on the clipboard.
- CVV, PIN and online-banking passwords are never accepted (strict schemas).
- Without `VAULT_ENCRYPTION_KEY` (preview deployments) the vault API returns 503
  for anything that would store or reveal a number. Losing the key makes every
  stored number unreadable: keep a copy in the password manager.

## Local development (PowerShell)
```powershell
cd C:\dev\dal-tracker
npm install
npm start
```

## Tests
```powershell
cd C:\dev\dal-tracker
npm run test:api
npx react-scripts test --watchAll=false
npm run test:rules
```
CI (GitHub Actions) runs all of these plus a production build and bundle secret
scan on every pull request.

## Environment variables (Vercel, server-only unless noted)
| Variable | Used by |
| --- | --- |
| `DAL_MC_FIREBASE_PROJECT_ID`, `DAL_MC_FIREBASE_CLIENT_EMAIL`, `DAL_MC_FIREBASE_PRIVATE_KEY` | Admin SDK (token verification, Firestore, Storage) |
| `DAL_MC_INTERNAL_SECRET` | dal-site → `/api/record-quote-payment` |
| `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM`, `SIGNIN_ALERT_EMAIL` (optional) | email, sign-in alerts, inbound signature check |
| `FEEDBACK_ADMIN_TOKEN_SECRET` | widget "Open as admin" links |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_SERVICE_ACCOUNT_JSON` | Google Calendar |
| `REVENUECAT_SECRET_<APP>`, `REVENUECAT_SECRET_KEY` | revenue sync, Tools Hub |
| `GITHUB_TOKEN`, `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `UPTIMEROBOT_API_KEY` | Tools page live cards (GitHub, Vercel) / Website Analytics. Sentry, PostHog, Expo and Crisp are link-only: Mission Control holds no keys for them. |
| `FT_ADMIN_SECRET` | FamilyThread admin proxy |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | SMS — **not set** (feature inactive until added) |
| `STRIPE_SECRET_KEY` | payment links |
| `STRIPE_WEBHOOK_SECRET` | `/api/stripe-webhook` signature check — **not set**; the webhook rejects every call (no Stripe deliveries seen) |
| `DAL_SITE_FIREBASE_PROJECT_ID`, `DAL_SITE_FIREBASE_CLIENT_EMAIL`, `DAL_SITE_FIREBASE_PRIVATE_KEY`, `DAL_SITE_FIREBASE_STORAGE_BUCKET` (optional) | dal-website Firestore: blog, quotes, submit, record-quote-payment |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | older name for the dal-website service account, read first by `record-quote-payment` |
| `ZERBIQ_FIREBASE_CLIENT_EMAIL`, `ZERBIQ_FIREBASE_PRIVATE_KEY` (+ optional `ZERBIQ_FIREBASE_PROJECT_ID`, `_STORAGE_BUCKET`) | Zerbiq blog admin — **not set** (feature inactive until added) |
| `MAILGUN_WEBHOOK_SIGNING_KEY`, `DAL_MC_FIREBASE_STORAGE_BUCKET`, `DAL_SITE_URL`, `NDA_URL` (all optional) | inbound signature key (else fetched with `MAILGUN_API_KEY`), Storage bucket override, quote links, NDA attachment |
| `VAULT_ENCRYPTION_KEY` (Sensitive, production only) | Companies vault encryption — base64 of 32 random bytes |
| `REACT_APP_FT_*`, `REACT_APP_ZERBIQ_FIREBASE_*`, `REACT_APP_DAL_SITE_FIREBASE_*`, `REACT_APP_DAL_SITE_URL` (public) | Firebase **web** config and URLs only — never secrets |

### Provider keys (rotated Nov 20 2026)
Each key is dedicated to Mission Control and named after it at the provider, so
it can be revoked without touching anything else. Use the least access listed.

| Vercel variable | Provider key | Access |
| --- | --- | --- |
| `GITHUB_TOKEN` | GitHub fine-grained token "Mission Control Tools page (read-only)" | DreamAppLab repos: Metadata + Pull requests, read-only |
| `VERCEL_TOKEN` | Vercel token "Mission Control server (Nov 2026 b)" | Dream App Lab team, expires Nov 2027 |
| `MAILGUN_API_KEY` | Mailgun key "DAL Shared (Nov 2026)" | Admin (sending, stats, webhook signing key); also used by wright-way-vacations |
| `REVENUECAT_SECRET_KEY` and `REVENUECAT_SECRET_<APP>` | RevenueCat v2 secret key "Mission Control (Nov 2026, read-only)" in each project | Charts metrics + project configuration, read-only |
| `FT_ADMIN_SECRET` | FamilyThread Runtime Config `admin/secret` in `familythread-prod` (read by the `getAdminData` function) | Shared secret header; change both together (`gcloud beta runtime-config configs variables set secret NEW --config-name=admin --is-text`) |

To rotate one: create the new key at the provider, update the Vercel variable
(Sensitive), redeploy, check the Tools page, then revoke the old key.

### Security audit log (Nov 20 2026)
- **Git history** (`gitleaks git --log-opts=--all`, all refs): only public
  Firebase web API keys, allowlist UIDs, and the retired Brevo key inside an old
  committed `build/` bundle. Brevo is no longer used anywhere and that key is
  retired at the provider; history that GitHub has already served can't be
  scrubbed, so retirement, not rewriting, is the fix.
- **Vercel env**: the old `REACT_APP_*` secret copies (RevenueCat, Vercel,
  GitHub, Mailgun, Sentry, PostHog, Crisp, Expo, Google client secret, FT admin
  secret) were deleted from every environment, along with unreferenced leftovers
  (`SETUP_BILLING_TOKEN`, `DAL_MANUAL_QUOTE_SECRET`,
  `FIREBASE_SERVICE_ACCOUNT_JSON`, `Gemini_API_Key`,
  `VITE_GOOGLE_MAPS_BROWSER_KEY`, and the lower-case Firebase web config
  `apiKey`/`appId`/...). Every remaining variable is listed in the table above,
  and `REACT_APP_*` holds public Firebase web config and URLs only.
- **npm audit** (production deps): 8 moderate advisories in transitive
  `uuid`/`glob`/`minimatch`/`rimraf` under `firebase-admin` and `googleapis`
  (not reachable: no attacker-controlled globs, no `uuid` `buf` argument) and 1
  low in `quill` HTML export (`getSemanticHTML`), reachable only through Quill's
  copy handler on admin-written blog content; Mission Control's CSP blocks inline
  script. `npm audit fix` can't apply them inside the parents' version ranges;
  they clear when firebase-admin / googleapis / quill ship fixed releases, which
  Dependabot (`.github/dependabot.yml`) proposes weekly behind CI.
- **Firestore free-text**: some legacy notes contain pasted credentials. They are
  being migrated to the password manager (CLAUDE.md rule 13); the inventory is
  kept privately, not in this public repo.
