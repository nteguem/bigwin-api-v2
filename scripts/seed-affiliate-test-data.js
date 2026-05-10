// scripts/seed-affiliate-test-data.js
//
// Crée 2 filleuls + 2 Subscriptions pour le compte affilié
// `gatewaysforce@gmail.com` (appId=bigwin) afin de visualiser le flow
// complet : Referral → Commission générée au paiement.
//
// Idempotent : si les filleuls existent déjà, on les réutilise et on
// crée juste les Subscription + Commission manquantes.
//
// IMPORTANT — single-level only : la commission est créée pour le
// parrain DIRECT (gatewaysforce). Si un filleul parraine quelqu'un
// plus tard, le grand-père (gatewaysforce) ne touchera RIEN sur ce
// petit-fils. Vérifié dans tryCreateCommissionForSubscription.
//
// Usage :
//   node scripts/seed-affiliate-test-data.js          (dry-run)
//   node scripts/seed-affiliate-test-data.js --apply  (applique)

require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');

const APPLY = process.argv.includes('--apply');

const APP_ID = 'bigwin';
const PARRAIN_EMAIL = 'gatewaysforce@gmail.com';
const FILLEULS = [
  { email: 'nteguemroland@gmail.com', pseudo: 'Roland N', firstName: 'Roland', lastName: 'Nteguem' },
  { email: 'rolandnteguem@gmail.com', pseudo: 'Roland T', firstName: 'Roland', lastName: 'Test' },
];

(async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('✅ Connecté à MongoDB :', mongoose.connection.name);
  console.log(APPLY ? '🟢 MODE APPLY' : '🟡 DRY-RUN. Lance avec --apply pour exécuter.\n');

  const User = require('../src/api/models/user/User');
  const Package = require('../src/api/models/common/Package');
  const Subscription = require('../src/api/models/common/Subscription');
  const Referral = require('../src/api/models/affiliate/Referral');
  const Commission = require('../src/api/models/affiliate/Commission');
  const affiliateService = require('../src/api/services/affiliate/affiliateService');

  // ===== 1. Vérifier le parrain =====
  console.log('=== 1. Parrain ===');
  const parrain = await User.findOne({ appId: APP_ID, email: PARRAIN_EMAIL });
  if (!parrain) {
    console.error(`❌ Parrain ${PARRAIN_EMAIL} introuvable dans appId=${APP_ID}`);
    process.exit(1);
  }
  if (!parrain.affiliate?.isActive) {
    console.error(`❌ ${PARRAIN_EMAIL} n'est pas affilié actif. Active-le depuis l'app d'abord.`);
    process.exit(1);
  }
  if (parrain.affiliate.suspended) {
    console.error(`❌ ${PARRAIN_EMAIL} est suspendu.`);
    process.exit(1);
  }
  const parrainCountry = parrain.affiliate.country;
  console.log(`  ✅ ${PARRAIN_EMAIL}`);
  console.log(`     code: ${parrain.affiliate.code}`);
  console.log(`     country: ${parrainCountry}`);
  console.log(`     userId: ${parrain._id}\n`);

  // ===== 2. Vérifier qu'on a un Package pour la souscription =====
  console.log('=== 2. Package de test ===');
  const pkg = await Package.findOne({ appId: APP_ID, isActive: true })
    .sort({ createdAt: 1 })
    .lean();
  if (!pkg) {
    console.error(`❌ Aucun Package actif pour appId=${APP_ID}. Crée-en un avant.`);
    process.exit(1);
  }
  // Lire le prix depuis le Map pricing
  const pricingMap = pkg.pricing instanceof Map
    ? Object.fromEntries(pkg.pricing)
    : (pkg.pricing || {});
  const priceXAF = pricingMap.XAF || pricingMap.xaf || pricingMap['XAF'] || 1000;
  console.log(`  ✅ Package: ${pkg.name?.fr || pkg.name?.en || pkg._id}`);
  console.log(`     prix XAF: ${priceXAF}\n`);

  // ===== 3. Pour chaque filleul =====
  const results = [];
  for (const f of FILLEULS) {
    console.log(`=== 3. Filleul ${f.email} ===`);

    // 3a. Trouver ou créer le User filleul
    let filleul = await User.findOne({ appId: APP_ID, email: f.email });
    if (filleul) {
      console.log(`  ℹ️  User existe déjà (${filleul._id})`);
    } else {
      console.log(`  ➕ User à créer`);
      if (APPLY) {
        filleul = await User.create({
          appId: APP_ID,
          authProvider: 'google',
          email: f.email,
          googleId: crypto.randomBytes(16).toString('hex'),
          pseudo: f.pseudo,
          firstName: f.firstName,
          lastName: f.lastName,
          countryCode: parrainCountry, // même pays que parrain pour éviter country_mismatch
          isActive: true,
          emailVerified: true,
        });
        console.log(`  ✅ User créé: ${filleul._id}`);
      } else {
        console.log(`  (dry-run) skip création`);
        continue;
      }
    }

    // 3b. Trouver ou créer le Referral
    let referral = await Referral.findOne({
      appId: APP_ID,
      referee: filleul._id,
    });
    if (referral) {
      console.log(`  ℹ️  Referral existe (status=${referral.status})`);
    } else {
      console.log(`  ➕ Referral à créer (avec code ${parrain.affiliate.code})`);
      if (APPLY) {
        referral = await affiliateService.createReferralAtSignup(
          filleul,
          parrain.affiliate.code
        );
        console.log(`  ✅ Referral créé: ${referral._id} (status=${referral.status})`);
      }
    }

    // 3c. Trouver ou créer la Subscription
    const existingSub = await Subscription.findOne({
      appId: APP_ID,
      user: filleul._id,
      package: pkg._id,
    });
    let sub = existingSub;
    if (existingSub) {
      console.log(`  ℹ️  Subscription existe déjà (${existingSub._id})`);
    } else {
      console.log(`  ➕ Subscription à créer`);
      if (APPLY) {
        const now = new Date();
        const endDate = new Date(now);
        endDate.setMonth(endDate.getMonth() + 1);
        sub = await Subscription.create({
          appId: APP_ID,
          user: filleul._id,
          package: pkg._id,
          startDate: now,
          endDate,
          pricing: { amount: priceXAF, currency: 'XAF' },
          status: 'active',
          paymentProvider: 'ADMIN',
          paymentReference: `seed-${crypto.randomBytes(6).toString('hex')}`,
        });
        console.log(`  ✅ Subscription créée: ${sub._id}`);
      }
    }

    // 3d. Trigger la commission
    if (APPLY && sub) {
      console.log(`  ⚙️  Déclenchement commission…`);
      const com = await affiliateService.tryCreateCommissionForSubscription(sub);
      if (com) {
        console.log(`  ✅ Commission: ${com._id} (+${com.amount} ${com.currency}, status=${com.status})`);
      } else {
        console.log(`  ⚠️  Pas de commission générée (vérif statut Referral / config)`);
      }
      results.push({ filleul: f.email, sub: sub._id, commission: com?._id });
    }

    console.log('');
  }

  // ===== 4. Résumé =====
  if (APPLY) {
    console.log('=== Résumé final ===');
    const totalCommissions = await Commission.countDocuments({
      appId: APP_ID,
      referrer: parrain._id,
    });
    const balance = await Commission.aggregate([
      { $match: { appId: APP_ID, referrer: parrain._id, status: 'available' } },
      { $group: { _id: '$currency', total: { $sum: '$amount' } } },
    ]);
    console.log(`  Total commissions (toutes statuts) : ${totalCommissions}`);
    console.log(`  Solde available :`,
      balance.length === 0
        ? '0'
        : balance.map((b) => `${b.total} ${b._id}`).join(', ')
    );
    console.log('');
    console.log('Le parrain peut maintenant ouvrir l\'app → menu → "Mon espace affilié"');
    console.log('et voir ses filleuls + balance + commissions.');
  } else {
    console.log('🟡 Aucun changement appliqué. Relance avec --apply.');
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('❌ Erreur:', err);
  process.exit(1);
});
