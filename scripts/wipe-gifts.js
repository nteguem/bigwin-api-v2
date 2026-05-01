/**
 * NETTOYAGE TOTAL du système de cadeaux.
 *
 * Drop les collections :
 *   - gifttiers
 *   - gifts
 *   - usercreditwallets
 *   - usergiftunlocks
 *
 * Et $unset le champ unlockCredits de tous les packages.
 *
 * Usage :
 *   node scripts/wipe-gifts.js              # dry-run
 *   node scripts/wipe-gifts.js --apply      # exécute
 */

require('dotenv').config();
const mongoose = require('mongoose');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');

const COLLECTIONS = ['gifttiers', 'gifts', 'usercreditwallets', 'usergiftunlocks'];

(async () => {
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!MONGO_URI) {
    console.error('❌ MONGO_URI manquant');
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connecté à MongoDB');

  const db = mongoose.connection.db;

  if (!APPLY) console.log('🟡 DRY-RUN. --apply pour exécuter.\n');

  // 1) Compter les docs avant
  console.log('━━━ Inventaire avant wipe ━━━');
  for (const col of COLLECTIONS) {
    try {
      const count = await db.collection(col).countDocuments();
      console.log(`   ${col}: ${count} docs`);
    } catch {
      console.log(`   ${col}: collection inexistante`);
    }
  }

  const packagesWithCredits = await db
    .collection('packages')
    .countDocuments({ unlockCredits: { $gt: 0 } });
  console.log(`   packages avec unlockCredits>0 : ${packagesWithCredits}`);

  if (!APPLY) {
    console.log('\n🟡 DRY-RUN terminé. Relance avec --apply pour wipe.');
    await mongoose.disconnect();
    return;
  }

  // 2) Drop collections
  console.log('\n━━━ Drop des collections ━━━');
  for (const col of COLLECTIONS) {
    try {
      await db.collection(col).drop();
      console.log(`   🗑️  ${col} → DROPPED`);
    } catch (err) {
      if (err.codeName === 'NamespaceNotFound') {
        console.log(`   ⏭️  ${col} (déjà absente)`);
      } else {
        console.error(`   ❌ ${col}: ${err.message}`);
      }
    }
  }

  // 3) Unset unlockCredits sur tous les packages
  console.log('\n━━━ Reset packages.unlockCredits ━━━');
  const result = await db.collection('packages').updateMany(
    {},
    { $unset: { unlockCredits: '' } }
  );
  console.log(`   ${result.modifiedCount} package(s) nettoyés`);

  console.log('\n✅ Wipe terminé.');
  await mongoose.disconnect();
})().catch((err) => {
  console.error('❌ Erreur fatale:', err);
  process.exit(1);
});
