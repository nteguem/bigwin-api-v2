/**
 * Script de nettoyage des Subscriptions / Commissions orphelines.
 *
 * Une subscription/commission est orpheline quand son champ `package`,
 * `user` ou `affiliate` référence un document qui n'existe plus en BD
 * (suite à une suppression manuelle d'un Package, User ou Affiliate).
 *
 * Mode DRY-RUN par défaut : compte les orphelines sans rien supprimer.
 * Pour réellement supprimer : `node cleanup-orphan-subscriptions.js --apply`
 *
 * Usage :
 *   node scripts/cleanup-orphan-subscriptions.js              # dry-run (lecture seule)
 *   node scripts/cleanup-orphan-subscriptions.js --apply      # suppression réelle
 *   node scripts/cleanup-orphan-subscriptions.js --apply --app-id=monapp   # filtrer une app
 *
 * IMPORTANT : faire un dump MongoDB avant `--apply`.
 *   mongodump --uri="$MONGO_URI" --out=./backup-$(date +%Y%m%d-%H%M%S)
 */

require('dotenv').config();
const mongoose = require('mongoose');

const Subscription = require('../src/api/models/common/Subscription');
const Commission = require('../src/api/models/common/Commission');
const Package = require('../src/api/models/common/Package');
const User = require('../src/api/models/user/User');
const Affiliate = require('../src/api/models/affiliate/Affiliate');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const APP_ID = (args.find(a => a.startsWith('--app-id=')) || '').split('=')[1] || null;

async function findOrphans(Model, refField, RefModel, baseFilter = {}) {
  const validIds = (await RefModel.find({}, { _id: 1 }).lean()).map(d => d._id.toString());
  const all = await Model.find(baseFilter, { _id: 1, [refField]: 1, appId: 1 }).lean();
  const orphans = all.filter(doc => {
    const ref = doc[refField];
    if (!ref) return true; // ref null ou undefined = déjà cassée
    return !validIds.includes(ref.toString());
  });
  return orphans;
}

(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('❌ MONGO_URI manquant dans .env');
    process.exit(1);
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Cleanup Orphan Subscriptions  ${APPLY ? '[APPLY]' : '[DRY-RUN]'}`);
  if (APP_ID) console.log(`  Filtré sur appId = ${APP_ID}`);
  console.log(`${'═'.repeat(60)}\n`);

  await mongoose.connect(uri);
  console.log('✅ MongoDB connecté\n');

  const baseFilter = APP_ID ? { appId: APP_ID } : {};

  // 1. Subscriptions dont le Package a été supprimé
  console.log('🔍 Scan: Subscriptions → Package supprimé...');
  const orphanSubsNoPkg = await findOrphans(Subscription, 'package', Package, baseFilter);
  console.log(`   ${orphanSubsNoPkg.length} trouvée(s)\n`);

  // 2. Subscriptions dont le User a été supprimé
  console.log('🔍 Scan: Subscriptions → User supprimé...');
  const orphanSubsNoUser = await findOrphans(Subscription, 'user', User, baseFilter);
  console.log(`   ${orphanSubsNoUser.length} trouvée(s)\n`);

  // 3. Commissions dont la Subscription a été supprimée
  console.log('🔍 Scan: Commissions → Subscription supprimée...');
  const orphanCommSubs = await findOrphans(Commission, 'subscription', Subscription, baseFilter);
  console.log(`   ${orphanCommSubs.length} trouvée(s)\n`);

  // 4. Commissions dont l'Affiliate a été supprimé
  console.log('🔍 Scan: Commissions → Affiliate supprimé...');
  const orphanCommAff = await findOrphans(Commission, 'affiliate', Affiliate, baseFilter);
  console.log(`   ${orphanCommAff.length} trouvée(s)\n`);

  const totalOrphans =
    orphanSubsNoPkg.length +
    orphanSubsNoUser.length +
    orphanCommSubs.length +
    orphanCommAff.length;

  console.log(`${'─'.repeat(60)}`);
  console.log(`  TOTAL : ${totalOrphans} document(s) orphelin(s)`);
  console.log(`${'─'.repeat(60)}\n`);

  if (totalOrphans === 0) {
    console.log('✨ BD propre, rien à faire.');
    await mongoose.disconnect();
    return;
  }

  // Affichage par appId pour visibilité multi-tenant
  const byApp = {};
  [...orphanSubsNoPkg, ...orphanSubsNoUser].forEach(o => {
    const a = o.appId || 'sans-appId';
    byApp[a] = (byApp[a] || 0) + 1;
  });
  console.log('Subscriptions orphelines par app :');
  Object.entries(byApp).forEach(([a, c]) => console.log(`   ${a} : ${c}`));
  console.log('');

  if (!APPLY) {
    console.log('💡 Mode DRY-RUN — aucune suppression effectuée.');
    console.log('   Pour supprimer réellement : ajoute --apply\n');
    await mongoose.disconnect();
    return;
  }

  console.log('⚠️  Suppression en cours...\n');

  if (orphanSubsNoPkg.length) {
    const ids = orphanSubsNoPkg.map(o => o._id);
    const r = await Subscription.deleteMany({ _id: { $in: ids } });
    console.log(`   ✓ ${r.deletedCount} subscription(s) sans Package supprimées`);
  }
  if (orphanSubsNoUser.length) {
    const ids = orphanSubsNoUser.map(o => o._id);
    const r = await Subscription.deleteMany({ _id: { $in: ids } });
    console.log(`   ✓ ${r.deletedCount} subscription(s) sans User supprimées`);
  }
  if (orphanCommSubs.length) {
    const ids = orphanCommSubs.map(o => o._id);
    const r = await Commission.deleteMany({ _id: { $in: ids } });
    console.log(`   ✓ ${r.deletedCount} commission(s) sans Subscription supprimées`);
  }
  if (orphanCommAff.length) {
    const ids = orphanCommAff.map(o => o._id);
    const r = await Commission.deleteMany({ _id: { $in: ids } });
    console.log(`   ✓ ${r.deletedCount} commission(s) sans Affiliate supprimées`);
  }

  console.log('\n✅ Nettoyage terminé.\n');
  await mongoose.disconnect();
})().catch(err => {
  console.error('❌ Erreur:', err);
  process.exit(1);
});
