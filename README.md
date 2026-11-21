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
| `ledgerAccounts` | `checking`, `credit_card` (any number per company; close = archive, history kept; `cardPaymentsPaidPersonally` makes imported card payments owner contributions), `personal` ("Paid personally", `<company>_personal`), `fixed_asset` (one per asset: life, salvage, in-service date) and one `intercompany` account per company (`dal_checking`, `dal_card`, `dal_ic_zerbiq`, …). Each has an opening balance (cents) and opening date, plus an optional link to the vault's `bankAccounts` / `creditCards` record and its last 4 digits. |
| `ledgerCategories` | Per-company `income` / `expense` / `equity` categories. These are archived, never deleted. |
| `ledgerTransactions` | `date`, `amountCents` (integer, signed), `payee`, `memo` (shown as **Description / notes**), `projectId` (optional), `status` (`uncleared` / `cleared` / `reconciled`), `type`, `categoryId` or `transferAccountId`, `splits[]`, `fingerprint`, `deleted` (soft delete). `role` is `main`, `leg` or `mirror`. `convertedFromCategoryId` is set when an expense was turned into a fixed asset. |
| `ledgerProjects` | Per-company projects / apps (`name`, `archived`). Ids are `<companyId>_proj_<slug>`. They are archived, never deleted. |
| `ledgerBulkEdits` | Bulk "change category" records: every moved line with its old category (for undo), `status` `applying` → `applied` → `undone`. Created once and never deleted; afterwards only the status and counters change. |
| `ledgerVendorRules` | "Payee contains X" → category, plus an optional default project. Optional limits: `fromDate` / `toDate`, `accountId` and `wholeWord`. With `icCategoryId` (the other company's category) the rule books the charge as "Paid for <other>". Applied on entry and import: the longest match wins, and on a tie a date- or account-limited rule wins. A rule limited to dates or an account beats general rules; otherwise the longest pattern wins. `splitPlan` ({ planCents, ownCents, …memos }) splits a shared plan: up to the plan price it's 50/50; above it we keep `ownCents` and the rest is theirs (import only; elsewhere the rule's own category). `settleThroughOwners` closes the other company's share with an owners settlement. `reviewNote` adds a "Check: …" note to the memo. Setup (DAL) has a one-click preset for Zerbiq's vendors on the DAL card from 2026-08-28: Anthropic, Claude.ai, Expo (whole word), 650 Industries, St Augustine law (`AUGUSTINE LAW`, whole word) and State of Florida fees (STATE OF FLORIDA, FL/FLA/FLORIDA DEPT OF STATE, SUNBIZ, DIVISION OF CORPORATI…, FL DIV OF CORP; labelled in the preview, since DAL's own annual report is a Florida fee too) are 100% Zerbiq; Vercel: each month the plan charge (nearest the 4th, `splitPlan.planDay`) is split $10 DAL / rest Zerbiq, and every other Vercel charge that month (and credits) is Zerbiq usage. Telnyx and Supabase are 100% Zerbiq on any date, and Lob is DAL marketing; Vercel Domains (yearly domains) stay plain DAL Hosting & domains, assigned by hand at renewal. |
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
2a. **Dates are 2000–2099.** A year outside that range (e.g. the typo 0226) is refused when a date is entered or changed, and the Expenses migration reports such old records instead of migrating them (records already migrated count as skipped).
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
   **Settle through owners (no repayment)** is the non-cash version, used when the owners funded the cost
   personally and nobody will be repaid (`ownersSettlementDrafts`, `settlementKind: 'owners'`). It is the
   same paired settlement, but each side goes through the company's *Paid personally* account instead of a
   bank account. The company that was paid for records an owner contribution, the paying company's owner
   money goes down by the same amount, and both intercompany balances end at $0.00. P&L and bank/card
   balances don't change. Imports apply it automatically for rules marked `settleThroughOwners`; it can also
   be recorded on the Intercompany screen. On import it's written in the same Firestore transaction as its
   charge, and only when the charge itself is new. A refund on such a charge settles in the other direction.
   Ids are derived from the charge (account + fingerprint), so it is idempotent. Delete it like any
   reimbursement to undo; a deleted one is never re-created. On a card marked *Payments paid personally*,
   register and Review-queue edits keep the charge's settlement in step in the same transaction, refusing if
   it's reconciled. Older charges whose share didn't change get none, since they may have been settled by
   hand. Anything else open is settled on the Intercompany screen.
6. **P&L** (cash basis) counts only income and expense category lines. Transfers, equity, intercompany
   receivables and uncategorized lines are excluded; uncategorized lines are flagged so they get fixed.
   **Reports** are grouped into three sets:
   - *Statements:* P&L, balance sheet, trial balance, general ledger.
   - *Analysis:* income vs expense, category breakdown, category trends, income by source, by project.
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
   - **Make this a fixed asset** (register row ⋯ menu, on a single-category expense) creates the asset
     from that purchase and re-books the same transaction as a transfer into it. The original category is
     kept in `convertedFromCategoryId`. **Undo fixed asset** removes the auto depreciation, puts the
     category back and archives the asset; it refuses once the asset is disposed or has other entries.
     Both are audit-logged (`ledger_update` with action `converted_to_fixed_asset` / `fixed_asset_undone`).
6b. **Projects / apps and notes.** Any transaction, or any split line, can be tagged with a project
   (Setup → Projects / apps; DAL can also create them from the old Expenses app tags, migrate mode
   `projects`). A split line's own project wins over the transaction's. Reports → By project uses the
   same cash-basis lines as the P&L; untagged amounts show as *No project*, and transfers and equity are
   left out. The project and the notes are optional, searchable in the register, and included in the
   CSV/PDF exports and the general ledger. The rules check that a `projectId` on a transaction or vendor
   rule belongs to the same company.
6c. **Paid personally** (account kind `personal`, `<company>_personal`) is for business expenses an owner
   paid with their own money (a personal card, or a business card whose bills were paid personally).
   - Its rows are normal category lines, so the P&L counts them.
   - Its balance is owner equity: the balance sheet shows "Owner contributions · Paid personally", the trial
     balance puts it under Equity, and the owner contributions report counts each row as a contribution
     (refunds reduce it). It is never a liability and never touches checking.
   - When the business pays an owner back, record it from checking as *Owner draw* (the register labels it
     "reimburse / pay back an owner").
   - Setup (DAL) → *Card charges paid on a personal card*: migrated card charges that were typed in by hand
     (no statement, still uncleared) move from the card to Paid personally (`migrate` modes
     `personal-preview` / `personal-move` / `personal-undo`, audited). Each moved row is marked
     `personalMovedFrom`, and "Card payments before Books" is recomputed so it covers only real card
     charges. The card still owes $0.00, and P&L and total owner contributions are unchanged (when the old
     card payments are booked as owner contributions). It refuses before writing anything if a reconciled
     "Card payments before Books" month would have to change.
   - A card payment's `coversHistoricalCents` is clamped to the payment. Editing, deleting or restoring such a
     payment re-runs settle. With more than one card, the import asks which card the payments pair with,
     and charges already moved to Paid personally are flagged (unticked) if they show up on a card statement.
   - Card import: on a card with *Payments paid personally*, card payments import as Owner contribution, not a
     transfer from checking. On the DAL card, a payment bigger than what the card owes at that point is
     paying charges already covered by "Card payments before Books". The preview flags it, the row stores
     `coversHistoricalCents`, and `planHistoricalPayments` shrinks the estimate by that much (newest month
     first). So the owners' money isn't counted twice and the card doesn't go below $0.00.
   - **Card statement cut-over** (Setup → "Migrated card charges were paid before Books": *Statements from* /
     *owed then*). Enter the day before the first real statement you'll import, and that statement's *Previous
     balance*. "Card payments before Books" then covers migrated charges only up to that day and leaves that
     balance owed. Every real card payment from then on is a full owner contribution, so the card matches each
     statement's new balance, and the double-count guard switches off. Migrated rows that a statement import
     matches (or repeats exactly) are stamped `importMatched` and drop out of that coverage, since a charge made
     before the cut-over can post on the next statement. Settle re-runs after such an import. The cut-over is stored on the card
     (`historicalCutoffDate` / `historicalCutoffOwedCents`) and audited.
   - Import matches statement rows to migrated card rows by amount and date (±5 days), even though those rows
     carry the old import's fingerprint. Each migrated row matches only once (`importMatched`).
   - **Personal (not business)** (equity category `personal_spending`, `equityType: 'personal'`, in both
     companies) is for the business card used for something personal. It's an owner draw: out of both P&Ls,
     and netted against the card payments' owner contributions on the owner report.
   - On a card marked *Payments paid personally*, any line booked "Paid for Zerbiq" (in the import, the
     Review queue or the register) gets its owners settlement automatically. Editing, deleting or restoring
     the charge resizes or removes the settlement (`syncOwnersSettlement`).
   - **Duplicate receipts on the card** (Setup, DAL): old Expenses rows entered from a receipt (📎) that repeat
     a statement row (same amount, ±3 days, a shared payee word). *Merge* keeps the statement row, gives it the
     receipt, notes, project and (if it had none) the category, then soft-deletes the receipt row
     (`mergedInto` / `mergedFrom` / `mergeBackup`). It re-settles and rebuilds, can be undone, and is audited
     (`migrate` modes `dupes-preview` / `dupes-merge` / `dupes-undo`).
   - After a cut-over, *Card charges paid on a personal card* also moves migrated charges dated after it, up to
     the last imported statement's end, that no imported statement matched (paid another way, e.g. Fiverr via
     PayPal). Receipt duplicates are skipped until they are merged. A row with a same-amount card row within 5
     days is held back as a possible duplicate. Merge and Move apply only to the rows that were previewed
     (`ids`). Pairing is a maximum matching that prefers the closest dates, a statement row already merged
     into is never offered again, and undo keeps fields changed after the merge.
7. **Reconciled rows are locked by the rules.** Their amount, date, account, status and delete flag can't
   change. **Undo reconcile** is server-side (`/api/ledger/unreconcile`), requires a sign-in within the last
   15 minutes, is written to the audit log first, and works on the latest statement only.
8. **Imports are idempotent.** The file hash, then each row's fingerprint (or the bank's FITID for
   QFX/OFX), are checked against what is already there. A row that matches something already entered
   (a manual entry or the other leg of a card payment) is attached to it rather than duplicated.
   **Chase is the primary bank**: in Download account activity, pick *Quicken Web Connect (.QFX)* (best)
   or *CSV*. Capital One PDF / CSV and Excel (including the Fiverr export) are also supported.
8a. **Change category in bulk** (Setup). Moves every transaction whose payee contains some text, in all
   accounts and all years, from any category (or one category) to another. Split lines move one by one;
   transfer and intercompany lines, legs and mirrors are never touched. Reconciled rows are included: a category
   isn't one of the locked fields, and the change never moves a balance. Every row is written through the
   planner (25 per Firestore transaction; a refused chunk is retried row by row), so the monthly totals stay
   right. Preview dry-runs every row through the planner and lists, without changing them, the rows it would
   refuse and the matching transfer/intercompany rows (a mirror's category is changed in the other
   company's books, on its "Paid for" line). The record with the old categories
   is saved *before* any row changes, so **Undo** works even if a run stops part-way. Undo only reverts lines
   that still have the category the bulk change gave them, so later hand edits are kept. It can also add or
   update a vendor rule for the payee. Audited as `ledger_update` with action `bulk_recategorize` /
   `bulk_recategorize_undone` (`src/ledger/core/bulk.js`, `tests/ledger/bulk.test.js`).
9. **Destructive actions are audited** through `recordAuditEvent()` (`ledger_delete`, `ledger_restore`,
   `ledger_update`, whose `action` says what changed, e.g. `converted_to_fixed_asset`) and on the server (`ledger_unreconcile`, `ledger_migration`).
10. **Maintenance.** Books → Setup → *Rebuild totals* recomputes `ledgerMonthly` for a company from its
   transactions. The Expenses migration runs from Books → Setup (Dry run / Migrate / Roll back), or with
   `node scripts/migrate-expenses-to-ledger.js [--apply|--rollback]` where the service account is in the
   environment. Migrate backs up first and is safe to re-run.
   The migrated card charges were paid before these books started. So the migration also posts one
   **"Card payments before Books"** entry per month on the DAL card (`dal_hist_<YYYY-MM>`, source
   `historical_payment`), which brings the card's migrated history to $0.00 owed without touching P&L or
   checking. The old card bills were paid from the owner's personal money, so by default these are
   booked as *Owner contribution* and appear on the owner contributions report. Setup → "Migrated card
   charges were paid before Books" can switch them to *Opening balance equity (paid before Books)*, an
   equity category with `equityType: 'opening'` that the owner report ignores. Re-runs keep the choice.
   **Old Expenses: notes, app tags and receipts** (Setup, DAL) runs a read-only report
   (`migrate` mode `legacy-report`). It shows which fields the old records carry, how many have an app tag,
   notes or a receipt, and which migrated rows still have neither a project nor notes (with a CSV of those).
   *Bring over* (`legacy-notes`) appends notes the migration left out, only while the memo is still exactly
   what the migration wrote. Each such row is marked `legacyNotesAdded` so `legacy-notes-undo` can remove the
   note. It also links app tags to projects. Old Expenses receipts (`expenses/<id>/<file>` in Storage) open
   through `receipt-url` with a fresh 10-minute link instead of their stored long-lived signed URL. Note: the old
   Fiverr Excel import kept only the invoice number as the note. Its *service* and *project* columns were never
   saved, so they can only come back by re-reading those Excel exports.

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
