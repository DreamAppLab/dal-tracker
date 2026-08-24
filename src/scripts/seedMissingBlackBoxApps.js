import { db } from '../firebase';
import {
  doc,
  getDoc,
  setDoc,
  arrayUnion,
} from 'firebase/firestore';

export const MISSING_BLACKBOX_APP_IDS = ['familythread', 'travelwhirl', 'theshadyduck'];

const STATUS_REF = doc(db, 'blackbox_global', 'missing_apps_seed');

function serviceDoc(projectId, serviceKey) {
  return doc(db, 'projects', projectId, 'blackbox', serviceKey);
}

function configDoc(projectId) {
  return doc(db, 'projects', projectId, 'blackbox', 'services_config');
}

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

  await setDoc(docRef, { fields: { ...existing, ...toWrite } }, { merge: true });
}

async function enableServices(projectId, serviceKeys) {
  await setDoc(
    configDoc(projectId),
    { enabledServices: arrayUnion(...serviceKeys) },
    { merge: true }
  );
}

async function seedProject(projectId, payload) {
  await enableServices(projectId, payload.enabledServices);
  for (const [serviceKey, fields] of Object.entries(payload.services)) {
    await mergeMissingFields(serviceDoc(projectId, serviceKey), fields);
  }
}

/** FamilyThread — from seedBlackBox.js SEED.familythread */
const FAMILYTHREAD = {
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
};

/** The Shady Duck — from seedBlackBox.js SEED['the-shady-duck-1786096352922'] */
const THESHADYDUCK = {
  enabledServices: [
    'firebase', 'github', 'vercel', 'domain',
    'mailgun', 'twilio', 'legal',
  ],
  services: {
    firebase: {
      'Project ID': 'the-shady-duck',
      'App Check Status': 'not started — required before public launch',
      'PITR Enabled': 'no — PENDING security checklist step 1',
      'Scheduled Backups': 'no — PENDING security checklist step 1',
    },
    github: {
      'Repo Name': 'theshadyduck-site',
      'Org': 'DreamAppLab',
      'Default Branch': 'main',
      'Repo URL': 'https://github.com/DreamAppLab/theshadyduck-site',
    },
    vercel: {
      'Production URL': 'https://theshadyduck.com',
      'Team': 'dream-app-lab',
      'Branch': 'main',
    },
    domain: {
      'Primary Domain': 'theshadyduck.com',
      'Universal Links Domain': 'theshadyduck.com',
    },
    mailgun: {
      'Sending Domain': 'inbound.dreamapplab.com',
      'Inbound Domain': 'inbound.dreamapplab.com',
      'Region': 'US',
      'MX Records Verified': 'yes',
      'DKIM Verified': 'yes',
      'Private API Key Env Var': 'MAILGUN_API_KEY',
    },
    twilio: {
      'Toll-Free Number': '+18447136818',
      'A2P Registration Status': 'pending carrier approval',
    },
    legal: {
      'Privacy Policy URL': 'https://theshadyduck.com/privacy-policy',
      'Terms of Service URL': 'https://theshadyduck.com/terms-of-service',
      'Attorney': 'Allen',
    },
  },
};

const TRAVELWHIRL = {
  enabledServices: [
    'app_store_connect', 'expo_eas', 'firebase', 'github', 'twilio',
  ],
  services: {
    app_store_connect: {
      'App ID': '6800067381',
      'Bundle ID': 'com.dreamapplab.travelwhirl',
      'Apple Team ID': 'CAT6U7K4K5',
    },
    expo_eas: {
      'EAS Project ID': 'fe9a9b49-09f8-4e4c-a194-23c2297dc46c',
      'EAS Project Slug': 'travelwhirl',
      'Expo Account': 'dreamapplab',
    },
    firebase: {
      'Project ID': 'travelwhirl-prod',
    },
    github: {
      'Repo Name': 'travelwhirl',
      'Org': 'DreamAppLab',
      'Repo URL': 'https://github.com/DreamAppLab/travelwhirl',
    },
    twilio: {
      'Phone Number': '+18443522180',
    },
  },
};

const SEED = {
  familythread: FAMILYTHREAD,
  travelwhirl: TRAVELWHIRL,
  theshadyduck: THESHADYDUCK,
};

export async function getMissingBlackBoxAppsStatus() {
  const statusSnap = await getDoc(STATUS_REF);
  if (statusSnap.exists() && statusSnap.data()?.seeded) {
    return { seeded: true, missingIds: [] };
  }

  const missingIds = [];
  for (const appId of MISSING_BLACKBOX_APP_IDS) {
    const snap = await getDoc(configDoc(appId));
    if (!snap.exists()) missingIds.push(appId);
  }

  return { seeded: missingIds.length === 0, missingIds };
}

/**
 * Seed Black Box services_config + per-service field docs for
 * familythread, travelwhirl, and theshadyduck.
 * Uses setDoc({ merge: true }) / arrayUnion — never overwrites existing values.
 */
export async function runSeedMissingBlackBoxApps() {
  const logs = [];

  for (const [projectId, payload] of Object.entries(SEED)) {
    await seedProject(projectId, payload);
    const line = `${projectId}: seeded ${payload.enabledServices.length} services`;
    logs.push(line);
    console.log(line);
  }

  await setDoc(
    STATUS_REF,
    { seeded: true, seededAt: new Date().toISOString() },
    { merge: true }
  );

  return { ok: true, logs };
}

if (typeof window !== 'undefined') {
  window.runSeedMissingBlackBoxApps = runSeedMissingBlackBoxApps;
}
