// scripts/migrate-affiliation-wipe-bd.js
//
// Étape 0.4 — Migration BD du wipe affiliation legacy.
// Drop des 3 collections + cleanup `referredBy` sur users.
//
// PRÉREQUIS : avoir exécuté `scripts/backup-affiliation-legacy.js` en amont
// (les 9817 docs sont dans /backup-affiliation-legacy/*.json).
//
// Usage :
//   node scripts/migrate-affiliation-wipe-bd.js          (dry-run, défaut)
//   node scripts/migrate-affiliation-wipe-bd.js --apply  (applique)

require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('✅ Connecté à MongoDB :', mongoose.connection.name);
  console.log(APPLY ? '🟢 MODE APPLY' : '🟡 DRY-RUN. Lance avec --apply pour exécuter.');
  console.log('');

  const db = mongoose.connection.db;

  // ===== 1. État AVANT =====
  console.log('=== État AVANT ===');
  const collections = (await db.listCollections().toArray()).map((c) => c.name);
  for (const name of ['affiliates', 'affiliatetypes', 'commissions']) {
    if (collections.includes(name)) {
      const count = await db.collection(name).countDocuments();
      console.log(`  ${name} : ${count} docs`);
    } else {
      console.log(`  ${name} : (collection absente)`);
    }
  }
  const usersWithRef = await db.collection('users').countDocuments({
    referredBy: { $exists: true, $ne: null },
  });
  console.log(`  users avec referredBy : ${usersWithRef}`);
  console.log('');

  if (!APPLY) {
    console.log('🟡 DRY-RUN — aucune modification effectuée.');
    console.log('   Les actions à venir avec --apply :');
    console.log('     - db.affiliates.drop()');
    console.log('     - db.affiliatetypes.drop()');
    console.log('     - db.commissions.drop()');
    console.log(`     - db.users.updateMany({}, { $unset: { referredBy: '' } })`);
    await mongoose.disconnect();
    return;
  }

  // ===== 2. ACTIONS =====
  console.log('=== Exécution ===');

  // 2.1 Drop affiliates
  if (collections.includes('affiliates')) {
    await db.collection('affiliates').drop();
    console.log('  ✅ affiliates : collection drop');
  } else {
    console.log('  ⏭  affiliates : collection déjà absente');
  }

  // 2.2 Drop affiliatetypes
  if (collections.includes('affiliatetypes')) {
    await db.collection('affiliatetypes').drop();
    console.log('  ✅ affiliatetypes : collection drop');
  } else {
    console.log('  ⏭  affiliatetypes : collection déjà absente');
  }

  // 2.3 Drop commissions
  if (collections.includes('commissions')) {
    await db.collection('commissions').drop();
    console.log('  ✅ commissions : collection drop');
  } else {
    console.log('  ⏭  commissions : collection déjà absente');
  }

  // 2.4 Unset referredBy sur tous les users
  const updateRes = await db.collection('users').updateMany(
    { referredBy: { $exists: true } },
    { $unset: { referredBy: '' } }
  );
  console.log(
    `  ✅ users : ${updateRes.modifiedCount} docs mis à jour (referredBy retiré)`
  );

  // ===== 3. État APRÈS =====
  console.log('');
  console.log('=== État APRÈS ===');
  const collsAfter = (await db.listCollections().toArray()).map((c) => c.name);
  for (const name of ['affiliates', 'affiliatetypes', 'commissions']) {
    console.log(
      `  ${name} : ${collsAfter.includes(name) ? '⚠️ encore présente' : '✅ absente'}`
    );
  }
  const usersWithRefAfter = await db.collection('users').countDocuments({
    referredBy: { $exists: true },
  });
  console.log(
    `  users avec referredBy : ${usersWithRefAfter} ${usersWithRefAfter === 0 ? '✅' : '⚠️'}`
  );

  await mongoose.disconnect();
  console.log('\n✅ Migration BD terminée');
})().catch((e) => {
  console.error('❌ Erreur :', e);
  process.exit(1);
});
