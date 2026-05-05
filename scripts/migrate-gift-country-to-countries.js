/**
 * Migration one-shot : convertit le champ legacy `country` (String, ex: "CM")
 * en `countries` (Array de codes ISO, ex: ["CM"]). Cadeaux universels (sans
 * country, ou avec country vide) → countries: [].
 *
 * Idempotent : si un gift a déjà un `countries[]` non vide, on ne touche pas.
 * On supprime aussi le legacy `country` du document après migration.
 *
 * Usage :
 *   node scripts/migrate-gift-country-to-countries.js              # dry-run
 *   node scripts/migrate-gift-country-to-countries.js --apply      # applique
 */

require('dotenv').config();
const mongoose = require('mongoose');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');

(async () => {
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!MONGO_URI) {
    console.error('❌ MONGO_URI manquant');
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connecté à MongoDB');

  // On bypass le modèle Mongoose (le schéma a déjà supprimé `country`),
  // donc on tape directement la collection brute pour récupérer le champ
  // legacy qui peut encore exister en BD.
  const giftsColl = mongoose.connection.collection('gifts');

  const all = await giftsColl
    .find({}, { projection: { country: 1, countries: 1, title: 1 } })
    .toArray();

  console.log(`\n📊 ${all.length} cadeau(x) à analyser`);
  if (!APPLY) console.log('🟡 DRY-RUN. Lance avec --apply pour exécuter.\n');

  const stats = {
    total: all.length,
    alreadyMulti: 0,         // countries[] déjà non vide → skip
    legacyConverted: 0,      // country: "CM" → countries: ["CM"]
    legacyEmptyCleared: 0,   // country: "" / null → countries: []
    universal: 0,            // ni country ni countries → init []
    errors: 0,
  };

  for (const g of all) {
    try {
      const hasMultiNonEmpty = Array.isArray(g.countries) && g.countries.length > 0;
      if (hasMultiNonEmpty) {
        // Déjà multi-pays — on s'assure juste que le legacy `country`
        // est nettoyé pour éviter une double-source-of-truth.
        if (g.country !== undefined) {
          if (APPLY) {
            await giftsColl.updateOne(
              { _id: g._id },
              { $unset: { country: '' } }
            );
          }
          console.log(
            `   ${APPLY ? '🧹' : '➕ [DRY]'} "${g.title?.fr || g._id}" → unset legacy country`
          );
        }
        stats.alreadyMulti++;
        continue;
      }

      const legacy = (typeof g.country === 'string' ? g.country.trim() : '').toUpperCase();
      const newCountries = legacy.length === 2 ? [legacy] : [];

      const update = { $set: { countries: newCountries } };
      if (g.country !== undefined) {
        update.$unset = { country: '' };
      }

      console.log(
        `   ${APPLY ? '✅' : '➕ [DRY]'} "${g.title?.fr || g._id}" → countries=${JSON.stringify(newCountries)}${g.country !== undefined ? ' (unset country)' : ''}`
      );

      if (APPLY) {
        await giftsColl.updateOne({ _id: g._id }, update);
      }

      if (newCountries.length > 0) stats.legacyConverted++;
      else if (g.country !== undefined) stats.legacyEmptyCleared++;
      else stats.universal++;
    } catch (err) {
      stats.errors++;
      console.error(`   ❌ ${g._id}: ${err.message}`);
    }
  }

  console.log('\n📈 Résumé :');
  console.log(`   Total                  : ${stats.total}`);
  console.log(`   Déjà multi-pays        : ${stats.alreadyMulti}`);
  console.log(`   Legacy → wrap in array : ${stats.legacyConverted}`);
  console.log(`   Legacy vide → []       : ${stats.legacyEmptyCleared}`);
  console.log(`   Universels (init [])   : ${stats.universal}`);
  console.log(`   Erreurs                : ${stats.errors}`);

  await mongoose.disconnect();
  console.log('\n✅ Terminé');
})().catch((err) => {
  console.error('❌ Erreur fatale:', err);
  process.exit(1);
});
