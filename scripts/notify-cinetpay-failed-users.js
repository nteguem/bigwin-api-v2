// scripts/notify-cinetpay-failed-users.js
//
// Envoie un push OneSignal aux users impactés par les échecs CinetPay
// récents. Utilise BOTH les Devices (legacy, bigwin) ET les External
// User IDs OneSignal (nouvelle approche, après que les apps Flutter
// aient été mises à jour avec OneSignal.login(userId)).
//
// SAFE mode par défaut : --dry-run liste les destinataires sans envoyer.
// Lance avec --send pour envoyer pour de vrai.
//
//   node scripts/notify-cinetpay-failed-users.js               (dry-run)
//   node scripts/notify-cinetpay-failed-users.js --send        (envoi réel)

require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
const Device = require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'Device'));
const notificationService = require(path.join(__dirname, '..', 'src', 'api', 'services', 'common', 'notificationService'));

const DRY_RUN = !process.argv.includes('--send');

const MESSAGE = {
  headings: {
    fr: 'Paiement échoué — Réessaie maintenant',
    en: 'Payment failed — Try again now'
  },
  contents: {
    fr: "Un souci technique a empêché ton paiement plus tôt aujourd'hui. C'est résolu ✅ Relance ton paiement pour finaliser ton achat.",
    en: 'A technical issue blocked your payment earlier today. It is fixed now ✅ Retry your payment to complete your purchase.'
  },
  data: { type: 'payment_retry', source: 'cinetpay_recovery_2026-05-19' }
};

(async () => {
  // Logs DB
  const logsUri = process.env.MONGO_LOGS_URI || process.env.MONGO_URI;
  const logsConn = mongoose.createConnection(logsUri);
  await new Promise(r => logsConn.once('open', r));
  const Logs = logsConn.collection('logs');

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const errLogs = await Logs.find({
    service: 'cinetpay',
    level: 'error',
    timestamp: { $gte: todayStart }
  }).toArray();

  // Group userId → appId(s)
  const userMap = new Map();
  for (const log of errLogs) {
    if (!log.userId || !log.appId) continue;
    const u = userMap.get(log.userId) || { userId: log.userId, appIds: new Set() };
    u.appIds.add(log.appId);
    userMap.set(log.userId, u);
  }
  console.log(`\n${userMap.size} users distincts en erreur cinetpay aujourd'hui`);

  // Main DB
  await mongoose.connect(process.env.MONGO_URI);

  // === Path A : legacy Devices (bigwin a 80% de couverture par ce biais) ===
  const userIds = [...userMap.keys()].map(id => new mongoose.Types.ObjectId(id));
  const devices = await Device.find({
    user: { $in: userIds },
    isActive: true,
    playerId: { $exists: true, $ne: null }
  }).lean();

  const reachedByDevice = new Set(devices.map(d => String(d.user)));
  const byAppPlayers = new Map();
  for (const d of devices) {
    const set = byAppPlayers.get(d.appId) || new Set();
    set.add(d.playerId);
    byAppPlayers.set(d.appId, set);
  }

  // === Path B : external_user_id (nouveau, pour les users post-déploiement Flutter) ===
  // Les users qui ne sont PAS atteints par Path A → on tente quand même
  // via external_user_id (sera ignoré silencieusement par OneSignal si le
  // user n'a pas encore appelé OneSignal.login depuis l'app).
  const byAppExternal = new Map();
  for (const [uid, info] of userMap.entries()) {
    if (reachedByDevice.has(uid)) continue; // déjà atteint via Path A
    for (const appId of info.appIds) {
      const set = byAppExternal.get(appId) || new Set();
      set.add(uid);
      byAppExternal.set(appId, set);
    }
  }

  console.log('Plan d\'envoi:');
  console.log('────────────────────────────────────────────────────────────');
  for (const appId of new Set([...byAppPlayers.keys(), ...byAppExternal.keys()])) {
    const pl = byAppPlayers.get(appId)?.size || 0;
    const ex = byAppExternal.get(appId)?.size || 0;
    console.log(`  ${appId.padEnd(15)} → ${String(pl).padStart(3)} via playerId + ${String(ex).padStart(3)} via external_user_id`);
  }
  console.log('');

  console.log('Message FR:', MESSAGE.headings.fr);
  console.log('           ', MESSAGE.contents.fr);
  console.log('Message EN:', MESSAGE.headings.en);
  console.log('           ', MESSAGE.contents.en);
  console.log('');

  if (DRY_RUN) {
    console.log('🟡 DRY-RUN — rien n\'a été envoyé. Relance avec --send pour envoyer.\n');
    await mongoose.disconnect();
    await logsConn.close();
    return;
  }

  // ENVOI REEL
  console.log('🔴 Envoi en cours...\n');
  for (const [appId, playersSet] of byAppPlayers.entries()) {
    const playerIds = [...playersSet];
    try {
      const res = await notificationService.sendToUsers(appId, playerIds, MESSAGE);
      console.log(`  ✅ ${appId} (playerId) → notification ${res.id || '?'} envoyée à ${res.recipients || playerIds.length} appareils`);
    } catch (err) {
      console.log(`  ❌ ${appId} (playerId) → échec: ${err.message}`);
    }
  }
  for (const [appId, extSet] of byAppExternal.entries()) {
    const extIds = [...extSet];
    try {
      const res = await notificationService.sendToExternalUserIds(appId, extIds, MESSAGE);
      console.log(`  ✅ ${appId} (external) → notification ${res.id || '?'} envoyée à ${res.recipients || 0} appareils`);
    } catch (err) {
      console.log(`  ❌ ${appId} (external) → échec: ${err.message}`);
    }
  }

  await mongoose.disconnect();
  await logsConn.close();
  console.log('\n👋 Done');
})().catch(e => { console.error('💥', e); process.exit(1); });
