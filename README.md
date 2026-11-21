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

## Client email
- **Web Projects → a project → Client emails**: Compose to the project's assigned
  contact and see the whole conversation with them (also sent from Contacts or a
  project's Client tab). Sends go through `/api/client-email` with Reply-To
  `clients@inbound.dreamapplab.com`.
- **Inbound** (`/api/inbound-client-email`, Mailgun route, signature-checked):
  each message is filed in its email thread, or, if it isn't a reply, under the
  contact with that address when Mailgun verified the sender (SPF/DKIM aligned
  with the From domain) and exactly one contact matches. Every message that
  reaches the function is **copied to lab@dreamapplab.com** with its attachments
  (tagged [Unverified], [Spam?] or [Auto-reply] when relevant), except mail from
  our own domain or lab@ itself. Processing is idempotent, so Mailgun retries
  never duplicate. New feedback notes are emailed to lab@ too.
- **Size limit:** Vercel rejects requests over ~4.5 MB, so an email with large
  attachments never reaches Mission Control. For a guaranteed copy of
  everything, add a second action `forward("lab@dreamapplab.com")` to the
  Mailgun route (Mailgun dashboard → Receiving → Routes). lab@ then gets each
  message twice (the original and Mission Control's labelled copy).

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

## Books (ledger)
Bookkeeping for **Dream App Lab LLC (`dal`)** and **Zerbiq (`zerbiq`)**. It replaces the
two Quicken Online subscriptions and the old Expenses tab (the `expenses` and
`importedStatements` collections are now read-only history). Open **Books** in the
sidebar; the bar at the top always shows whose books are open (DAL is teal, Zerbiq is
violet). The selected company is saved per user in `ledgerPrefs/{uid}`.

### Data model (Firestore, all top-level, every doc has `companyId`)
| Collection | Holds |
|---|---|
| `ledgerAccounts` | `checking`, `credit_card`, `fixed_asset` (one per asset: life, salvage, in-service date) and one `intercompany` account per company (`dal_checking`, `dal_card`, `dal_ic_zerbiq`, …). Each has an opening balance (cents) and opening date, plus an optional link to the vault's `bankAccounts` / `creditCards` record and its last 4 digits. |
| `ledgerCategories` | Per-company `income` / `expense` / `equity` categories. These are archived, never deleted. |
| `ledgerTransactions` | `date`, `amountCents` (integer, signed), `payee`, `memo`, `status` (`uncleared` / `cleared` / `reconciled`), `type`, `categoryId` or `transferAccountId`, `splits[]`, `fingerprint`, `deleted` (soft delete). `role` is `main`, `leg` or `mirror`. |
| `ledgerVendorRules` | "Payee contains X" → category, applied on entry and import (the longest match wins). |
| `ledgerReconciliations` | Finished statements (`startingBalanceCents`, `endingBalanceCents`, `statementDate`, `status`). |
| `ledgerMonthly` | Cached totals per company per month (`acct` and `cat` maps), kept up to date with atomic increments. |
| `ledgerImports` | Fingerprints of imported statement files. |
| `ledgerMigrationBackups` | Server-only backup made before the Expenses migration. |

### Rules of the road
1. **Money is integer cents.** Use `src/ledger/core/money.js` (`parseMoneyToCents`, `formatCents`) and never floats.
   Signs are always from the account's point of view: checking `+` is a deposit; a card `−` is a charge and
   `+` is a payment or credit; intercompany `+` is due from the other company and `−` is due to it.
2. **Ids carry the company.** Every ledger id, and every id a ledger doc points at, starts with
   `<companyId>_`. `firestore.rules` uses this to reject any document whose id, account, category or transfer
   account belongs to the other company. Split lines are a list the rules cannot loop over, so the planner
   validates them on every write path.
   Every query filters on `companyId`, and the rules refuse unscoped reads.
3. **Write through the planner.** `core.planTransactionWrite()` turns one main transaction into all of its
   docs: transfer legs, intercompany mirrors and monthly deltas. In the browser, `ledgerStore.saveTransaction`,
   `setDeleted` and `purgeDeleted` run it inside a Firestore transaction with fresh reads. Never write
   `ledgerTransactions` or `ledgerMonthly` any other way. Monthly payloads must omit empty maps, because
   with `merge: true` an empty map wipes the stored totals.
4. **Transfers are never expenses.** A card payment is one main entry plus a linked leg in the other account.
   Owner contributions and draws use `equity` categories.
5. **Intercompany.** A line booked as "Paid for Zerbiq" (whole amount or one split line) moves into the
   payer's intercompany account (a receivable), and the other company gets a **mirror** expense with its own
   category plus a payable. Reimbursements are recorded on the Intercompany screen as two paired mains
   (`<payer>_set_<id>_p` / `<receiver>_set_<id>_r`). Both halves always change together, and partial
   payments are fine.
6. **P&L** (cash basis) counts only income and expense category lines. Transfers, equity, intercompany
   receivables and uncategorized lines are excluded; uncategorized lines are flagged so they get fixed.
   **Reports** are grouped into three sets:
   - *Statements:* P&L, balance sheet, trial balance, general ledger.
   - *Analysis:* income vs expense, category breakdown, category trends, income by source.
   - *Schedules:* fixed assets, owner contributions & distributions, intercompany.

   All of them export to CSV and PDF. On the balance sheet, equity is opening-balance equity + owner
   contributions/draws + retained earnings (prior years) + net income (this year) + uncategorized activity.
   So it always balances, and the trial balance's debits always equal its credits
   (`src/ledger/core/statements.js`, tested in `tests/ledger/statements.test.js`).
6a. **Fixed assets** are accounts of kind `fixed_asset`, one per asset, added in Setup → Fixed assets.
   - A purchase is a *transfer* into the asset from checking or the card: it is capitalized and never
     counted as an expense.
   - An asset bought before the books started gets its cost as the opening balance instead.
   - Assets owned before the books started open at book value (cost − depreciation already taken)
     and are depreciated only from the books' start. Selling or scrapping uses Setup → Sell / dispose:
     it posts depreciation through that date, moves the proceeds to a bank account, books the
     gain or loss, and archives the asset.
   - Depreciation is straight-line, full month from the in-service month, and only for months that
     have ended. Reports → Fixed assets posts
     one entry per month (category Depreciation, id `<assetId>_dep_<YYYY-MM>`), so posting is idempotent.
   - The asset's balance is its book value.
7. **Reconciled rows are locked by the rules.** Their amount, date, account, status and delete flag can't
   change. **Undo reconcile** is server-side (`/api/ledger/unreconcile`), requires a sign-in within the last
   15 minutes, is written to the audit log first, and works on the latest statement only.
8. **Imports are idempotent.** The file hash, then each row's fingerprint (or the bank's FITID for
   QFX/OFX), are checked against what is already there. A row that matches something already entered
   (a manual entry or the other leg of a card payment) is attached to it rather than duplicated.
   **Chase is the primary bank**: in Download account activity, pick *Quicken Web Connect (.QFX)* (best)
   or *CSV*. Capital One PDF / CSV and Excel (including the Fiverr export) are also supported.
9. **Destructive actions are audited** through `recordAuditEvent()` (`ledger_delete`, `ledger_restore`,
   `ledger_update`) and on the server (`ledger_unreconcile`, `ledger_migration`).
10. **Maintenance.** Books → Setup → *Rebuild totals* recomputes `ledgerMonthly` for a company from its
   transactions. The Expenses migration runs from Books → Setup (Dry run / Migrate / Roll back), or with
   `node scripts/migrate-expenses-to-ledger.js [--apply|--rollback]` where the service account is in the
   environment. Migrate backs up first and is safe to re-run.

### Indexes
Composite indexes live in `firestore.indexes.json`. Deploy them with
`firebase deploy --only firestore:indexes --project dal-mission-control`. Rules deploy separately with
`--only firestore:rules`, after the PR is merged.

## Local development (PowerShell)
```powershell
cd C:\dev\dal-tracker
npm install
npm start
```
To work on Books without touching production, run the emulators
(`npx firebase emulators:start --only firestore,auth --project dal-mission-control`), set
`localStorage['mc.emulators'] = '1'` on `http://localhost:3000`, reload, and sign in with an
Auth-emulator user (lab@dreamapplab.com, email verified). This switch is compiled out of
production builds.

## Tests
```powershell
cd C:\dev\dal-tracker
npm run test:ledger
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
| `LAB_INBOX` (optional, default `lab@dreamapplab.com`) | where every inbound client email and new feedback note is copied |
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
  committed `build/` bundle. Brevo is no longer used anywhere. History that
  GitHub has already served can't be scrubbed, so the fix for any key found
  there is revoking it at the provider, not rewriting history.
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
