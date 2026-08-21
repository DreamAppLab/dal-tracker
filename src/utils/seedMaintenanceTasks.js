import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';

export const APPS = [
  {
    appId: 'familythread',
    appName: 'FamilyThread',
    config: {
      hasFirebase: true, hasCloudFunctions: true, hasRevenueCat: true,
      hasSentry: true, hasCrisp: true, hasWebEndpoints: false,
      hasFreeTrial: false, liveIOS: false, liveAndroid: false,
      services: ['Twilio', 'Mailgun'],
    },
  },
  {
    appId: 'familylens',
    appName: 'FamilyLens',
    config: {
      hasFirebase: true, hasCloudFunctions: true, hasRevenueCat: true,
      hasSentry: true, hasCrisp: false, hasWebEndpoints: false,
      hasFreeTrial: true, liveIOS: false, liveAndroid: false,
      services: ['Google Places'],
    },
  },
  {
    appId: 'travelwhirl',
    appName: 'TravelWhirl',
    config: {
      hasFirebase: true, hasCloudFunctions: true, hasRevenueCat: true,
      hasSentry: true, hasCrisp: true, hasWebEndpoints: false,
      hasFreeTrial: true, liveIOS: false, liveAndroid: false,
      services: ['Twilio', 'Gemini AI', 'Travelpayouts'],
    },
  },
  {
    appId: 'flarepad',
    appName: 'Flarepad',
    config: {
      hasFirebase: false, hasCloudFunctions: false, hasRevenueCat: true,
      hasSentry: false, hasCrisp: false, hasWebEndpoints: false,
      hasFreeTrial: false, liveIOS: true, liveAndroid: true,
      services: [],
    },
  },
  {
    appId: 'logabode',
    appName: 'Logabode',
    config: {
      hasFirebase: false, hasCloudFunctions: false, hasRevenueCat: true,
      hasSentry: false, hasCrisp: false, hasWebEndpoints: false,
      hasFreeTrial: false, liveIOS: true, liveAndroid: true,
      services: ['Google Places'],
    },
  },
  {
    appId: 'shadyduck',
    appName: 'The Shady Duck',
    config: {
      hasFirebase: true, hasCloudFunctions: true, hasRevenueCat: false,
      hasSentry: false, hasCrisp: false, hasWebEndpoints: true,
      hasFreeTrial: false, liveIOS: false, liveAndroid: false,
      services: ['Twilio', 'Mailgun'],
    },
  },
];

export const TASK_TEMPLATES = [
  { taskId: 'w1', label: 'Check GCP billing for unexpected spikes', frequency: 'weekly', anchorDay: 1, anchorMonths: null, fixedDate: null, appliesWhen: ['hasFirebase'], description: 'Firebase Console → Usage and billing. Look for unexpected read/write/storage spikes.' },
  { taskId: 'w2', label: 'Review RevenueCat dashboard for subscription events', frequency: 'weekly', anchorDay: 1, anchorMonths: null, fixedDate: null, appliesWhen: ['hasRevenueCat'], description: 'Check that purchases, renewals, and cancellations are flowing correctly.' },
  { taskId: 'w3', label: 'Check Sentry for new crash spikes', frequency: 'weekly', anchorDay: 1, anchorMonths: null, fixedDate: null, appliesWhen: ['hasSentry'], description: 'Sentry dashboard → Issues. Look for new issues or spikes in existing ones.' },

  { taskId: 'm1', label: 'Review ASO keyword rankings', frequency: 'monthly', anchorDay: 1, anchorMonths: null, fixedDate: null, appliesWhen: ['liveIOS'], description: 'ASO.dev → check keyword rankings. Change ONE metadata element max per month. Wait 3-4 weeks before changing another.' },
  { taskId: 'm2', label: 'Check app ratings and reviews', frequency: 'monthly', anchorDay: 1, anchorMonths: null, fixedDate: null, appliesWhen: ['liveIOS'], description: 'App Store Connect → Ratings and Reviews. Respond to any new reviews.' },
  { taskId: 'm3', label: 'Verify Sentry error rate is stable', frequency: 'monthly', anchorDay: 1, anchorMonths: null, fixedDate: null, appliesWhen: ['hasSentry'], description: 'Check Sentry trends month over month. Investigate any new recurring errors.' },
  { taskId: 'm4', label: 'Review Google Play ratings and reviews', frequency: 'monthly', anchorDay: 1, anchorMonths: null, fixedDate: null, appliesWhen: ['liveAndroid'], description: 'Google Play Console → Ratings. Respond to any new reviews.' },

  { taskId: 'q1', label: 'Update EAS CLI', frequency: 'quarterly', anchorDay: 1, anchorMonths: [1, 4, 7, 10], fixedDate: null, appliesWhen: [], description: 'Run: npm install -g eas-cli in PowerShell. Verify with: eas --version' },
  { taskId: 'q2', label: 'Verify RevenueCat API key still valid', frequency: 'quarterly', anchorDay: 1, anchorMonths: [1, 4, 7, 10], fixedDate: null, appliesWhen: ['hasRevenueCat'], description: 'RevenueCat dashboard → API Keys. Confirm iOS and Android keys are active.' },
  { taskId: 'q3', label: 'Verify Sentry DSN and auth token still valid', frequency: 'quarterly', anchorDay: 1, anchorMonths: [1, 4, 7, 10], fixedDate: null, appliesWhen: ['hasSentry'], description: 'Sentry → Settings → Auth Tokens. Confirm token not expired.' },
  { taskId: 'q4', label: 'Verify GCP budget alerts still active', frequency: 'quarterly', anchorDay: 1, anchorMonths: [1, 4, 7, 10], fixedDate: null, appliesWhen: ['hasFirebase'], description: 'GCP Console → Billing → Budgets and alerts. Confirm alert is still set and email is correct.' },
  { taskId: 'q5', label: 'Verify PITR and scheduled backups still active', frequency: 'quarterly', anchorDay: 1, anchorMonths: [1, 4, 7, 10], fixedDate: null, appliesWhen: ['hasFirebase'], description: 'Firebase Console → Firestore → Backups. Confirm PITR enabled and scheduled backup running.' },
  { taskId: 'q6', label: 'Verify App Check enforcement still active', frequency: 'quarterly', anchorDay: 1, anchorMonths: [1, 4, 7, 10], fixedDate: null, appliesWhen: ['hasFirebase', 'liveIOS'], description: 'Firebase Console → App Check → confirm Enforced status on all registered apps.' },
  { taskId: 'q7', label: 'Audit Firestore security rules', frequency: 'quarterly', anchorDay: 1, anchorMonths: [1, 4, 7, 10], fixedDate: null, appliesWhen: ['hasFirebase'], description: 'Review firestore.rules for any collections missing explicit rules. Run emulator test suite.' },
  { taskId: 'q8', label: 'Clean dev folder', frequency: 'quarterly', anchorDay: 1, anchorMonths: [1, 4, 7, 10], fixedDate: null, appliesWhen: [], description: 'C:\\dev\\[appname] — remove stray screenshots, build artifacts, test files not in .gitignore.' },
  { taskId: 'q9', label: 'Verify ASC API key still valid', frequency: 'quarterly', anchorDay: 1, anchorMonths: [1, 4, 7, 10], fixedDate: null, appliesWhen: ['liveIOS'], description: 'App Store Connect → Users and Access → Integrations → API Keys. Confirm key not expired.' },
  { taskId: 'q10', label: 'Verify Twilio account and toll-free registration still active', frequency: 'quarterly', anchorDay: 1, anchorMonths: [1, 4, 7, 10], fixedDate: null, appliesWhen: [], description: 'Twilio Console → check account balance, toll-free number status, and message delivery rates.', appliesToServices: ['Twilio'] },
  { taskId: 'q11', label: 'Verify Mailgun sending domain health', frequency: 'quarterly', anchorDay: 1, anchorMonths: [1, 4, 7, 10], fixedDate: null, appliesWhen: [], description: 'Mailgun → Sending → Domains. Check domain reputation, bounce rate, and suppression list.', appliesToServices: ['Mailgun'] },
  { taskId: 'q12', label: 'Verify Google Places API key quota and status', frequency: 'quarterly', anchorDay: 1, anchorMonths: [1, 4, 7, 10], fixedDate: null, appliesWhen: [], description: 'GCP Console → APIs → Places API. Check quota usage and confirm key restrictions are correct.', appliesToServices: ['Google Places'] },
  { taskId: 'q13', label: 'Verify Gemini AI API key and paid tier active', frequency: 'quarterly', anchorDay: 1, anchorMonths: [1, 4, 7, 10], fixedDate: null, appliesWhen: [], description: 'GCP Console → Gemini API. Confirm paid tier is active to prevent user data training on free tier.', appliesToServices: ['Gemini AI'] },
  { taskId: 'q14', label: 'Verify Travelpayouts affiliate account active', frequency: 'quarterly', anchorDay: 1, anchorMonths: [1, 4, 7, 10], fixedDate: null, appliesWhen: [], description: 'Travelpayouts dashboard → confirm account active, links working, and payment threshold status.', appliesToServices: ['Travelpayouts'] },
  { taskId: 'q15', label: 'Verify Crisp workspace active and chat widget working', frequency: 'quarterly', anchorDay: 1, anchorMonths: [1, 4, 7, 10], fixedDate: null, appliesWhen: ['hasCrisp'], description: 'Crisp dashboard → confirm workspace active, test chat widget in app.' },
  { taskId: 'q16', label: 'Verify uptime monitors active and alert contacts current', frequency: 'quarterly', anchorDay: 1, anchorMonths: [1, 4, 7, 10], fixedDate: null, appliesWhen: ['hasWebEndpoints'], description: 'Better Stack → confirm monitors active and alert email/SMS contacts are correct.' },

  { taskId: 'a1', label: 'Run deletion cascade audit', frequency: 'annual', anchorDay: null, anchorMonths: null, fixedDate: '01-15', appliesWhen: ['hasFirebase'], description: 'Verify all Firestore + Firebase Storage data is fully purged on user delete. Check Auth record, user doc, subcollections, family data, Storage files, RevenueCat record.' },
  { taskId: 'a2', label: 'Review and rotate Firebase service account keys', frequency: 'annual', anchorDay: null, anchorMonths: null, fixedDate: '01-15', appliesWhen: ['hasFirebase'], description: 'GCP Console → IAM → Service Accounts. Rotate any keys older than 12 months.' },
  { taskId: 'a3', label: 'Review firebase-functions SDK version', frequency: 'annual', anchorDay: null, anchorMonths: null, fixedDate: '01-15', appliesWhen: ['hasCloudFunctions'], description: 'functions/package.json → check firebase-functions version. Schedule upgrade deliberately in a separate test session — never opportunistically.' },
  { taskId: 'a4', label: 'Update legal pages if features changed — notify Allen', frequency: 'annual', anchorDay: null, anchorMonths: null, fixedDate: '01-15', appliesWhen: [], description: 'Review TOS and Privacy Policy for all apps. If any new data is collected or features added, update docs and email Allen at [Allen email].' },

  { taskId: 'f1', label: 'Apple iOS release — test all apps on new iOS', frequency: 'fixed', anchorDay: null, anchorMonths: null, fixedDate: '09-15', appliesWhen: [], description: 'Apple releases new iOS in September. Install beta or release on test device. Run through all app flows. Check for deprecated API warnings in Xcode.' },
  { taskId: 'f2', label: 'Google Play target API level deadline', frequency: 'fixed', anchorDay: null, anchorMonths: null, fixedDate: '08-31', appliesWhen: ['liveAndroid'], description: 'Google Play requires apps to target the latest Android API level by August 31 each year. Verify targetSdkVersion meets requirement or app updates will be blocked.' },
  { taskId: 'f3', label: 'Apple WWDC — review announcements', frequency: 'fixed', anchorDay: null, anchorMonths: null, fixedDate: '06-10', appliesWhen: [], description: 'Apple WWDC typically in early June. Review announcements for deprecated APIs, new requirements, and anything affecting your stack. Plan ahead for September release.' },
  { taskId: 'f4', label: 'Expo SDK major release — plan upgrade window', frequency: 'fixed', anchorDay: null, anchorMonths: null, fixedDate: '11-01', appliesWhen: [], description: 'Expo SDK major releases typically in fall. Check expo.dev/changelog. Plan a dedicated upgrade session — never upgrade opportunistically mid-feature.' },
];

export function taskAppliesToApp(task, config) {
  if (task.frequency === 'weekly' && !config.liveIOS && !config.liveAndroid) {
    return false;
  }
  const flags = task.appliesWhen || [];
  const flagsOk = flags.length === 0 || flags.every((key) => config[key] === true);
  const needed = task.appliesToServices;
  const servicesOk = !needed || needed.some((s) => (config.services || []).includes(s));
  return flagsOk && servicesOk;
}

function tasksForApp(config) {
  const createdAt = Timestamp.now();
  return TASK_TEMPLATES.filter((t) => taskAppliesToApp(t, config)).map((t) => ({
    taskId: t.taskId,
    label: t.label,
    description: t.description,
    frequency: t.frequency,
    anchorDay: t.anchorDay,
    anchorMonths: t.anchorMonths,
    fixedDate: t.fixedDate,
    appliesWhen: t.appliesWhen || [],
    enabled: true,
    createdAt,
  }));
}

export async function seedAllApps() {
  await Promise.all(
    APPS.map((app) =>
      setDoc(
        doc(db, 'maintenanceSchedules', app.appId),
        {
          appId: app.appId,
          appName: app.appName,
          config: app.config,
          tasks: tasksForApp(app.config),
        },
        { merge: true }
      )
    )
  );
}
