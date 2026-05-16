// Cleanup des vestiges du refactor Ticket multi-app (reverté)
// ============================================================
//
// Le refactor Ticket/Prediction.appIds (B2) a été reverté côté code, mais
// avait modifié 411 docs en prod (143 tickets + 268 predictions) avec un
// champ `appIds` inerte. Mongoose strict mode ignore ce champ donc il ne
// gêne pas l'app. Ce script le nettoie proprement pour avoir une BD pristine.
//
// Actions :
//   1. $unset appIds sur tous les Tickets/Predictions qui ont ce champ
//   2. Drop des indexes multikey orphelins sur tickets.appIds et predictions.appIds
//      (s'ils existent — silencieux sinon)
//
// Modes :
//   node scripts/cleanup-orphan-ticket-appids.js              # dry-run
//   node scripts/cleanup-orphan-ticket-appids.js --apply      # applique
//
// Idempotent : relancable sans risque (skip ce qui est deja nettoye).

require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const MODE = APPLY ? 'APPLY' : 'DRY-RUN';

(async () => {
  console.log(`\n=== Cleanup vestiges Ticket multi-app [${MODE}] ===\n`);
  if (!APPLY) {
    console.log('  ℹ️  Mode dry-run par defaut — aucune ecriture en BD.');
    console.log('  ℹ️  Pour appliquer : ajoute le flag --apply\n');
  }

  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  // ── 1. Unset appIds sur Tickets et Predictions ─────────────────
  for (const collName of ['tickets', 'predictions']) {
    const coll = db.collection(collName);
    const count = await coll.countDocuments({ appIds: { $exists: true } });
    console.log(`📊 ${collName} avec appIds (a unset) : ${count}`);
    if (count > 0 && APPLY) {
      const result = await coll.updateMany(
        { appIds: { $exists: true } },
        { $unset: { appIds: '' } }
      );
      console.log(`  ✅ ${collName} : ${result.modifiedCount} docs nettoyes`);
    }
  }

  // ── 2. Drop des indexes orphelins (tickets.appIds + predictions.appIds) ──
  console.log('\n📊 Indexes orphelins sur appIds:');
  for (const collName of ['tickets', 'predictions']) {
    const coll = db.collection(collName);
    let indexes;
    try {
      indexes = await coll.indexes();
    } catch (e) {
      console.log(`  ${collName} : impossible de lister les indexes (${e.message})`);
      continue;
    }
    const orphans = indexes.filter(idx => {
      if (!idx.key) return false;
      return Object.keys(idx.key).some(k => k === 'appIds');
    });
    if (orphans.length === 0) {
      console.log(`  ${collName} : aucun index orphelin a drop`);
      continue;
    }
    for (const idx of orphans) {
      console.log(`  ${collName} : ${idx.name} (${JSON.stringify(idx.key)})`);
      if (APPLY) {
        try {
          await coll.dropIndex(idx.name);
          console.log(`    ✅ drop OK`);
        } catch (e) {
          console.log(`    ❌ drop FAIL : ${e.message}`);
        }
      }
    }
  }

  // ── 3. Verif post-cleanup ──────────────────────────────────────
  if (APPLY) {
    console.log('\n=== Verif post-cleanup ===');
    for (const collName of ['tickets', 'predictions']) {
      const coll = db.collection(collName);
      const remaining = await coll.countDocuments({ appIds: { $exists: true } });
      console.log(`  ${collName} avec appIds restant : ${remaining} (attendu 0)`);
      const indexes = await coll.indexes();
      const remainingIdx = indexes.filter(idx =>
        idx.key && Object.keys(idx.key).some(k => k === 'appIds')
      );
      console.log(`  ${collName} indexes orphelins restant : ${remainingIdx.length} (attendu 0)`);
    }
  }

  await mongoose.disconnect();
  console.log(`\n=== ${MODE} terminé ===\n`);
})().catch(e => { console.error('ERREUR:', e); process.exit(1); });
