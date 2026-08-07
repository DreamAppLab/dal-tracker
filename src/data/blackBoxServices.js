const BLACK_BOX_SERVICES = [

  // ── APP STORE / DISTRIBUTION ──────────────────────────────
  {
    key: 'app_store_connect',
    label: 'App Store Connect',
    category: 'App Store / Distribution',
    fields: [
      { fieldName: 'App ID', fieldDescription: 'Numeric App Store Connect App ID' },
      { fieldName: 'Bundle ID', fieldDescription: 'e.g. com.dreamapplab.appname' },
      { fieldName: 'Apple Team ID', fieldDescription: '10-character team identifier' },
      { fieldName: 'ASC API Key ID', fieldDescription: 'Key ID from App Store Connect API Keys' },
      { fieldName: 'Issuer ID', fieldDescription: 'UUID from App Store Connect API Keys' },
      { fieldName: 'p8 Key File Location', fieldDescription: 'Local path to downloaded .p8 file' },
      { fieldName: 'Account', fieldDescription: 'personal (5RW33UU93C) or DAL org (CAT6U7K4K5)' },
      { fieldName: 'Distribution Cert ID', fieldDescription: 'Certificate ID from Apple Developer portal' },
      { fieldName: 'Cert Expiry', fieldDescription: 'Certificate expiry date' },
    ]
  },
  {
    key: 'google_play',
    label: 'Google Play Console',
    category: 'App Store / Distribution',
    fields: [
      { fieldName: 'Package Name', fieldDescription: 'e.g. com.dreamapplab.appname' },
      { fieldName: 'Play Store Listing URL', fieldDescription: 'Full URL to Play Store listing' },
      { fieldName: 'Service Account JSON Location', fieldDescription: 'Local path to service account JSON' },
      { fieldName: 'Upload Key Alias', fieldDescription: 'Keystore alias used for upload key' },
      { fieldName: 'Keystore Location', fieldDescription: 'Local path to .jks or .keystore file' },
    ]
  },
  {
    key: 'expo_eas',
    label: 'Expo / EAS',
    category: 'App Store / Distribution',
    fields: [
      { fieldName: 'EAS Project ID', fieldDescription: 'UUID from eas.json or Expo dashboard' },
      { fieldName: 'EAS Project Slug', fieldDescription: 'Slug from app.json' },
      { fieldName: 'Expo Account', fieldDescription: 'dreamapplab' },
      { fieldName: 'Last Build Number', fieldDescription: 'Most recent build number submitted' },
      { fieldName: 'Branch', fieldDescription: 'main or master' },
    ]
  },

  // ── AUTHENTICATION & IDENTITY ─────────────────────────────
  {
    key: 'firebase',
    label: 'Firebase / Firestore',
    category: 'Authentication & Identity',
    fields: [
      { fieldName: 'Project ID', fieldDescription: 'Firebase project ID' },
      { fieldName: 'Project Name', fieldDescription: 'Human-readable Firebase project name' },
      { fieldName: 'Web API Key', fieldDescription: 'apiKey from Firebase config' },
      { fieldName: 'Auth Domain', fieldDescription: 'authDomain from Firebase config' },
      { fieldName: 'Storage Bucket', fieldDescription: 'storageBucket from Firebase config' },
      { fieldName: 'App Check Status', fieldDescription: 'not started / in progress / live' },
      { fieldName: 'PITR Enabled', fieldDescription: 'yes or no — point-in-time recovery' },
      { fieldName: 'Scheduled Backups', fieldDescription: 'yes or no — daily + weekly backups' },
      { fieldName: 'google-services.json Location', fieldDescription: 'Local path to Android config file' },
      { fieldName: 'GoogleService-Info.plist Location', fieldDescription: 'Local path to iOS config file' },
    ]
  },
  {
    key: 'google_oauth',
    label: 'Google OAuth',
    category: 'Authentication & Identity',
    fields: [
      { fieldName: 'Web Client ID', fieldDescription: 'OAuth 2.0 Web Client ID' },
      { fieldName: 'iOS Client ID', fieldDescription: 'OAuth 2.0 iOS Client ID — required for native Sign-In' },
      { fieldName: 'Android Client ID', fieldDescription: 'OAuth 2.0 Android Client ID' },
      { fieldName: 'Authorized Domains', fieldDescription: 'Comma-separated list of authorized domains' },
    ]
  },
  {
    key: 'apple_signin',
    label: 'Apple Sign-In',
    category: 'Authentication & Identity',
    fields: [
      { fieldName: 'Service ID', fieldDescription: 'Apple Services ID for Sign In with Apple' },
      { fieldName: 'Return URL', fieldDescription: 'Redirect URL registered with Apple' },
      { fieldName: 'Key ID', fieldDescription: 'Key ID from Apple Developer account' },
    ]
  },

  // ── SUBSCRIPTIONS & PAYMENTS ──────────────────────────────
  {
    key: 'revenuecat',
    label: 'RevenueCat',
    category: 'Subscriptions & Payments',
    fields: [
      { fieldName: 'iOS API Key', fieldDescription: 'appl_... public SDK key' },
      { fieldName: 'Android API Key', fieldDescription: 'goog_... public SDK key' },
      { fieldName: 'V2 Secret API Key', fieldDescription: 'RevenueCat V2 secret for Mission Control revenue tab — store env var name only' },
      { fieldName: 'Entitlement IDs', fieldDescription: 'Comma-separated entitlement identifiers' },
      { fieldName: 'Offering ID', fieldDescription: 'Offering identifier e.g. default' },
      { fieldName: 'App Store Shared Secret', fieldDescription: 'From App Store Connect for receipt validation' },
      { fieldName: 'Webhook URL', fieldDescription: 'RevenueCat webhook endpoint if configured' },
    ]
  },
  {
    key: 'stripe',
    label: 'Stripe',
    category: 'Subscriptions & Payments',
    fields: [
      { fieldName: 'Publishable Key', fieldDescription: 'pk_live_... (safe to store)' },
      { fieldName: 'Secret Key Env Var Name', fieldDescription: 'Name of env var only — never paste the secret itself' },
      { fieldName: 'Webhook Signing Secret Env Var', fieldDescription: 'Env var name for whsec_...' },
      { fieldName: 'Account ID', fieldDescription: 'Stripe account ID (acct_...)' },
      { fieldName: 'Stripe Connect', fieldDescription: 'yes or no — marketplace payments' },
    ]
  },
  {
    key: 'apple_iap',
    label: 'Apple IAP',
    category: 'Subscriptions & Payments',
    fields: [
      { fieldName: 'Shared Secret', fieldDescription: 'App-specific shared secret from App Store Connect' },
      { fieldName: 'IAP Key ID', fieldDescription: 'Key ID for p8 In-App Purchase key' },
      { fieldName: 'IAP Issuer ID', fieldDescription: 'Issuer ID for IAP key' },
      { fieldName: 'IAP Key File Location', fieldDescription: 'Local path to SubscriptionKey_XXXXX.p8 file' },
    ]
  },

  // ── EMAIL & MESSAGING ─────────────────────────────────────
  {
    key: 'mailgun',
    label: 'Mailgun',
    category: 'Email & Messaging',
    fields: [
      { fieldName: 'Private API Key Env Var', fieldDescription: 'Name of env var — never paste the key itself' },
      { fieldName: 'Sending Domain', fieldDescription: 'e.g. mg.dreamapplab.com' },
      { fieldName: 'Region', fieldDescription: 'US or EU' },
      { fieldName: 'Inbound Domain', fieldDescription: 'e.g. inbound.dreamapplab.com' },
      { fieldName: 'Webhook Signing Key Env Var', fieldDescription: 'Env var name for webhook signing key' },
      { fieldName: 'MX Records Verified', fieldDescription: 'yes or no' },
      { fieldName: 'DKIM Verified', fieldDescription: 'yes or no' },
    ]
  },
  {
    key: 'brevo',
    label: 'Brevo',
    category: 'Email & Messaging',
    fields: [
      { fieldName: 'API Key Env Var', fieldDescription: 'Name of env var — migrating to Mailgun' },
      { fieldName: 'Sender Email', fieldDescription: 'From address used in sends' },
      { fieldName: 'Sender Name', fieldDescription: 'From name used in sends' },
      { fieldName: 'Migration Status', fieldDescription: 'in progress — moving to Mailgun' },
    ]
  },
  {
    key: 'twilio',
    label: 'Twilio',
    category: 'Email & Messaging',
    fields: [
      { fieldName: 'Account SID', fieldDescription: 'Twilio Account SID (ACxxx...)' },
      { fieldName: 'Auth Token Env Var', fieldDescription: 'Name of env var — never paste token itself' },
      { fieldName: 'Phone Number', fieldDescription: 'Standard Twilio number e.g. +1...' },
      { fieldName: 'Toll-Free Number', fieldDescription: 'Toll-free number e.g. +18447136818' },
      { fieldName: 'A2P Registration Status', fieldDescription: 'pending / approved / not started' },
      { fieldName: 'Messaging Service SID', fieldDescription: 'MGxxx... if using messaging service' },
    ]
  },

  // ── HOSTING & DEPLOYMENT ──────────────────────────────────
  {
    key: 'vercel',
    label: 'Vercel',
    category: 'Hosting & Deployment',
    fields: [
      { fieldName: 'Project Name', fieldDescription: 'Project name in Vercel dashboard' },
      { fieldName: 'Project ID', fieldDescription: 'Vercel project ID' },
      { fieldName: 'Production URL', fieldDescription: 'Live URL e.g. https://appname.vercel.app' },
      { fieldName: 'Env Vars In Use', fieldDescription: 'Comma-separated env var names only — never values' },
      { fieldName: 'Branch', fieldDescription: 'Production branch e.g. main or master' },
      { fieldName: 'Team', fieldDescription: 'dream-app-lab' },
    ]
  },
  {
    key: 'github',
    label: 'GitHub',
    category: 'Hosting & Deployment',
    fields: [
      { fieldName: 'Repo Name', fieldDescription: 'Repository name under DreamAppLab org' },
      { fieldName: 'Org', fieldDescription: 'DreamAppLab' },
      { fieldName: 'Default Branch', fieldDescription: 'main or master' },
      { fieldName: 'Repo URL', fieldDescription: 'Full GitHub repo URL' },
    ]
  },

  // ── ANALYTICS & MONITORING ────────────────────────────────
  {
    key: 'vercel_analytics',
    label: 'Vercel Analytics',
    category: 'Analytics & Monitoring',
    fields: [
      { fieldName: 'Status', fieldDescription: 'enabled or disabled' },
      { fieldName: 'Dashboard URL', fieldDescription: 'URL to analytics in Vercel dashboard' },
    ]
  },
  {
    key: 'plausible',
    label: 'Plausible',
    category: 'Analytics & Monitoring',
    fields: [
      { fieldName: 'Domain', fieldDescription: 'Domain tracked in Plausible' },
      { fieldName: 'API Key Env Var', fieldDescription: 'Name of env var holding Plausible API key' },
    ]
  },
  {
    key: 'sentry',
    label: 'Sentry',
    category: 'Analytics & Monitoring',
    fields: [
      { fieldName: 'DSN', fieldDescription: 'Sentry DSN URL for this app' },
      { fieldName: 'Project Name', fieldDescription: 'Project name in Sentry dashboard' },
      { fieldName: 'Org Slug', fieldDescription: 'Organization slug in Sentry' },
    ]
  },

  // ── DOMAIN & DNS ──────────────────────────────────────────
  {
    key: 'domain',
    label: 'Domain / DNS',
    category: 'Domain & DNS',
    fields: [
      { fieldName: 'Primary Domain', fieldDescription: 'e.g. familylens.click' },
      { fieldName: 'Registrar', fieldDescription: 'Where domain is registered e.g. Vercel, Namecheap' },
      { fieldName: 'Expiry Date', fieldDescription: 'Domain expiry date' },
      { fieldName: 'Auto-Renew', fieldDescription: 'yes or no' },
      { fieldName: 'Universal Links Domain', fieldDescription: 'Domain used for Apple Universal Links' },
      { fieldName: 'AASA Status', fieldDescription: 'not started / deployed / verified' },
      { fieldName: 'assetlinks.json Status', fieldDescription: 'not started / deployed / verified — Android' },
      { fieldName: 'SPF Status', fieldDescription: 'verified or pending' },
      { fieldName: 'DKIM Status', fieldDescription: 'verified or pending' },
    ]
  },

  // ── LEGAL & COMPLIANCE ────────────────────────────────────
  {
    key: 'legal',
    label: 'Legal & Compliance',
    category: 'Legal & Compliance',
    fields: [
      { fieldName: 'Attorney', fieldDescription: 'Attorney name — Allen' },
      { fieldName: 'Privacy Policy URL', fieldDescription: 'Live URL to privacy policy' },
      { fieldName: 'Terms of Service URL', fieldDescription: 'Live URL to terms of service' },
      { fieldName: 'Additional Policy URLs', fieldDescription: 'e.g. WA Consumer Health Data Policy URL' },
      { fieldName: 'Legal Version String', fieldDescription: 'e.g. 2026-07-29 — matches constants/legal.js' },
      { fieldName: 'AsyncStorage Consent Key', fieldDescription: 'Key used to store consent e.g. fl_legal_accepted' },
      { fieldName: 'App Check Status', fieldDescription: 'not started / in progress / live' },
    ]
  },

  // ── AI & EXTERNAL APIS ────────────────────────────────────
  {
    key: 'google_cloud_ai',
    label: 'Google Cloud / Gemini',
    category: 'AI & External APIs',
    fields: [
      { fieldName: 'Google Cloud Project ID', fieldDescription: 'GCP project ID' },
      { fieldName: 'Gemini Model In Use', fieldDescription: 'e.g. gemini-2.5-flash-lite for prompts' },
      { fieldName: 'Gemini API Key Env Var', fieldDescription: 'Name of env var — never paste key itself' },
      { fieldName: 'Billing Enabled', fieldDescription: 'yes or no — must be yes to avoid data training' },
      { fieldName: 'Monthly Budget Alert Set', fieldDescription: 'yes or no — $10 alert in Google Cloud' },
      { fieldName: 'Google Cloud Translation', fieldDescription: 'enabled or not used' },
      { fieldName: 'Translation Billing', fieldDescription: 'per-character, separate from Gemini billing' },
    ]
  },
  {
    key: 'google_places',
    label: 'Google Places',
    category: 'AI & External APIs',
    fields: [
      { fieldName: 'API Key Env Var', fieldDescription: 'Name of env var holding Places API key' },
      { fieldName: 'Enabled APIs', fieldDescription: 'e.g. Places API, Geocoding API' },
      { fieldName: 'Billing Status', fieldDescription: 'active or not configured' },
    ]
  },

  // ── ASO & MARKETING ───────────────────────────────────────
  {
    key: 'aso_dev',
    label: 'ASO.dev',
    category: 'ASO & Marketing',
    fields: [
      { fieldName: 'App ID in ASO.dev', fieldDescription: 'App identifier in ASO.dev dashboard' },
      { fieldName: 'Current Subtitle', fieldDescription: 'Live App Store subtitle (100 char max)' },
      { fieldName: 'Current Keyword String', fieldDescription: 'Live keyword string (100 chars max)' },
      { fieldName: 'Last Keyword Change Date', fieldDescription: 'Date of last metadata change' },
      { fieldName: 'Next Change Window', fieldDescription: '3-4 weeks after last change date' },
    ]
  },
  {
    key: 'massblogger',
    label: 'MassBlogger',
    category: 'ASO & Marketing',
    fields: [
      { fieldName: 'Account Email', fieldDescription: 'Login email for MassBlogger' },
      { fieldName: 'Connected Site', fieldDescription: 'Site URL connected to MassBlogger' },
      { fieldName: 'Post Frequency', fieldDescription: 'e.g. 1 per day' },
      { fieldName: 'Blog Admin Page', fieldDescription: 'URL to DAL blog admin page' },
    ]
  },
];

export default BLACK_BOX_SERVICES;
