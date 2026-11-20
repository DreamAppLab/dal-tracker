# DAL Mission Control

Dream App Lab's internal operations hub: apps, websites, client projects, quotes,
revenue, expenses, maintenance, and (from Part B) the company vault for
Dream App Lab LLC and Zerbiq.

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
| `GITHUB_TOKEN`, `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `SENTRY_AUTH_TOKEN`, `POSTHOG_PERSONAL_API_KEY`, `EXPO_TOKEN`, `CRISP_API_IDENTIFIER`, `CRISP_API_KEY`, `CRISP_WEBSITE_IDS`, `UPTIMEROBOT_API_KEY` | Tools Hub / Website Analytics |
| `FT_ADMIN_SECRET` | FamilyThread admin proxy |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | SMS |
| `STRIPE_SECRET_KEY` | payment links |
| `REACT_APP_FT_*`, `REACT_APP_ZERBIQ_FIREBASE_*` (public) | Firebase **web** config only — never secrets |
