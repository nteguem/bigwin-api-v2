// scripts/seed-affiliate-add-sub.js
//
// Ajoute (si manquant) `nteguemroland@gmail.com` comme filleul de
// `gatewaysforce@gmail.com` (parrain affilié, appId=bigwin), puis crée
// une Subscription à 6000 XAF pour ce filleul qui déclenche une
// Commission de 15% (= 900 XAF) au parrain.
//
// Idempotent sur le user et le Referral (réutilisés si existent), mais
// PAS sur la Subscription : chaque run crée une nouvelle sub +
// nouvelle commission. Si tu veux relancer pour générer une autre
// commission, c'est exactement ce qui se passera.
//
// Usage :
//   node scripts/seed-affiliate-add-sub.js          (dry-run)
//   node scripts/seed-affiliate-add-sub.js --apply  (applique)

require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');

const APPLY = process.argv.includes('--apply');

const APP_ID = 'bigwin';
const PARRAIN_EMAIL = 'gatewaysforce@gmail.com';
const FILLEUL_EMAIL = 'nteguemroland@gmail.com';
const PRICE_XAF = 6000;

(async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGO_URI / MONGODB_URI manquant dans .env');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log('✅ Connecté MongoDB :', mongoose.connection.name);
  console.log(APPLY ? '🟢 MODE APPLY' : '🟡 DRY-RUN. Relance avec --apply.\n');

  const User = require('../src/api/models/user/User');
  const Package = require('../src/api/models/common/Package');
  const Subscription = require('../src/api/models/common/Subscription');
  const Referral = require('../src/api/models/affiliate/Referral');
  const Commission = require('../src/api/models/affiliate/Commission');
  const affiliateService = require('../src/api/services/affiliate/affiliateService');

  // 1. Parrain
  console.log('=== 1. Parrain ===');
  const parrain = await User.findOne({ appId: APP_ID, email: PARRAIN_EMAIL });
  if (!parrain) {
    console.error(`❌ Parrain ${PARRAIN_EMAIL} introuvable`);
    process.exit(1);
  }
  if (!parrain.affiliate?.isActive) {
    console.error(`❌ ${PARRAIN_EMAIL} n'est pas affilié actif. Active-le depuis l'app d'abord.`);
    process.exit(1);
  }
  if (parrain.affiliate.suspended) {
    console.error(`❌ ${PARRAIN_EMAIL} est suspendu`);
    process.exit(1);
  }
  const parrainCountry = parrain.affiliate.country;
  console.log(`  ✅ ${PARRAIN_EMAIL}`);
  console.log(`     code=${parrain.affiliate.code} | country=${parrainCountry}\n`);

  // 2. Filleul (créé si manquant)
  console.log('=== 2. Filleul ===');
  let filleul = await User.findOne({ appId: APP_ID, email: FILLEUL_EMAIL });
  if (filleul) {
    console.log(`  ℹ️  User existe : ${filleul._id}`);
  } else if (APPLY) {
    filleul = await User.create({
      appId: APP_ID,
      authProvider: 'google',
      email: FILLEUL_EMAIL,
      googleId: crypto.randomBytes(16).toString('hex'),
      pseudo: 'Roland N',
      firstName: 'Roland',
      lastName: 'Nteguem',
      countryCode: parrainCountry, // même pays sinon country_mismatch
      isActive: true,
      emailVerified: true,
    });
    console.log(`  ✅ User créé : ${filleul._id}`);
  } else {
    console.log(`  (dry-run) User à créer`);
  }

  // 3. Referral (créé si manquant)
  console.log('\n=== 3. Referral ===');
  if (filleul) {
    let referral = await Referral.findOne({ appId: APP_ID, referee: filleul._id });
    if (referral) {
      console.log(`  ℹ️  Referral existe : ${referral._id} (status=${referral.status})`);
    } else if (APPLY) {
      referral = await affiliateService.createReferralAtSignup(
        filleul,
        parrain.affiliate.code
      );
      console.log(`  ✅ Referral créé : ${referral._id} (status=${referral.status})`);
    } else {
      console.log(`  (dry-run) Referral à créer avec code ${parrain.affiliate.code}`);
    }
  }

  // 4. Package 6000 XAF
  console.log('\n=== 4. Package 6000 XAF ===');
  const pkgs = await Package.find({
    appId: { $in: [APP_ID, 'shared'] },
    isActive: true,
  }).lean();
  let pkg = null;
  for (const p of pkgs) {
    const pricing = p.pricing instanceof Map
      ? Object.fromEntries(p.pricing)
      : (p.pricing || {});
    if ((pricing.XAF || pricing.xaf) === PRICE_XAF) {
      pkg = p;
      break;
    }
  }
  if (!pkg) {
    console.error(`❌ Aucun Package actif à ${PRICE_XAF} XAF. Dispo :`);
    for (const p of pkgs) {
      const pricing = p.pricing instanceof Map
        ? Object.fromEntries(p.pricing)
        : (p.pricing || {});
      console.error(`   ${p._id} | ${p.name?.fr || p.name?.en} | XAF=${pricing.XAF}`);
    }
    process.exit(1);
  }
  console.log(`  ✅ Package : ${pkg.name?.fr || pkg.name?.en} (${pkg._id})\n`);

  // 5. Subscription + Commission
  console.log('=== 5. Subscription + Commission ===');
  if (!APPLY) {
    console.log(`  (dry-run) Subscription ${PRICE_XAF} XAF + Commission 15% = 900 XAF`);
  } else if (filleul) {
    const now = new Date();
    const endDate = new Date(now);
    endDate.setMonth(endDate.getMonth() + 1);
    const sub = await Subscription.create({
      appId: APP_ID,
      user: filleul._id,
      package: pkg._id,
      startDate: now,
      endDate,
      pricing: { amount: PRICE_XAF, currency: 'XAF' },
      status: 'active',
      paymentProvider: 'ADMIN',
      paymentReference: `seed-6000-${crypto.randomBytes(6).toString('hex')}`,
    });
    console.log(`  ✅ Subscription : ${sub._id}`);

    const com = await affiliateService.tryCreateCommissionForSubscription(sub);
    if (com) {
      console.log(`  ✅ Commission   : ${com._id} (+${com.amount} ${com.currency}, status=${com.status})`);
    } else {
      console.log(`  ⚠️  Pas de commission générée (vérif Referral / config)`);
    }
  }

  // 6. Résumé
  if (APPLY) {
    console.log('\n=== Résumé ===');
    const totalCom = await Commission.countDocuments({
      appId: APP_ID,
      referrer: parrain._id,
    });
    const balance = await Commission.aggregate([
      { $match: { appId: APP_ID, referrer: parrain._id, status: 'available' } },
      { $group: { _id: '$currency', total: { $sum: '$amount' } } },
    ]);
    console.log(`  Total commissions parrain : ${totalCom}`);
    console.log(
      `  Solde available : ${
        balance.length === 0
          ? '0'
          : balance.map((b) => `${b.total} ${b._id}`).join(', ')
      }`
    );
  } else {
    console.log('\n🟡 Aucun changement appliqué.');
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
