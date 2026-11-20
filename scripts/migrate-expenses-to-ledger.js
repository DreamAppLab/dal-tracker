#!/usr/bin/env node
// Migrate the retired `expenses` collection into the Books ledger as DAL
// credit-card transactions. Same job as POST /api/ledger/migrate (which the
// Books → Settings screen calls); this CLI is for running it from a machine
// that has the dal-mission-control service account in its environment:
//   DAL_MC_FIREBASE_PROJECT_ID, DAL_MC_FIREBASE_CLIENT_EMAIL, DAL_MC_FIREBASE_PRIVATE_KEY
//
//   node scripts/migrate-expenses-to-ledger.js              # dry run (default, writes nothing)
//   node scripts/migrate-expenses-to-ledger.js --apply      # back up, migrate, verify
//   node scripts/migrate-expenses-to-ledger.js --rollback   # remove migrated rows
//
// --apply also writes a local JSON backup to backups/ledger-migration/<time>/
// (gitignored) in addition to the server-side ledgerMigrationBackups copy.
// Safe to re-run: already-migrated expenses are skipped.

/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { getMcDb } = require('../api/_lib/firebaseAdmin');
const { migrateExpenses } = require('../api/_lib/ledgerMigration');

async function main() {
  const args = new Set(process.argv.slice(2));
  const mode = args.has('--rollback') ? 'rollback' : args.has('--apply') ? 'apply' : 'dry-run';
  const db = getMcDb();
  if (mode === 'apply') {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(__dirname, '..', 'backups', 'ledger-migration', stamp);
    fs.mkdirSync(dir, { recursive: true });
    for (const name of ['expenses', 'importedStatements']) {
      const snap = await db.collection(name).get();
      fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(snap.docs.map((d) => ({ id: d.id, ...d.data() })), null, 2));
    }
    console.log(`Local backup written to ${dir}`);
  }
  const summary = await migrateExpenses(db, { mode });
  console.log(JSON.stringify(summary, null, 2));
  if (mode === 'apply' && !summary.verified) {
    console.error('VERIFICATION FAILED — totals do not match. Run with --rollback and investigate.');
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
