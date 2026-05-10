// scripts/migrate-app-afribapay-payout-url.js
//
// One-shot migration : set `payments.afribapay.payoutApiUrl` sur toutes
// les apps qui ne l'ont pas encore. Valeur par défaut :
// https://api-payout.afribapay.com
//
// Usage :
//   node scripts/migrate-app-afribapay-payout-url.js          (dry-run)
//   node scripts/migrate-app-afribapay-payout-url.js --apply  (applique)

require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const DEFAULT_PAYOUT_URL = 'https://api-payout.afribapay.com';

(async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('✅ Connecté à', mongoose.connection.name);
  console.log(APPLY ? '🟢 APPLY' : '🟡 DRY-RUN. Lance avec --apply.\n');

  const App = require('../src/api/models/common/App');
  const apps = await App.find({}).lean();

  let updated = 0;
  for (const app of apps) {
    const current = app.payments?.afribapay?.payoutApiUrl;
    if (current && current.trim()) {
      console.log(`  ✓ ${app.appId} : déjà set (${current})`);
      continue;
    }
    console.log(
      `  ➕ ${app.appId} : à set → ${DEFAULT_PAYOUT_URL}`
    );
    if (APPLY) {
      await App.updateOne(
        { _id: app._id },
        { $set: { 'payments.afribapay.payoutApiUrl': DEFAULT_PAYOUT_URL } }
      );
      updated += 1;
    }
  }

  console.log(
    `\n${APPLY ? '✅ Mise à jour' : '🟡 (dry-run)'} : ${
      APPLY ? updated : apps.filter((a) => !a.payments?.afribapay?.payoutApiUrl).length
    } app(s).`
  );

  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
