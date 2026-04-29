/**
 * Backfill / réconciliation des tags OneSignal `is_vip`.
 *
 * Pourquoi : permet de cibler les VIP/Free via OneSignal filters côté serveur
 * OneSignal (envoi instantané, plus de batches). Les tags sont la source via
 * laquelle OneSignal sait qui est VIP.
 *
 * Source de vérité = Mongo. Ce script aligne OneSignal sur Mongo.
 *
 * Mode DRY-RUN par défaut : n'écrit rien sur OneSignal.
 *
 * Usage :
 *   node scripts/reconcile-onesignal-tags.js                          # dry-run, 7j, toutes apps
 *   node scripts/reconcile-onesignal-tags.js --apply                  # vraie écriture
 *   node scripts/reconcile-onesignal-tags.js --apply --days=14        # fenêtre expirations
 *   node scripts/reconcile-onesignal-tags.js --apply --app-id=bigwin  # une seule app
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { reconcileTags } = require('../src/api/services/common/oneSignalTagService');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DAYS = parseInt((args.find((a) => a.startsWith('--days=')) || '').split('=')[1], 10) || 7;
const APP_ID = (args.find((a) => a.startsWith('--app-id=')) || '').split('=')[1] || null;

(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI manquant dans .env');
    process.exit(1);
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  OneSignal Tag Reconciliation  ${APPLY ? '[APPLY]' : '[DRY-RUN]'}`);
  console.log(`  Lookback : ${DAYS} jour(s) pour expirations`);
  if (APP_ID) console.log(`  appId    : ${APP_ID}`);
  console.log(`${'═'.repeat(60)}\n`);

  await mongoose.connect(uri);
  console.log('MongoDB connecté\n');

  const result = await reconcileTags({
    lookbackDays: DAYS,
    appId: APP_ID || undefined,
    dryRun: !APPLY,
  });

  console.log('\n=== Résultats par app ===');
  for (const s of result.perApp) {
    console.log(`\n[${s.appId}]`);
    console.log(`  VIPs trouvés en BD       : ${s.vipUsersFound}`);
    console.log(`  Expirés récents (${DAYS}j)   : ${s.expiredUsersFound}`);
    console.log(`  Tagués VIP (succès)      : ${s.taggedVip}`);
    console.log(`  Tagués Free (succès)     : ${s.taggedFree}`);
    console.log(`  VIP sans device actif    : ${s.noDeviceVip}`);
    console.log(`  Free sans device actif   : ${s.noDeviceFree}`);
    if (s.errors.length > 0) {
      console.log(`  Erreurs (${s.errors.length})              :`);
      s.errors.slice(0, 5).forEach((e) => console.log(`    - ${e}`));
      if (s.errors.length > 5) console.log(`    ...et ${s.errors.length - 5} autres`);
    }
  }

  console.log('\n=== Totaux ===');
  console.log(`  Tagués VIP      : ${result.totals.vip}`);
  console.log(`  Tagués Free     : ${result.totals.free}`);
  console.log(`  Sans device     : ${result.totals.noDevice}`);
  console.log(`  Durée totale    : ${result.durationMs}ms`);

  if (!APPLY) {
    console.log('\nMode dry-run : rien n\'a été poussé sur OneSignal.');
    console.log('Relancer avec --apply pour persister les tags.\n');
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('Erreur fatale :', err);
  process.exit(1);
});
