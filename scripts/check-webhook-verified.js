/**
 * Vérifie si la Phase 1C (webhook signature verification) fonctionne vraiment
 * sur les transactions AfribaPay récemment reçues.
 *
 * Usage : node scripts/check-webhook-verified.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const AfribaPayTransaction = require('../src/api/models/user/AfribaPayTransaction');

(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('❌ MONGO_URI manquant');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('✅ MongoDB connecté\n');

  // 10 derniers webhooks reçus
  const recent = await AfribaPayTransaction.find(
    { webhookReceived: true },
    {
      orderId: 1,
      status: 1,
      webhookReceived: 1,
      webhookVerified: 1,
      webhookSignature: 1,
      createdAt: 1,
      updatedAt: 1,
      appId: 1
    }
  )
    .sort({ updatedAt: -1 })
    .limit(10)
    .lean();

  if (recent.length === 0) {
    console.log('Aucune transaction avec webhook reçu en BD');
    await mongoose.disconnect();
    return;
  }

  console.log(`${'═'.repeat(100)}`);
  console.log(`  ${recent.length} webhooks AfribaPay les plus récents`);
  console.log(`${'═'.repeat(100)}\n`);

  recent.forEach((t, i) => {
    const sigPresent = t.webhookSignature ? '✅ PRÉSENTE' : '❌ ABSENTE';
    const sigVerified = t.webhookVerified ? '✅ VALIDE' : '❌ INVALIDE/NON-VÉRIFIÉE';
    console.log(`#${i + 1}  orderId: ${t.orderId}`);
    console.log(`     app: ${t.appId} | status: ${t.status} | updatedAt: ${t.updatedAt}`);
    console.log(`     signature reçue : ${sigPresent}`);
    if (t.webhookSignature) {
      console.log(`     signature       : ${t.webhookSignature.substring(0, 32)}...`);
    }
    console.log(`     webhookVerified : ${sigVerified}`);
    console.log('');
  });

  // Stats globales
  const total = await AfribaPayTransaction.countDocuments({ webhookReceived: true });
  const verified = await AfribaPayTransaction.countDocuments({
    webhookReceived: true,
    webhookVerified: true
  });
  const withSig = await AfribaPayTransaction.countDocuments({
    webhookReceived: true,
    webhookSignature: { $exists: true, $ne: null, $ne: '' }
  });

  console.log(`${'─'.repeat(100)}`);
  console.log('  STATS GLOBALES');
  console.log(`${'─'.repeat(100)}`);
  console.log(`  Webhooks reçus (total)        : ${total}`);
  console.log(`  → avec signature dans header  : ${withSig}  (${total > 0 ? ((withSig / total) * 100).toFixed(1) : 0}%)`);
  console.log(`  → webhookVerified = true      : ${verified}  (${total > 0 ? ((verified / total) * 100).toFixed(1) : 0}%)`);
  console.log('');

  // Interprétation
  console.log(`${'═'.repeat(100)}`);
  console.log('  INTERPRÉTATION');
  console.log(`${'═'.repeat(100)}\n`);

  if (withSig === 0) {
    console.log('  ℹ️  AfribaPay n\'envoie pas de signature dans les webhooks.');
    console.log('     → Phase 1C inoffensive (pas de régression).');
    console.log('     → Contacter AfribaPay pour activer la signature si sécurité voulue.');
  } else if (verified === 0 && withSig > 0) {
    console.log('  ⚠️  AfribaPay envoie des signatures mais AUCUNE ne matche.');
    console.log('     → La clé API utilisée pour HMAC est probablement différente de celle qu\'AfribaPay utilise.');
    console.log('     → Vérifier AFRIBAPAY_API_KEY en prod = exactement celle du dashboard AfribaPay.');
  } else if (verified > 0 && verified < withSig) {
    console.log('  ⚠️  Certaines signatures matchent, d\'autres non.');
    console.log('     → Possible souci de raw body (si des webhooks arrivent avec un format différent).');
  } else if (verified === withSig && withSig > 0) {
    console.log('  ✅ PARFAIT : toutes les signatures reçues matchent.');
    console.log('     → Phase 1C pleinement effective : webhooks désormais authentifiés.');
  }

  await mongoose.disconnect();
})().catch(err => {
  console.error('❌ Erreur:', err);
  process.exit(1);
});
