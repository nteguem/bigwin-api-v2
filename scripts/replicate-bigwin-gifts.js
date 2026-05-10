// scripts/replicate-bigwin-gifts.js
//
// Réplique TOUS les cadeaux de bigwin sur les 4 autres apps mobile
// (goatips, goodtips, strategytips, wisetips).
//
// Champs régénérés :
//   - _id (nouvel ObjectId)
//   - appId (target)
//   - createdAt / updatedAt (now)
//   - __v (0)
// Champs réinitialisés :
//   - readCount → 0 (compteur spécifique aux users de l'app source)
// Champs décalés :
//   - sortOrder = sortOrder_source + maxSortOrder_target (pour placer
//     les copies à la fin du catalogue de l'app cible).
// Tout le reste copié tel quel (countries inclus).
//
// Pas de cascade vers UserGiftUnlock / GiftReview — chaque app garde
// ses propres données utilisateurs (les unlocks/reviews sont liés au
// `gift._id`, et comme on régénère les _id, les copies démarrent
// vierges côté user).
//
// Usage :
//   node scripts/replicate-bigwin-gifts.js          (dry-run, défaut)
//   node scripts/replicate-bigwin-gifts.js --apply  (applique)

require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const SOURCE_APP = 'bigwin';
const TARGET_APPS = ['goatips', 'goodtips', 'strategytips', 'wisetips'];

(async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('✅ Connecté à MongoDB');
  console.log(APPLY ? '🟢 MODE APPLY' : '🟡 DRY-RUN. Lance avec --apply pour exécuter.');
  console.log('');

  const giftsCol = mongoose.connection.collection('gifts');

  // Charge les cadeaux source
  const sourceGifts = await giftsCol
    .find({ appId: SOURCE_APP })
    .sort({ sortOrder: 1, createdAt: 1 })
    .toArray();
  console.log(`📦 ${sourceGifts.length} cadeau(x) source dans '${SOURCE_APP}'`);

  if (sourceGifts.length === 0) {
    console.log('Rien à répliquer. Fin.');
    await mongoose.disconnect();
    return;
  }

  let totalCreated = 0;

  for (const targetApp of TARGET_APPS) {
    // Récupère le sortOrder max actuel de l'app cible
    const maxAgg = await giftsCol
      .aggregate([
        { $match: { appId: targetApp } },
        { $group: { _id: null, max: { $max: '$sortOrder' } } },
      ])
      .toArray();
    const baseSortOrder = (maxAgg[0] && maxAgg[0].max) || 0;

    console.log(`\n--- Cible '${targetApp}' (sortOrder de base: ${baseSortOrder}) ---`);

    const now = new Date();
    const docsToInsert = sourceGifts.map((g) => {
      const copy = { ...g };
      delete copy._id;
      copy._id = new mongoose.Types.ObjectId();
      copy.appId = targetApp;
      copy.createdAt = now;
      copy.updatedAt = now;
      copy.__v = 0;
      copy.readCount = 0;
      copy.sortOrder = (g.sortOrder || 0) + baseSortOrder;
      return copy;
    });

    docsToInsert.forEach((d) => {
      const title = (d.title && (d.title.fr || d.title.en)) || '<no-title>';
      console.log(
        `   ${APPLY ? '✅' : '➕ [DRY]'} sortOrder=${d.sortOrder} | "${title}"`
      );
    });

    if (APPLY && docsToInsert.length > 0) {
      const result = await giftsCol.insertMany(docsToInsert);
      console.log(`   → inséré ${result.insertedCount} docs`);
      totalCreated += result.insertedCount;
    } else if (!APPLY) {
      totalCreated += docsToInsert.length;
    }
  }

  console.log('\n📈 Résumé :');
  console.log(`   Source         : ${sourceGifts.length} cadeaux dans '${SOURCE_APP}'`);
  console.log(`   Cibles         : ${TARGET_APPS.length} apps`);
  console.log(`   Total ${APPLY ? 'créés' : 'à créer'} : ${totalCreated}`);

  await mongoose.disconnect();
  console.log('\n✅ Terminé');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
