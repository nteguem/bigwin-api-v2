/**
 * READ-ONLY — Inspecte les tickets des 5 derniers jours pour valider le futur
 * endpoint "bilan" (weekly-report).
 *
 * Objectifs :
 *   - Confirmer la disponibilité du champ `result` (won/lost/pending/void)
 *   - Mesurer la part de tickets `pending` (qu'on EXCLURA du bilan)
 *   - Vérifier la répartition free (isVip=false) / VIP (isVip=true)
 *   - Simuler l'agrégation par catégorie (won / total décidés + %)
 *
 * N'ÉCRIT RIEN. Usage : node scripts/inspect-weekly-report-data.js [appId] [daysBack]
 *   ex: node scripts/inspect-weekly-report-data.js bigwin 5
 */

require('dotenv').config();
const mongoose = require('mongoose');

const APP_ID = (process.argv[2] || '').toLowerCase() || null; // null = toutes apps
const DAYS_BACK = parseInt(process.argv[3] || '5', 10);

(async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('✅ Connecté à MongoDB\n');

  const Ticket = require('../src/api/models/common/Ticket');
  require('../src/api/models/common/Category');

  // Fenêtre : les DAYS_BACK derniers jours (jusqu'à hier inclus, comme l'historique).
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - DAYS_BACK);
  start.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setHours(0, 0, 0, 0); // exclut aujourd'hui (jour en cours pas fini)

  const match = { date: { $gte: start, $lt: end } };
  if (APP_ID) match.appId = APP_ID;

  console.log(`Fenêtre : ${start.toISOString().split('T')[0]} → ${end.toISOString().split('T')[0]} (exclus)`);
  console.log(`App     : ${APP_ID || 'TOUTES'}\n`);

  const tickets = await Ticket.find(match).populate('category').lean();
  console.log(`Total tickets sur la fenêtre : ${tickets.length}\n`);

  if (tickets.length === 0) {
    console.log('⚠️  Aucun ticket sur la fenêtre. Élargis daysBack ou vérifie l\'appId.');
    await mongoose.disconnect();
    return;
  }

  // Répartition globale des results
  const globalResults = {};
  for (const t of tickets) {
    const r = t.result || 'pending';
    globalResults[r] = (globalResults[r] || 0) + 1;
  }
  console.log('━━━ Répartition globale des `result` ━━━');
  console.log(JSON.stringify(globalResults, null, 2));
  const pendingPct = Math.round(((globalResults.pending || 0) / tickets.length) * 100);
  console.log(`→ ${pendingPct}% de tickets PENDING (seront exclus du bilan)\n`);

  // Agrégation par segment (free/VIP) puis par catégorie — comme le futur endpoint
  for (const segment of [false, true]) {
    const segTickets = tickets.filter((t) => !!t.category && !!t.category.isVip === segment);
    const label = segment ? 'VIP (isVip=true)' : 'FREE (isVip=false)';
    console.log(`━━━ Segment ${label} — ${segTickets.length} tickets ━━━`);

    if (segTickets.length === 0) {
      console.log('   (aucun ticket)\n');
      continue;
    }

    // Global du segment (tickets décidés seulement)
    let segWon = 0, segDecided = 0;
    const byCat = new Map();
    for (const t of segTickets) {
      const r = t.result || 'pending';
      const catName = t.category?.name?.fr || t.category?.name?.en || t.category?.name || '?';
      if (!byCat.has(catName)) byCat.set(catName, { won: 0, lost: 0, pending: 0, void: 0 });
      const c = byCat.get(catName);
      c[r] = (c[r] || 0) + 1;
      if (r === 'won' || r === 'lost') { segDecided++; if (r === 'won') segWon++; }
    }
    const segRate = segDecided ? Math.round((segWon / segDecided) * 100) : 0;
    console.log(`   GLOBAL décidé : ${segWon}/${segDecided}  (${segRate}%)   [pending exclus]`);
    console.log('   Par catégorie :');
    for (const [cat, c] of byCat) {
      const decided = c.won + c.lost;
      const rate = decided ? Math.round((c.won / decided) * 100) : 0;
      console.log(
        `     • ${cat.padEnd(22)} ${String(c.won + '/' + decided).padEnd(8)} ${String(rate + '%').padEnd(5)}` +
        `  (pending:${c.pending} void:${c.void})`
      );
    }
    console.log('');
  }

  // Tickets sans catégorie (orphelins) — signaler car ils casseraient l'agrégation
  const orphan = tickets.filter((t) => !t.category);
  if (orphan.length) {
    console.log(`⚠️  ${orphan.length} ticket(s) SANS catégorie (catégorie supprimée) — à filtrer dans l'endpoint`);
  }

  await mongoose.disconnect();
  console.log('✅ Terminé');
})().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
