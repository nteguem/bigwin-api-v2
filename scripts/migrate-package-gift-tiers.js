// scripts/migrate-package-gift-tiers.js
//
// Assigne le `giftTier` aux packages des 4 apps (goatips, goodtips,
// strategytips, wisetips) selon le mapping validé :
//   - Apps avec 3 packages (goatips, goodtips) → Argent / Or / Diamant
//   - Apps avec 2 packages (strategytips, wisetips) → Argent / Or
//
// Usage :
//   node scripts/migrate-package-gift-tiers.js          (dry-run, défaut)
//   node scripts/migrate-package-gift-tiers.js --apply  (applique)

require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

// IDs des GiftTiers (vérifiés en BD)
const TIER_IDS = {
  silver: '69f43662b2077ae3171233c7',
  gold: '69f43663b2077ae3171233ca',
  diamond: '69f43664b2077ae3171233cd',
};

// Mapping packageId → tierKey (validé par l'utilisateur)
const MAPPING = [
  { packageId: '694bd74aa9e70426ccc3b06c', appId: 'goatips', name: 'GOAT WEEK', tier: 'silver' },
  { packageId: '694bd74aa9e70426ccc3b06d', appId: 'goatips', name: 'GOAT BIWEEKLY', tier: 'gold' },
  { packageId: '694bd74aa9e70426ccc3b06e', appId: 'goatips', name: 'GOAT GOLD', tier: 'diamond' },
  { packageId: '694bd74aa9e70426ccc3b07c', appId: 'goodtips', name: 'GOOD WEEK', tier: 'silver' },
  { packageId: '69651e23194afe8fb081e518', appId: 'goodtips', name: 'GOOD BIWEEK', tier: 'gold' },
  { packageId: '69651e50194afe8fb081e519', appId: 'goodtips', name: 'GOOD MONTHLY', tier: 'diamond' },
  { packageId: '696cd5cb8a215fcc10ee5c33', appId: 'strategytips', name: 'STRATEGY START', tier: 'silver' },
  { packageId: '69dcea065ccb13592d4e85a0', appId: 'strategytips', name: 'STRATEGY 14 JOURS', tier: 'gold' },
  { packageId: '696ca09e8a215fcc10ee5c2b', appId: 'wisetips', name: 'QUICK START', tier: 'silver' },
  { packageId: '69dcec685ccb13592d4eb6a2', appId: 'wisetips', name: 'WISE 14 JOURS', tier: 'gold' },
];

(async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('✅ Connecté à MongoDB');
  console.log(APPLY ? '🟢 MODE APPLY' : '🟡 DRY-RUN. Lance avec --apply pour exécuter.');
  console.log('');

  const packagesCol = mongoose.connection.collection('packages');
  const tiersCol = mongoose.connection.collection('gifttiers');

  // Sanity check : les 3 tiers existent bien
  const tiers = await tiersCol
    .find({ _id: { $in: Object.values(TIER_IDS).map((id) => new mongoose.Types.ObjectId(id)) } })
    .toArray();
  if (tiers.length !== 3) {
    console.error(`❌ Sanity check raté : seulement ${tiers.length}/3 tiers trouvés`);
    process.exit(1);
  }
  console.log('✅ Sanity check OK : 3 tiers trouvés (silver, gold, diamond)');
  console.log('');

  let updated = 0;
  let alreadySet = 0;
  let notFound = 0;

  for (const m of MAPPING) {
    const pkg = await packagesCol.findOne({ _id: new mongoose.Types.ObjectId(m.packageId) });
    if (!pkg) {
      console.log(`   ❌ NOT FOUND: ${m.appId} / ${m.name} (${m.packageId})`);
      notFound++;
      continue;
    }

    const targetTierId = TIER_IDS[m.tier];
    const currentTier = pkg.giftTier ? pkg.giftTier.toString() : null;

    if (currentTier === targetTierId) {
      console.log(`   ✓ ALREADY: ${m.appId} / ${m.name} → ${m.tier.toUpperCase()}`);
      alreadySet++;
      continue;
    }

    if (APPLY) {
      await packagesCol.updateOne(
        { _id: pkg._id },
        { $set: { giftTier: new mongoose.Types.ObjectId(targetTierId) } }
      );
      console.log(`   ✅ UPDATED: ${m.appId} / ${m.name} → ${m.tier.toUpperCase()}`);
    } else {
      console.log(`   ➕ [DRY] ${m.appId} / ${m.name} → ${m.tier.toUpperCase()}`);
    }
    updated++;
  }

  console.log('');
  console.log('📈 Résumé :');
  console.log(`   Total mapping  : ${MAPPING.length}`);
  console.log(`   À updater      : ${updated}`);
  console.log(`   Déjà OK        : ${alreadySet}`);
  console.log(`   Introuvables   : ${notFound}`);
  console.log('');

  await mongoose.disconnect();
  console.log('✅ Terminé');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
