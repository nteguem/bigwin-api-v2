// scripts/seed-wheel.js
//
// Seed la "Roue de la Chance" pour une app : crée la WheelConfig (singleton)
// et les 7 lots par défaut (grille SANS cash validée pour bigwin).
//
// Idempotent : un lot déjà présent (match appId + name.fr) est conservé tel
// quel (les réglages admin ne sont pas écrasés). Passe FORCE_RESEED=1 pour
// supprimer puis recréer tous les lots de l'app.
//
// Usage :
//   node scripts/seed-wheel.js [appId]            (défaut: bigwin)
//   FORCE_RESEED=1 node scripts/seed-wheel.js bigwin

require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');

require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'App'));
const GiftTier = require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'GiftTier'));
const WheelConfig = require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'WheelConfig'));
const WheelPrize = require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'WheelPrize'));

const APP_ID = String(process.argv[2] || 'bigwin').toLowerCase();
const FORCE = process.env.FORCE_RESEED === '1';

// Résout un GiftTier par une liste de clés candidates, fallback sur le label FR.
async function resolveTier(keys, labelRegex) {
  for (const k of keys) {
    const t = await GiftTier.findOne({ key: k }).lean();
    if (t) return t._id;
  }
  const byLabel = await GiftTier.findOne({ 'label.fr': labelRegex }).lean();
  return byLabel ? byLabel._id : null;
}

(async () => {
  if (!process.env.MONGO_URI) {
    console.error('❌ MONGO_URI manquant dans .env');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`[seed-wheel] connecté — app=${APP_ID}${FORCE ? ' (FORCE_RESEED)' : ''}\n`);

  // 1) Config (singleton par app)
  const cfg = await WheelConfig.getSingleton(APP_ID);
  console.log(`Config : wheelEnabled=${cfg.wheelEnabled} · packs=${cfg.ticketPacks.length} · cooldown=${cfg.cooldownSec}s\n`);

  // 2) Tiers pour les lots cadeaux
  const tierArgent = await resolveTier(['argent', 'silver'], /argent|silver/i);
  const tierOr = await resolveTier(['or', 'gold'], /^or$|gold/i);
  if (!tierArgent) console.warn('⚠️  Tier "Argent" introuvable → Cadeau Argent aura tierId=null (à régler dans le back-office).');
  if (!tierOr) console.warn('⚠️  Tier "Or" introuvable → Cadeau Or aura tierId=null (à régler dans le back-office).');

  // 3) Grille des 7 lots (somme des poids = 100)
  const prizes = [
    { name: { fr: 'Dommage', en: 'Try again' },
      type: 'none', icon: '😕', color: '#5C6470', order: 0, weight: 30, isFallback: true },
    { name: { fr: '1 tour gratuit', en: '1 free spin' },
      type: 'free_spin', freeSpin: { count: 1 }, icon: '🎡', color: '#4CAF50', order: 1, weight: 28 },
    { name: { fr: 'Accès VIP 12h', en: 'VIP access 12h' },
      type: 'subscription', subscription: { packageId: null, durationHours: 12 },
      icon: '⭐', color: '#64B4FF', order: 2, weight: 17, caps: { globalDay: 10 } },
    { name: { fr: 'Cadeau Argent', en: 'Silver gift' },
      type: 'gift', gift: { tierId: tierArgent }, icon: '🥈', color: '#B0BEC5', order: 3, weight: 11 },
    { name: { fr: 'Accès VIP 24h', en: 'VIP access 24h' },
      type: 'subscription', subscription: { packageId: null, durationHours: 24 },
      icon: '✨', color: '#9FE800', order: 4, weight: 9, caps: { globalDay: 10 } },
    { name: { fr: 'Cadeau Or', en: 'Gold gift' },
      type: 'gift', gift: { tierId: tierOr }, icon: '🥇', color: '#FFC83D', order: 5, weight: 3 },
    { name: { fr: 'Accès VIP 1 semaine', en: 'VIP access 1 week' },
      type: 'subscription', subscription: { packageId: null, durationHours: 168 },
      icon: '👑', color: '#FFD700', order: 6, weight: 2, caps: { globalDay: 10 } }
  ];

  if (FORCE) {
    const del = await WheelPrize.deleteMany({ appId: APP_ID });
    console.log(`FORCE_RESEED : ${del.deletedCount} lot(s) supprimé(s).\n`);
  }

  console.log('Lots :');
  let created = 0, skipped = 0;
  for (const p of prizes) {
    const existing = await WheelPrize.findOne({ appId: APP_ID, 'name.fr': p.name.fr });
    if (existing) {
      skipped++;
      console.log(`  ⏭️  ${p.name.fr.padEnd(22)} (déjà présent — conservé)`);
      continue;
    }
    await WheelPrize.create({ ...p, appId: APP_ID });
    created++;
    const proba = `${p.weight}%`;
    console.log(`  ✅ ${p.name.fr.padEnd(22)} ${p.type.padEnd(13)} ${proba}`);
  }

  console.log(`\n[seed-wheel] terminé — ${created} créé(s), ${skipped} conservé(s).`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
