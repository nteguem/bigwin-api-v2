/**
 * Migration one-shot : remplace `http://api-new.proxidream.com/...` par
 * `https://api-new.proxidream.com/...` dans tous les champs Gift qui
 * contiennent des URLs (contentUrl, htmlContent, previewImageUrl, thumbnail).
 *
 * Pourquoi : Android moderne bloque le clear-text HTTP par défaut →
 * `launchUrl` échoue silencieusement sur les PDF / images uploadés AVANT
 * le fix `uploadController.buildPublicUrl`.
 *
 * Idempotent : relancer ne casse rien (les URLs déjà en https sont laissées
 * tranquilles).
 *
 * Usage :
 *   node scripts/migrate-gift-urls-to-https.js              # dry-run
 *   node scripts/migrate-gift-urls-to-https.js --apply      # applique
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

  const Gift = require('../src/api/models/common/Gift');

  // Cherche tous les gifts qui ont AU MOINS UN champ contenant http://
  const gifts = await Gift.find({
    $or: [
      { contentUrl: /^http:\/\// },
      { previewImageUrl: /^http:\/\// },
      { thumbnail: /^http:\/\// },
      // htmlContent peut contenir des http:// inline (ex: <img src="http://...">)
      { htmlContent: /http:\/\/api-new\.proxidream\.com/ },
    ],
  });

  console.log(`\n📊 ${gifts.length} cadeau(x) avec des URLs HTTP à migrer`);
  if (!APPLY) console.log('🟡 DRY-RUN. Lance avec --apply pour exécuter.\n');

  const stats = { processed: 0, updated: 0, errors: 0 };

  const upgrade = (val) =>
    typeof val === 'string'
      ? val.replace(/^http:\/\//, 'https://').replace(
          /http:\/\/api-new\.proxidream\.com/g,
          'https://api-new.proxidream.com'
        )
      : val;

  for (const g of gifts) {
    stats.processed++;
    try {
      const before = {
        contentUrl: g.contentUrl,
        previewImageUrl: g.previewImageUrl,
        thumbnail: g.thumbnail,
        htmlContent: g.htmlContent,
      };
      const after = {
        contentUrl: upgrade(g.contentUrl),
        previewImageUrl: upgrade(g.previewImageUrl),
        thumbnail: upgrade(g.thumbnail),
        htmlContent: upgrade(g.htmlContent),
      };
      const changedFields = Object.keys(before).filter(
        (k) => before[k] !== after[k] && after[k] !== null && after[k] !== undefined
      );
      if (changedFields.length === 0) continue;

      console.log(
        `   ${APPLY ? '✅' : '➕ [DRY]'} "${g.title?.fr || g._id}" → ${changedFields.join(', ')}`
      );

      if (APPLY) {
        for (const k of changedFields) {
          g[k] = after[k];
        }
        await g.save();
      }
      stats.updated++;
    } catch (err) {
      stats.errors++;
      console.error(`   ❌ ${g._id}: ${err.message}`);
    }
  }

  console.log('\n📈 Résumé :');
  console.log(`   Traités  : ${stats.processed}`);
  console.log(`   Mis à jour : ${stats.updated}`);
  console.log(`   Erreurs    : ${stats.errors}`);

  await mongoose.disconnect();
  console.log('\n✅ Terminé');
})().catch((err) => {
  console.error('❌ Erreur fatale:', err);
  process.exit(1);
});
