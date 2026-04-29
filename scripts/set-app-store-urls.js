/**
 * Renseigne playStoreUrl + supportEmail pour les 5 apps de la galaxie.
 *
 * Idempotent : si la valeur existe déjà, on ne l'écrase PAS (safe à relancer).
 *
 * Usage :
 *   node scripts/set-app-store-urls.js              # dry-run (montre ce qui sera fait)
 *   node scripts/set-app-store-urls.js --apply      # applique les changements
 */

require('dotenv').config();
const mongoose = require('mongoose');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');

// Mapping appId Mongo → infos store/contact
const APP_INFOS = {
  bigwin: {
    playStoreUrl: 'https://play.google.com/store/apps/details?id=com.bigwin.application',
    supportEmail: 'contact@proxidream.com',
  },
  goatips: {
    playStoreUrl: 'https://play.google.com/store/apps/details?id=com.goatips.application',
    supportEmail: 'contact@proxidream.com',
  },
  goodtips: {
    playStoreUrl: 'https://play.google.com/store/apps/details?id=com.goodtips.application',
    supportEmail: 'contact@proxidream.com',
  },
  strategytips: {
    playStoreUrl: 'https://play.google.com/store/apps/details?id=com.strategytips.application',
    supportEmail: 'contact@proxidream.com',
  },
  wisetips: {
    playStoreUrl: 'https://play.google.com/store/apps/details?id=com.wisetips.application',
    supportEmail: 'contact@proxidream.com',
  },
};

(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI manquant dans .env');
    process.exit(1);
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Set playStoreUrl + supportEmail  ${APPLY ? '[APPLY]' : '[DRY-RUN]'}`);
  console.log(`${'═'.repeat(60)}\n`);

  await mongoose.connect(uri);
  console.log('MongoDB connecté\n');

  const App = require('../src/api/models/common/App');

  let updated = 0;
  let skippedExisting = 0;
  let notFound = 0;

  for (const [appId, infos] of Object.entries(APP_INFOS)) {
    const app = await App.findOne({ appId });
    if (!app) {
      console.log(`  ⚠️  ${appId} : app introuvable en BD`);
      notFound++;
      continue;
    }

    const updates = {};
    if (!app.playStoreUrl) updates.playStoreUrl = infos.playStoreUrl;
    if (!app.supportEmail) updates.supportEmail = infos.supportEmail;

    if (Object.keys(updates).length === 0) {
      console.log(`  ⏭  ${appId} : déjà renseigné (skip)`);
      console.log(`       playStoreUrl  : ${app.playStoreUrl}`);
      console.log(`       supportEmail  : ${app.supportEmail}`);
      skippedExisting++;
      continue;
    }

    console.log(`  ${APPLY ? '✓' : '→'} ${appId} : à mettre à jour`);
    if (updates.playStoreUrl) console.log(`       playStoreUrl  : ${updates.playStoreUrl}`);
    if (updates.supportEmail) console.log(`       supportEmail  : ${updates.supportEmail}`);

    if (APPLY) {
      Object.assign(app, updates);
      await app.save();
      updated++;
    }
  }

  console.log(`\n=== Résumé ===`);
  console.log(`  Mis à jour       : ${updated}`);
  console.log(`  Déjà OK (skipped): ${skippedExisting}`);
  console.log(`  Introuvable      : ${notFound}`);

  if (!APPLY) {
    console.log(`\nMode dry-run : rien n'a été écrit en BD.`);
    console.log(`Relancer avec --apply pour persister.\n`);
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('Erreur fatale :', err);
  process.exit(1);
});
