// scripts/reset-affiliate-payout.js
//
// One-shot : cancel la PayoutRequest queued/processing du parrain
// gatewaysforce@gmail.com (retour commissions au wallet) puis relance
// une nouvelle demande propre via affiliateService.requestPayout.
//
// Usage : node scripts/reset-affiliate-payout.js

require('dotenv').config();
const mongoose = require('mongoose');

const APP_ID = 'bigwin';
const PARRAIN_EMAIL = 'gatewaysforce@gmail.com';

(async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('✅ Connecté à', mongoose.connection.name);

  const User = require('../src/api/models/user/User');
  const Commission = require('../src/api/models/affiliate/Commission');
  const PayoutRequest = require('../src/api/models/affiliate/PayoutRequest');
  const affiliateService = require('../src/api/services/affiliate/affiliateService');

  // 1. Trouver le parrain
  const parrain = await User.findOne({ appId: APP_ID, email: PARRAIN_EMAIL });
  if (!parrain) {
    console.error('❌ Parrain introuvable');
    process.exit(1);
  }
  console.log(`Parrain : ${parrain._id} (${parrain.email})`);

  // 2. Cancel toutes les PayoutRequest en cours pour ce user
  const inFlight = await PayoutRequest.find({
    appId: APP_ID,
    user: parrain._id,
    status: { $in: ['queued', 'processing', 'awaiting_funds'] },
  });
  console.log(`Demandes en cours : ${inFlight.length}`);

  for (const pr of inFlight) {
    console.log(`  ⏳ Cancel ${pr._id} (${pr.amount} ${pr.currency})`);
    pr.status = 'cancelled';
    pr.cancelledAt = new Date();
    pr.cancelReason = 'Annulation script reset post-déploiement';
    pr.attempts.push({
      at: new Date(),
      type: 'admin_action',
      status: 'cancelled',
      actor: 'reset-script',
      payload: { action: 'reset_post_deploy' },
    });
    await pr.save();

    // Retour des commissions au wallet (locked → available)
    const result = await Commission.updateMany(
      { _id: { $in: pr.commissionsIncluded }, status: 'locked' },
      { $set: { status: 'available' }, $unset: { payoutRequest: '' } }
    );
    console.log(`    ↩ ${result.modifiedCount} commission(s) retour wallet`);
  }

  // 3. Unlock le User (au cas où le lock ait été set par le nouveau code)
  await User.findOneAndUpdate(
    { _id: parrain._id },
    { $unset: { 'affiliate.activePayoutId': '' } }
  );
  console.log('🔓 User.affiliate.activePayoutId unset');

  // 4. Re-créer une demande propre
  console.log('\n⚙️  Création nouvelle PayoutRequest…');
  // Re-fetch pour avoir un doc Mongoose propre (pas lean)
  const freshUser = await User.findById(parrain._id);
  // Si le user n'a pas encore de payoutMethod, on en met un de test
  if (!freshUser.affiliate?.payoutMethod?.operator) {
    console.log(
      '  ℹ️  Pas de payoutMethod sur le user → set test orange / 690000000'
    );
    freshUser.affiliate.payoutMethod = {
      operator: 'orange',
      phoneNumber: '690000000',
    };
    await freshUser.save();
  }

  const pr = await affiliateService.requestPayout(freshUser);
  console.log(`✅ Nouvelle PayoutRequest : ${pr._id}`);
  console.log(`   ${pr.amount} ${pr.currency} · ${pr.operator} · ${pr.phoneNumber}`);
  console.log(`   status: ${pr.status}`);

  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
