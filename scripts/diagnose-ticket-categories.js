/**
 * Diagnostic : compare les tickets "Live Events" et les autres pour comprendre
 * pourquoi la correction marche pour Live Events mais pas pour les autres.
 *
 * Usage : node scripts/diagnose-ticket-categories.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('✅ Connecté à MongoDB\n');

  const Ticket = require('../src/api/models/common/Ticket');
  const Prediction = require('../src/api/models/common/Prediction');
  const Category = require('../src/api/models/common/Category');

  // Récupère les 10 tickets les plus récents avec un statut pending ET au moins 1 prédiction
  const tickets = await Ticket.find({})
    .populate('category')
    .sort({ createdAt: -1 })
    .limit(15)
    .lean();

  console.log('━━━ Derniers tickets ━━━\n');
  for (const t of tickets) {
    const preds = await Prediction.find({ ticket: t._id }).lean();
    const catName = (() => {
      const n = t.category?.name;
      if (typeof n === 'object') return n?.fr || n?.en || '?';
      return n || '?';
    })();
    const sports = [...new Set(preds.map((p) => p.sport?.id || '?'))];
    const matchDates = [...new Set(preds.map((p) => (p.matchData?.date || '').toString().split('T')[0]))].filter(Boolean);
    const statuses = preds.reduce((acc, p) => {
      acc[p.status] = (acc[p.status] || 0) + 1;
      return acc;
    }, {});
    const matchIds = preds.map((p) => p.matchData?.id).filter(Boolean);
    const matchStatuses = [...new Set(preds.map((p) => p.matchData?.status).filter(Boolean))];

    console.log(`📋 ${t._id}`);
    console.log(`   Cat       : "${catName}"  (id=${t.category?._id} appId=${t.category?.appId})`);
    console.log(`   Ticket appId : ${t.appId}`);
    console.log(`   Result    : ${t.result || 'pending'}`);
    console.log(`   Sports    : ${sports.join(', ')}`);
    console.log(`   Dates match: ${matchDates.join(', ')}`);
    console.log(`   Statut preds : ${JSON.stringify(statuses)}`);
    console.log(`   Statut matchs en BD : ${matchStatuses.join(', ') || 'aucun'}`);
    console.log(`   Match IDs : ${matchIds.slice(0, 3).join(', ')}${matchIds.length > 3 ? ` (+${matchIds.length - 3})` : ''}`);
    console.log('');
  }

  // Stats globales
  console.log('━━━ Stats catégories ━━━\n');
  const cats = await Category.find({}).lean();
  for (const c of cats) {
    const count = await Ticket.countDocuments({ category: c._id });
    const cName = typeof c.name === 'object' ? (c.name.fr || c.name.en) : c.name;
    console.log(`   "${cName}" (appId=${c.appId}) : ${count} tickets`);
  }

  await mongoose.disconnect();
  console.log('\n✅ Terminé');
})().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
