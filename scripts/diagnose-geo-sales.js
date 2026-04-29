/**
 * Script de diagnostic : liste TOUTES les souscriptions d'aujourd'hui (ou
 * d'une fenêtre custom) avec les détails utilisés par le geoAnalyticsService :
 *   - appId, paymentProvider, isGift
 *   - user.countryCode, user.dialCode, user.phoneNumber
 *   - pricing.amount, pricing.currency
 *
 * Permet de comprendre pourquoi un pays apparaît dans les stats alors que
 * l'admin pense ne pas y avoir vendu.
 *
 * Usage :
 *   node scripts/diagnose-geo-sales.js                # aujourd'hui
 *   node scripts/diagnose-geo-sales.js --days=7       # 7 derniers jours
 *   node scripts/diagnose-geo-sales.js --country=TD   # filtre sur 1 pays
 */

require('dotenv').config();
const mongoose = require('mongoose');

const args = process.argv.slice(2);
const DAYS = parseInt((args.find((a) => a.startsWith('--days=')) || '').split('=')[1], 10) || 0;
const FILTER_COUNTRY = (args.find((a) => a.startsWith('--country=')) || '').split('=')[1] || null;

(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) { console.error('MONGO_URI manquant'); process.exit(1); }

  await mongoose.connect(uri);
  console.log('MongoDB connecté\n');

  const Subscription = require('../src/api/models/common/Subscription');
  const User = require('../src/api/models/user/User');

  // Période : aujourd'hui par défaut, sinon X derniers jours
  const now = new Date();
  const start = new Date(now);
  if (DAYS > 0) {
    start.setDate(start.getDate() - DAYS);
  } else {
    start.setHours(0, 0, 0, 0);
  }

  console.log(`Fenêtre : ${start.toISOString()} → ${now.toISOString()}`);
  if (FILTER_COUNTRY) console.log(`Filtre pays : ${FILTER_COUNTRY.toUpperCase()}\n`);
  else console.log('');

  // bypass pre('find') hook qui force endDate>now
  const subs = await Subscription.collection.find({
    createdAt: { $gte: start },
  }).sort({ createdAt: -1 }).toArray();

  if (subs.length === 0) {
    console.log('Aucune souscription dans la fenêtre.');
    process.exit(0);
  }

  // Charger tous les users en 1 query
  const userIds = subs.map((s) => s.user);
  const users = await User.find({ _id: { $in: userIds } })
    .select('_id appId countryCode dialCode phoneNumber email pseudo firstName')
    .lean();
  const userById = new Map(users.map((u) => [String(u._id), u]));

  console.log(`${subs.length} souscriptions trouvées.\n`);
  console.log('─'.repeat(120));
  console.log(
    'CRÉÉE'.padEnd(22),
    'APP'.padEnd(15),
    'PAYS'.padEnd(8),
    'DIAL'.padEnd(6),
    'PHONE'.padEnd(16),
    'PSP'.padEnd(14),
    'GIFT'.padEnd(6),
    'MONTANT',
  );
  console.log('─'.repeat(120));

  // Stats agrégées par pays
  const byCountry = {};

  for (const s of subs) {
    const user = userById.get(String(s.user));
    const country = (user?.countryCode || 'UNKNOWN').toUpperCase();

    if (FILTER_COUNTRY && country !== FILTER_COUNTRY.toUpperCase()) continue;

    console.log(
      new Date(s.createdAt).toISOString().substring(0, 19).padEnd(22),
      String(s.appId || '?').padEnd(15),
      country.padEnd(8),
      String(user?.dialCode || '?').padEnd(6),
      String(user?.phoneNumber || '?').substring(0, 15).padEnd(16),
      String(s.paymentProvider || '?').padEnd(14),
      (s.isGift ? 'YES' : 'no').padEnd(6),
      `${s.pricing?.amount || 0} ${s.pricing?.currency || '?'}`,
    );

    if (!byCountry[country]) byCountry[country] = { count: 0, gifts: 0, paid: 0 };
    byCountry[country].count++;
    if (s.isGift) byCountry[country].gifts++;
    else byCountry[country].paid++;
  }

  console.log('\n' + '═'.repeat(60));
  console.log('Récap par pays (toutes apps confondues)');
  console.log('═'.repeat(60));
  console.log('PAYS'.padEnd(8), 'TOTAL'.padEnd(10), 'PAYANTS'.padEnd(10), 'CADEAUX');
  for (const [c, v] of Object.entries(byCountry).sort((a, b) => b[1].count - a[1].count)) {
    console.log(c.padEnd(8), String(v.count).padEnd(10), String(v.paid).padEnd(10), v.gifts);
  }

  console.log('\n💡 Note : le geoAnalyticsService EXCLUT les cadeaux (isGift: true)');
  console.log('   du calcul. Donc les colonnes "PAYANTS" sont celles qui apparaissent');
  console.log('   dans le dashboard.\n');

  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('Erreur fatale :', err);
  process.exit(1);
});
