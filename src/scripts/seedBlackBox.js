import { db } from '../firebase';
import {
  doc,
  getDoc,
  setDoc,
  arrayUnion,
  Timestamp,
} from 'firebase/firestore';

/** Map app IDs used in Mission Control to Black Box Firestore project paths. */
export const BLACKBOX_PROJECT_ID_MAP = {
  familywatch: 'familylens',
};

export function resolveBlackBoxProjectId(projectId) {
  if (!projectId) return projectId;
  return BLACKBOX_PROJECT_ID_MAP[projectId] || projectId;
}

function serviceDoc(projectId, serviceKey) {
  return doc(db, 'projects', projectId, 'blackbox', serviceKey);
}

function configDoc(projectId) {
  return doc(db, 'projects', projectId, 'blackbox', 'services_config');
}

/**
 * Merge only missing field keys into fields map.
 * Never writes notes. Never overwrites existing non-empty values.
 */
async function mergeMissingFields(docRef, newFields) {
  const snap = await getDoc(docRef);
  const existing = snap.exists() ? (snap.data().fields || {}) : {};
  const toWrite = {};

  Object.entries(newFields).forEach(([key, value]) => {
    const current = existing[key];
    if (current === undefined || current === null || current === '') {
      toWrite[key] = value;
    }
  });

  if (Object.keys(toWrite).length === 0) return;

  // Preserve all existing keys by writing the full merged fields object
  await setDoc(docRef, { fields: { ...existing, ...toWrite } }, { merge: true });
}

/** Enable services via arrayUnion — never replaces the enabledServices array. */
async function enableServices(projectId, serviceKeys) {
  const ref = configDoc(projectId);
  await setDoc(
    ref,
    { enabledServices: arrayUnion(...serviceKeys) },
    { merge: true }
  );
}

const SEED = {
  familythread: {
    enabledServices: [
      'app_store_connect', 'expo_eas', 'firebase', 'google_oauth',
      'revenuecat', 'mailgun', 'brevo', 'twilio', 'github', 'legal', 'google_cloud_ai',
    ],
    services: {
      app_store_connect: {
        'App ID': '6797315166',
        'Bundle ID': 'com.dreamapplab.familythread',
        'Apple Team ID': 'CAT6U7K4K5',
        'Account': 'DAL org (CAT6U7K4K5) — lab@dreamapplab.com',
        'Distribution Cert ID': '72C6BDC7C73D54B3C149C1AEDD2E9D69',
        'Cert Expiry': 'July 2027',
        'ASC API Key ID': 'CW6SNUM9L2',
        'Issuer ID': '1f65c000-4aff-4152-a635-65121626d216',
        'p8 Key File Location': 'C:\\dev\\keys\\AuthKey_CW6SNUM9L2.p8',
      },
      expo_eas: {
        'EAS Project ID': 'd0da4178-3d09-4149-8db3-30f7f96b40a2',
        'EAS Project Slug': 'familythread',
        'Expo Account': 'dreamapplab',
        'Branch': 'main',
      },
      firebase: {
        'Project ID': 'familythread-prod',
        'Auth Domain': 'familythread-prod.firebaseapp.com',
        'Storage Bucket': 'familythread-prod.appspot.com',
        'App Check Status': 'not started — required before public launch',
        'PITR Enabled': 'yes',
        'Scheduled Backups': 'yes',
      },
      google_oauth: {
        'Web Client ID': '405396466649-k7s0eq40galb058rlk4hbvt2etm43j4k.apps.googleusercontent.com',
      },
      revenuecat: {
        'iOS API Key': 'appl_FVBzJZnrqoDNuKatMuwnAstjjGB',
        'V2 Secret API Key': 'stored as REACT_APP_REVENUECAT_SECRET_FAMILYTHREAD in Vercel',
        'Entitlement IDs': 'thread_access, tapestry_access',
      },
      mailgun: {
        'Sending Domain': 'dreamapplab.com',
        'Inbound Domain': 'inbound.dreamapplab.com',
        'Region': 'US',
        'MX Records Verified': 'yes',
        'DKIM Verified': 'yes',
      },
      brevo: {
        'Migration Status': 'in progress — migrating outbound to Mailgun',
        'Sender Email': 'lab@dreamapplab.com',
      },
      twilio: {
        'Toll-Free Number': '+18447136818',
        'A2P Registration Status': 'pending carrier approval',
      },
      github: {
        'Repo Name': 'familythread',
        'Org': 'DreamAppLab',
        'Default Branch': 'main',
        'Repo URL': 'https://github.com/DreamAppLab/familythread',
      },
      legal: {
        'Attorney': 'Allen',
        'Legal Version String': '2026-07-29',
        'App Check Status': 'not started — required before public launch',
      },
      google_cloud_ai: {
        'Google Cloud Project ID': 'familythread-prod',
        'Gemini Model In Use': 'gemini-2.5-flash-lite — prompt generation only',
        'Billing Enabled': 'no — PENDING: enable paid tier to resolve data training concern',
        'Monthly Budget Alert Set': 'no — PENDING',
        'Google Cloud Translation': 'enabled — translates lore entries once at write time',
        'Translation Billing': 'per-character, billed separately from Gemini',
      },
    },
  },

  familylens: {
    enabledServices: [
      'app_store_connect', 'expo_eas', 'firebase', 'google_oauth',
      'revenuecat', 'github', 'legal',
    ],
    services: {
      app_store_connect: {
        'App ID': '6786412443',
        'Bundle ID': 'com.dreamapplab.familywatch',
        'Apple Team ID': '5RW33UU93C',
        'Account': 'personal (5RW33UU93C) — transfer to DAL org after first public release',
        'ASC API Key ID': 'CW6SNUM9L2',
        'Issuer ID': '1f65c000-4aff-4152-a635-65121626d216',
        'p8 Key File Location': 'C:\\dev\\keys\\AuthKey_CW6SNUM9L2.p8',
      },
      expo_eas: {
        'EAS Project ID': '4a7ae746-57f6-4c27-b585-be5aeba84060',
        'EAS Project Slug': 'familywatch',
        'Expo Account': 'dreamapplab',
        'Branch': 'master',
      },
      firebase: {
        'Project ID': 'familywatch-8b302',
        'Auth Domain': 'familywatch-8b302.firebaseapp.com',
        'App Check Status': 'not started — required before public launch',
        'PITR Enabled': 'no — PENDING security checklist step 1',
        'Scheduled Backups': 'no — PENDING security checklist step 1',
      },
      google_oauth: {
        'Web Client ID': 'stored as EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in EAS secrets',
        'iOS Client ID': 'PENDING — required for native iOS Google Sign-In',
      },
      revenuecat: {
        'V2 Secret API Key': 'stored as REACT_APP_REVENUECAT_SECRET_FAMILYWATCH in Vercel',
        'Entitlement IDs': 'standard_access, family_access',
      },
      github: {
        'Repo Name': 'familywatch',
        'Org': 'DreamAppLab',
        'Default Branch': 'master',
        'Repo URL': 'https://github.com/DreamAppLab/familywatch',
      },
      legal: {
        'Attorney': 'Allen',
        'Legal Version String': '2026-07-29',
        'AsyncStorage Consent Key': 'fl_legal_accepted',
        'Additional Policy URLs': 'WA Consumer Health Data Privacy Policy',
        'App Check Status': 'not started — required before public launch',
      },
    },
  },

  flarepad: {
    enabledServices: [
      'app_store_connect', 'expo_eas', 'firebase', 'revenuecat',
      'apple_iap', 'github', 'domain', 'legal', 'aso_dev',
    ],
    services: {
      app_store_connect: {
        'App ID': '6781827211',
        'Bundle ID': 'com.dreamapplab.flarepad',
        'Apple Team ID': 'CAT6U7K4K5',
        'Account': 'DAL org (CAT6U7K4K5) — lab@dreamapplab.com',
        'ASC API Key ID': 'CW6SNUM9L2',
        'Issuer ID': '1f65c000-4aff-4152-a635-65121626d216',
        'p8 Key File Location': 'C:\\dev\\keys\\AuthKey_CW6SNUM9L2.p8',
        'Distribution Cert ID': 'FQ78WWT9V3',
        'Cert Expiry': 'July 29, 2027',
      },
      expo_eas: {
        'Expo Account': 'dreamapplab',
        'Branch': 'master',
      },
      revenuecat: {
        'iOS API Key': 'appl_hqrITWHNSUZFVabiFXYSainMADe',
        'Android API Key': 'goog_VnERWdjWQMYTUWBuDrUPbiOKQSK',
        'V2 Secret API Key': 'stored as REACT_APP_REVENUECAT_SECRET_FLAREPAD in Vercel',
        'Entitlement IDs': 'flarepad_standard, flarepad_pro',
      },
      apple_iap: {
        'IAP Key ID': '59AT49658X',
        'IAP Issuer ID': '1f65c000-4aff-4152-a635-65121626d216',
        'IAP Key File Location': 'C:\\dev\\keys\\SubscriptionKey_59AT49658X.p8',
      },
      github: {
        'Repo Name': 'flarepad',
        'Org': 'DreamAppLab',
        'Default Branch': 'master',
        'Repo URL': 'https://github.com/DreamAppLab/flarepad',
      },
      domain: {
        'Primary Domain': 'flarepad.click',
        'Registrar': 'Vercel',
        'Universal Links Domain': 'flarepad.click',
      },
      legal: {
        'Attorney': 'Allen',
        'Privacy Policy URL': 'https://flarepad.click/privacy',
        'Terms of Service URL': 'https://flarepad.click/terms',
        'Legal Version String': '1.0',
        'App Check Status': 'not started — required before public launch',
      },
      aso_dev: {
        'Current Subtitle': 'Symptom & Flare Tracker',
        'Current Keyword String': 'migraine,headache,allergy,pain,ibs,chronic,illness,journal,log,health,nausea,fatigue,anxiety,crohn',
        'Next Change Window': 'September 7, 2026 — also age ratings social media questions due this date',
      },
    },
  },

  logabode: {
    enabledServices: [
      'app_store_connect', 'expo_eas', 'revenuecat', 'apple_iap',
      'github', 'domain', 'legal',
    ],
    services: {
      app_store_connect: {
        'Bundle ID': 'com.dreamapplab.logabode',
        'Apple Team ID': 'CAT6U7K4K5',
        'Account': 'DAL org (CAT6U7K4K5) — transfer pending (invisible whitespace in TestFlight fields)',
        'ASC API Key ID': '8R3CK8VK7K',
        'Issuer ID': '3f3aa3d0-e7ed-4371-b543-678581b04b14',
      },
      revenuecat: {
        'V2 Secret API Key': 'stored as REACT_APP_REVENUECAT_SECRET_LOGABODE in Vercel',
        'Entitlement IDs': 'pro_access',
      },
      github: {
        'Repo Name': 'logabode',
        'Org': 'DreamAppLab',
        'Default Branch': 'master',
        'Repo URL': 'https://github.com/DreamAppLab/logabode',
      },
      domain: {
        'Primary Domain': 'logabode.click',
        'Universal Links Domain': 'logabode.click',
        'AASA Status': 'deployed',
        'assetlinks.json Status': 'deployed',
      },
      legal: {
        'Attorney': 'Allen',
        'App Check Status': 'not started — required before public launch',
      },
    },
  },
};

const DAL_WIDE_FIELDS = {
  'Apple Org Team ID': 'CAT6U7K4K5',
  'Apple Org Apple ID': 'lab@dreamapplab.com',
  'Personal Apple ID': '5RW33UU93C (Edward Joseph Skehan)',
  'ASC API Key ID': 'CW6SNUM9L2',
  'ASC Issuer ID': '1f65c000-4aff-4152-a635-65121626d216',
  'IAP Key ID': '59AT49658X',
  'IAP Issuer ID': '1f65c000-4aff-4152-a635-65121626d216',
  'Distribution Cert': 'FQ78WWT9V3 — shared across DAL org apps, expires July 2027',
  'GitHub Org': 'DreamAppLab',
  'Vercel Team': 'dream-app-lab',
  'Attorney': 'Allen',
  'Mailgun Sending Domain': 'dreamapplab.com',
  'Mailgun Inbound Domain': 'inbound.dreamapplab.com',
  'Twilio Toll-Free': '+18447136818 — pending A2P carrier approval',
  'Brevo Status': 'migrating to Mailgun — in progress',
  'ASO Tool': 'ASO.dev — Indie plan active',
  'Google Workspace': 'lab@dreamapplab.com',
};

/**
 * One-time (re-runnable) seed. Every write uses setDoc({ merge: true }).
 * Only fills missing field values. Never writes notes.
 */
export async function runSeedBlackBox() {
  for (const [projectId, payload] of Object.entries(SEED)) {
    await enableServices(projectId, payload.enabledServices);

    for (const [serviceKey, fields] of Object.entries(payload.services)) {
      await mergeMissingFields(serviceDoc(projectId, serviceKey), fields);
    }
  }

  // DAL-wide HQ doc — merge fields only; never touch notes or other existing keys
  await mergeMissingFields(doc(db, 'blackbox', 'dal_wide'), DAL_WIDE_FIELDS);

  await setDoc(
    doc(db, 'blackbox_global', 'seed_status'),
    { seeded: true, seededAt: Timestamp.now() },
    { merge: true }
  );

  return { ok: true };
}

export async function getSeedStatus() {
  const snap = await getDoc(doc(db, 'blackbox_global', 'seed_status'));
  if (!snap.exists()) return { seeded: false };
  return snap.data();
}
