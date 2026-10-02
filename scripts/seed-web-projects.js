// Seed script: adds coastal-brew-001 to webProjects collection
// Run: node scripts/seed-web-projects.js
// Requires DAL_MC_FIREBASE_* env vars (run `vercel env pull .env.local` first or set manually)
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env.production.local' });

const { initializeApp, cert, getApps, getApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const projectId = process.env.DAL_MC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.DAL_MC_FIREBASE_CLIENT_EMAIL;
let privateKey = process.env.DAL_MC_FIREBASE_PRIVATE_KEY || '';
// Handle both literal \n strings and already-newlined keys
if (privateKey.includes('\\n')) privateKey = privateKey.replace(/\\n/g, '\n');
// Strip surrounding quotes if present
privateKey = privateKey.replace(/^["']|["']$/g, '');

if (!projectId || !clientEmail || !privateKey) {
  console.error('Missing DAL_MC_FIREBASE_* env vars. Run `vercel env pull .env.production.local` first.');
  process.exit(1);
}

let app;
try { app = getApp('seed'); } catch { app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) }, 'seed'); }

const db = getFirestore(app);

async function seed() {
  const docRef = db.collection('webProjects').doc('coastal-brew-001');
  const existing = await docRef.get();
  if (existing.exists) {
    console.log('coastal-brew-001 already exists — skipping');
    return;
  }
  await docRef.set({
    project_id: 'coastal-brew-001',
    project_name: 'Coastal Brew Demo',
    contact_id: null,
    contact_name: 'Test Client',
    preview_url: 'https://coastal-brew-demo.vercel.app',
    status: 'active',
    created_at: new Date(),
  });
  console.log('✅ Seeded coastal-brew-001 to webProjects');
}

seed().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
