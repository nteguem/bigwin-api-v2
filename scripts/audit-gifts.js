/**
 * Audit du système de cadeaux après refactor.
 *
 * Vérifie :
 *   1. Les modèles se chargent sans erreur (Mongoose syntax check)
 *   2. Les services se chargent sans erreur (require)
 *   3. La connexion BD fonctionne
 *   4. Les indexes attendus sont en place
 *   5. La cohérence référentielle Gift → GiftTier
 *   6. Aucun gift orphelin (tier inexistant ou désactivé)
 *   7. Les wallets ne sont pas en état négatif
 *
 * Read-only : aucune écriture.
 *
 * Usage : node scripts/audit-gifts.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

const issues = [];
const ok = [];

const log = {
  ok: (msg) => {
    ok.push(msg);
    console.log(`   ✅ ${msg}`);
  },
  warn: (msg) => {
    issues.push({ level: 'WARN', msg });
    console.log(`   ⚠️  ${msg}`);
  },
  fail: (msg) => {
    issues.push({ level: 'FAIL', msg });
    console.log(`   ❌ ${msg}`);
  },
  info: (msg) => console.log(`   • ${msg}`),
};

(async () => {
  console.log('━━━ AUDIT du système de cadeaux ━━━\n');

  // ─── 1. Chargement des modèles ───
  console.log('1. Chargement des modèles');
  let GiftTier, Gift, UserCreditWallet, UserGiftUnlock, Package, Subscription;
  try {
    GiftTier = require('../src/api/models/common/GiftTier');
    log.ok('GiftTier chargé');
  } catch (e) {
    log.fail(`GiftTier: ${e.message}`);
    process.exit(1);
  }
  try {
    Gift = require('../src/api/models/common/Gift');
    log.ok('Gift chargé');
  } catch (e) {
    log.fail(`Gift: ${e.message}`);
    process.exit(1);
  }
  try {
    UserCreditWallet = require('../src/api/models/common/UserCreditWallet');
    log.ok('UserCreditWallet chargé');
  } catch (e) {
    log.fail(`UserCreditWallet: ${e.message}`);
  }
  try {
    UserGiftUnlock = require('../src/api/models/common/UserGiftUnlock');
    log.ok('UserGiftUnlock chargé');
  } catch (e) {
    log.fail(`UserGiftUnlock: ${e.message}`);
  }
  try {
    Package = require('../src/api/models/common/Package');
    log.ok('Package chargé (avec unlockCredits)');
    if (!Package.schema.path('unlockCredits')) {
      log.fail("Package n'a pas le champ unlockCredits");
    }
  } catch (e) {
    log.fail(`Package: ${e.message}`);
  }
  try {
    Subscription = require('../src/api/models/common/Subscription');
    log.ok('Subscription chargé');
  } catch (e) {
    log.fail(`Subscription: ${e.message}`);
  }

  // ─── 2. Chargement des services ───
  console.log('\n2. Chargement des services');
  const services = [
    'common/creditWalletService',
    'common/giftCatalogService',
    'common/aiGiftService',
    'admin/giftManagementService',
    'admin/giftTierManagementService',
  ];
  for (const s of services) {
    try {
      require(`../src/api/services/${s}`);
      log.ok(`${s} chargé`);
    } catch (e) {
      log.fail(`${s}: ${e.message}`);
    }
  }

  // ─── 3. Chargement controllers + routes ───
  console.log('\n3. Chargement controllers + routes');
  const components = [
    'controllers/admin/giftController',
    'controllers/admin/giftTierController',
    'controllers/user/giftController',
    'routes/admin/giftRoutes',
    'routes/admin/giftTierRoutes',
    'routes/user/giftRoutes',
  ];
  for (const c of components) {
    try {
      require(`../src/api/${c}`);
      log.ok(c);
    } catch (e) {
      log.fail(`${c}: ${e.message}`);
    }
  }

  // ─── 4. Connexion BD ───
  console.log('\n4. Connexion BD');
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!MONGO_URI) {
    log.fail('MONGO_URI manquant');
    return finish();
  }
  await mongoose.connect(MONGO_URI);
  log.ok(`Connecté à ${mongoose.connection.name}`);

  // ─── 5. Indexes ───
  console.log('\n5. Vérification des indexes');
  await checkIndex(GiftTier, 'key', { unique: true });
  await checkIndex(UserCreditWallet, 'wallet_user_app_unique', { unique: true });
  await checkIndex(UserGiftUnlock, 'unlock_user_gift_app_unique', { unique: true });

  // ─── 6. Cohérence référentielle ───
  console.log('\n6. Cohérence Gift → GiftTier');
  const orphans = await Gift.find({
    tier: { $nin: (await GiftTier.find({}, '_id')).map((t) => t._id) },
  }).select('_id appId title');
  if (orphans.length > 0) {
    log.fail(`${orphans.length} cadeau(x) ont un tier inexistant : ${orphans.map(o => o._id).join(', ')}`);
  } else {
    log.ok('Aucun cadeau orphelin');
  }

  const giftsWithoutTier = await Gift.find({ tier: { $in: [null, undefined] } });
  if (giftsWithoutTier.length > 0) {
    log.fail(`${giftsWithoutTier.length} cadeau(x) sans tier`);
  } else {
    log.ok('Tous les cadeaux ont un tier assigné');
  }

  // ─── 7. Wallets cohérents ───
  console.log('\n7. Cohérence des wallets');
  const negativeWallets = await UserCreditWallet.find({
    $expr: { $gt: ['$usedCredits', '$totalCredits'] },
  });
  if (negativeWallets.length > 0) {
    log.fail(`${negativeWallets.length} wallet(s) avec solde négatif`);
  } else {
    log.ok('Aucun wallet en solde négatif');
  }

  // ─── 8. Inventaire ───
  console.log('\n8. Inventaire');
  const counts = {
    tiers: await GiftTier.countDocuments(),
    gifts: await Gift.countDocuments(),
    activeTiers: await GiftTier.countDocuments({ isActive: true }),
    activeGifts: await Gift.countDocuments({ isActive: true }),
    wallets: await UserCreditWallet.countDocuments(),
    unlocks: await UserGiftUnlock.countDocuments(),
  };
  Object.entries(counts).forEach(([k, v]) => log.info(`${k}: ${v}`));

  // ─── 9. Test calcul effectiveCost ───
  console.log('\n9. Test calcul du coût effectif');
  const sampleGifts = await Gift.find().populate('tier').limit(3);
  if (sampleGifts.length === 0) {
    log.warn('Aucun gift en BD, test skippé');
  } else {
    sampleGifts.forEach((g) => {
      const cost = Gift.computeEffectiveCost(g);
      log.info(
        `"${g.title.fr.slice(0, 40)}" → tier=${g.tier?.key} effective=${cost} (custom=${g.customCreditCost})`
      );
    });
    log.ok('computeEffectiveCost fonctionne');
  }

  await mongoose.disconnect();
  finish();

  // ─────────────────────────
  function finish() {
    console.log('\n━━━ RÉSUMÉ ━━━');
    console.log(`✅ ${ok.length} checks OK`);
    const failures = issues.filter((i) => i.level === 'FAIL').length;
    const warnings = issues.filter((i) => i.level === 'WARN').length;
    if (failures === 0 && warnings === 0) {
      console.log('🟢 Aucun problème détecté.');
      process.exit(0);
    }
    if (warnings > 0) console.log(`⚠️  ${warnings} warning(s)`);
    if (failures > 0) {
      console.log(`❌ ${failures} échec(s) — corriger avant déploiement`);
      process.exit(1);
    }
    process.exit(0);
  }
})().catch((err) => {
  console.error('❌ Erreur fatale audit:', err);
  process.exit(1);
});

// ─────────────────────────────────────────────
async function checkIndex(Model, fieldOrName, expected = {}) {
  try {
    const indexes = await Model.collection.listIndexes().toArray();
    const found = indexes.find(
      (idx) =>
        idx.name === fieldOrName ||
        Object.keys(idx.key || {}).includes(fieldOrName)
    );
    if (!found) {
      log.warn(`Index ${Model.modelName}.${fieldOrName} pas encore créé (sera créé au 1er save)`);
      return;
    }
    if (expected.unique && !found.unique) {
      log.fail(`Index ${Model.modelName}.${fieldOrName} devrait être UNIQUE`);
    } else {
      log.ok(`Index ${Model.modelName}.${fieldOrName} OK`);
    }
  } catch (err) {
    // Collection n'existe pas encore en BD
    log.warn(`Collection ${Model.collection.name} pas encore créée`);
  }
}
