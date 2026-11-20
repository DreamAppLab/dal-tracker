# DAL Mission Control — rules for every change

Mission Control holds sensitive financial data (EINs, LLC numbers, bank and card
numbers, full books for Dream App Lab LLC and Zerbiq). Treat every change as a
security change. These rules are enforced by tests and by the Vercel build.

## Stack
- React 18 (Create React App) on Vercel, serverless functions in `api/`.
- Firebase project `dal-mission-control` (Auth, Firestore, Storage).
- Repo `DreamAppLab/dal-tracker`, branch `main`, local `C:\dev\dal-tracker`.

## Security rules of the road
1. **Single admin.** Only the allowlisted account with a **verified email** gets in
   (`api/_lib/allowlist.js`, mirrored in `firestore.rules` and `storage.rules`;
   `tests/api/misc.test.js` fails if they drift). Change all three together.
2. **No secrets in the browser — ever.** Anything in `src/` ships to the public
   bundle. `REACT_APP_*` is only for public values (Firebase web config, URLs).
   Never use `process.env[name]` or `process.env` as an object in `src/`: CRA
   then inlines every `REACT_APP_*` variable. `scripts/check-secrets.js` blocks
   both and scans the built bundle on every Vercel build.
3. **Secrets live in server-only Vercel env vars** (no `REACT_APP_` prefix) and are
   read only in `api/`. New provider key → add it with type *Sensitive*, all
   needed environments, then reference it from an `api/` function.
4. **Every API function is wrapped with `withSecurity()`** (`api/_lib/security.js`):
   Firebase ID-token verification + allowlist (`auth: 'admin'`), input validation
   with zod (`validate()`), rate limiting, no wildcard CORS, generic 500s.
   `tests/api/security.test.js` fails if any `api/` file skips it.
   - Server-to-server callers use `auth: 'admin-or-internal'` (Bearer
     `DAL_MC_INTERNAL_SECRET`) or a provider signature (Stripe, Mailgun).
   - Only the feedback widget endpoints (`/api/feedback/pin`, `/pins`) are public;
     they validate, size-limit and rate-limit, and CORS is limited to the
     preview-site origins registered on `webProjects`.
5. **Call your own API only through `apiFetch()`** (`src/lib/apiClient.js`), which
   attaches the ID token and handles "confirm it's you" re-auth.
6. **Firestore/Storage are deny-by-default.** Server-only collections
   (`auditLog`, `rateLimits`, vault ciphertext) are written only by `api/` with
   the Admin SDK. Add new collections deliberately and add rules tests
   (`tests/rules/`, run in CI against the emulator).
7. **Sensitive actions need a recent sign-in.** Client: `useRecentAuth()` →
   `requireRecentAuth(seconds)`. Server: `withSecurity({ recentAuthSeconds })`.
8. **Audit everything sensitive.** Sign-ins, vault reveals/copies, edits to
   sensitive records, imports and deletions go to `auditLog` via
   `writeAudit()` (server) or `auditedDeleteDoc()` / `recordAuditEvent()`
   (client → `/api/audit/event`). Never put secrets or full numbers in audit meta.
9. **Sessions end after 30 minutes idle** (`AuthContext`). Don't remove the
   `visibilitychange` token refresh (it fixed the black-screen bug).
10. **Headers:** CSP, HSTS, frame-ancestors none, etc. live in `vercel.json`. If you
    add a third-party script/API, add only its exact origin to the CSP. The widget
    (`public/widget/`) must stay embeddable on client preview sites.
11. **No CVV, PIN or online-banking passwords are ever stored.** Vault numbers are
    encrypted only in `api/vault.js` (`api/_lib/vaultCrypto.js`); never add a
    plaintext copy, a client-side decrypt, or a new sensitive field without adding
    it to `SENSITIVE` in `api/_lib/vaultSchema.js` and to the tests.
12. **Never commit** `.env*`, service-account JSON, or `build/`. Source maps are not
    published (`GENERATE_SOURCEMAP=false`).
13. **No credentials in free-text fields** (policy; not machine-checked). Black Box, project notes, todos and
    other Firestore text are stored in plaintext. API keys and passwords belong in
    Vercel (server keys) or the password manager; company numbers belong in the
    encrypted Companies vault.
14. **Retired env vars get deleted from Vercel**, not just unreferenced (policy;
    not machine-checked). After a
    rename or provider removal, delete the old variable in every environment and
    revoke the old key at the provider.

15. **Books (ledger) rules** — see README "Books (ledger)". In short: money is integer
    cents; every ledger id starts with `<companyId>_` and every query filters on
    `companyId`; write transactions only through `core.planTransactionWrite()` via
    `ledgerStore` (one Firestore transaction updates main + legs + mirrors + monthly
    totals; never send empty maps to `ledgerMonthly`); reconciled rows are unlocked only
    by `/api/ledger/unreconcile`; transfers and equity never touch P&L; reimbursements
    change both companies together. Ledger rules live in their own block in
    `firestore.rules` with tests in `tests/rules/ledger.rules.test.mjs`.

## Commands (PowerShell, from `C:\dev\dal-tracker`)
- `npm run test:ledger` — Books core tests (money, transfers, intercompany, reconcile, P&L, import, migration)
- `npm run test:api` — API unit tests (node:test)
- `npx react-scripts test --watchAll=false` — React unit tests
- `npm run test:rules` — Firestore/Storage rules tests (needs Java + firebase-tools)
- `npm run check:secrets:src` — client-secret guard

## Workflow
Branch → PR → CI green → independent review → merge → delete branch → confirm the
Vercel production deployment, and check it again ~10 minutes later.
