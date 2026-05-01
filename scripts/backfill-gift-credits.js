/**
 * Backfill : crédite les wallets "cadeaux" pour les souscriptions ACTIVES
 * existantes (créées avant le déploiement du système de cadeaux).
 *
 * IDÉMPOTENT : grâce à creditWalletService qui skip les (source, refId) déjà
 * traités. Tu peux relancer sans risque.
 *
 * Usage :
 *   node scripts/backfill-gift-credits.js               # dry-run
 *   node scripts/backfill-gift-credits.js --apply       # applique
 *   node scripts/backfill-gift-credits.js --apply --app bigwin  # seulement bigwin
 */

require('dotenv').config();
const mongoose = require('mongoose');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const appArgIdx = args.indexOf('--app');
const APP_FILTER = appArgIdx >= 0 ? args[appArgIdx + 1] : null;

(async () => {
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!MONGO_URI) {
    console.error('❌ MONGO_URI manquant dans .env');
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connecté à MongoDB');

  const Subscription = require('../src/api/models/common/Subscription');
  const Package = require('../src/api/models/common/Package');
  const creditWalletService = require('../src/api/services/common/creditWalletService');

  const filter = { status: 'active', endDate: { $gt: new Date() } };
  if (APP_FILTER) filter.appId = APP_FILTER;

  const subs = await Subscription.find(filter).lean();
  console.log(`📊 ${subs.length} souscriptions actives ${APP_FILTER ? `(app=${APP_FILTER})` : '(toutes apps)'}`);

  if (!APPLY) {
    console.log('\n🟡 DRY-RUN. Lance avec --apply pour exécuter.\n');
  }

  const stats = {
    processed: 0,
    credited: 0,
    skippedAlready: 0,
    skippedZero: 0,
    errors: 0,
  };

  // Cache packages par id pour éviter N requêtes
  const packagesCache = {};
  const getPackage = async (id) => {
    const k = id.toString();
    if (packagesCache[k] !== undefined) return packagesCache[k];
    const pkg = await Package.findById(id).select('unlockCredits name').lean();
    packagesCache[k] = pkg;
    return pkg;
  };

  for (const sub of subs) {
    stats.processed++;
    try {
      const pkg = await getPackage(sub.package);
      const credits = pkg?.unlockCredits || 0;

      if (credits === 0) {
        stats.skippedZero++;
        continue;
      }

      if (!APPLY) {
        console.log(
          `   • [DRY] user=${sub.user} app=${sub.appId} sub=${sub._id} → +${credits} cadeaux`
        );
        stats.credited++;
        continue;
      }

      const { alreadyCredited } = await creditWalletService.creditWallet({
        user: sub.user,
        appId: sub.appId,
        amount: credits,
        source: 'subscription',
        refId: sub._id,
        refModel: 'Subscription',
        note: `Backfill ${pkg?.name?.fr || ''}`.trim(),
      });

      if (alreadyCredited) {
        stats.skippedAlready++;
      } else {
        stats.credited++;
        console.log(
          `   ✅ user=${sub.user} app=${sub.appId} → +${credits} cadeaux`
        );
      }
    } catch (err) {
      stats.errors++;
      console.error(`   ❌ sub=${sub._id}: ${err.message}`);
    }
  }

  console.log('\n📈 Résumé :');
  console.log(`   Traitées      : ${stats.processed}`);
  console.log(`   Créditées     : ${stats.credited}`);
  console.log(`   Déjà créditées: ${stats.skippedAlready}`);
  console.log(`   0 crédit (pkg): ${stats.skippedZero}`);
  console.log(`   Erreurs       : ${stats.errors}`);

  await mongoose.disconnect();
  console.log('\n✅ Terminé');
})().catch((err) => {
  console.error('❌ Erreur fatale:', err);
  process.exit(1);
});
