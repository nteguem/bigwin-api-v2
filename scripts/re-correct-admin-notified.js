/**
 * Re-correction des prédictions impactées par le bug `expressionResult`
 * dans correctAndNotifyService.js (qui marquait TOUTES les prédictions
 * comme 'lost' quand l'admin cliquait "Notifier le succès").
 *
 * STRATÉGIE :
 *   1. Trouve les prédictions avec :
 *        - status === 'lost'
 *        - correctionMetadata.correctionSource === 'admin-notify-success'
 *   2. Pour chacune : re-fetch les données du match via les providers,
 *      re-applique le Corrector (qui est correct), met à jour le status.
 *   3. Si le status passe de 'lost' à 'won', on collecte le ticketId pour
 *      re-corriger le ticket entier ensuite.
 *   4. À la fin : appelle ticketCorrectionService.correctTickets({ticketIds})
 *      pour les tickets impactés.
 *
 * GARANTIES :
 *   - Ne touche PAS les prédictions corrigées par le cron (correctionSource
 *     différent : 'auto-cron', 'manual', etc.) → corrections existantes intactes.
 *   - Ne touche PAS les prédictions où le bug avait raison (ticket réellement
 *     perdu) → le Corrector renvoie 'lost', on confirme, pas de changement.
 *   - 100% idempotent : relancer = no-op si aucune nouvelle correction.
 *
 * USAGE :
 *   node scripts/re-correct-admin-notified.js                  # dry-run
 *   node scripts/re-correct-admin-notified.js --apply          # appliquer
 *   node scripts/re-correct-admin-notified.js --apply --since 2026-04-15
 *     (ne traite que les prédictions corrigées après cette date — utile si
 *     on sait quand le bug a été introduit)
 */

require('dotenv').config();
const mongoose = require('mongoose');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const sinceIdx = args.indexOf('--since');
const SINCE = sinceIdx >= 0 ? new Date(args[sinceIdx + 1]) : null;

if (sinceIdx >= 0 && (isNaN(SINCE) || !SINCE)) {
  console.error('❌ --since doit être une date valide (ex: 2026-04-15)');
  process.exit(1);
}

(async () => {
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!MONGO_URI) {
    console.error('❌ MONGO_URI manquant');
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connecté à MongoDB');
  if (!APPLY) console.log('🟡 DRY-RUN. Lance avec --apply pour exécuter.\n');

  const Prediction = require('../src/api/models/common/Prediction');
  const Corrector = require('../src/core/events/Corrector');
  const { fetchAndStoreData } = require('../src/core/sports/providers/initService');
  const { correctTickets } = require('../src/api/services/common/ticketCorrectionService');

  const corrector = new Corrector();

  // ========== 1. Trouver les prédictions impactées ==========
  const filter = {
    status: 'lost',
    'correctionMetadata.correctionSource': 'admin-notify-success',
  };
  if (SINCE) {
    filter['correctionMetadata.correctedAt'] = { $gte: SINCE };
    console.log(`📅 Filtre date : corrigées après ${SINCE.toISOString()}`);
  }

  const predictions = await Prediction.find(filter).lean({ getters: false });

  console.log(`📊 ${predictions.length} prédiction(s) candidate(s) à re-correction\n`);
  if (predictions.length === 0) {
    console.log('✅ Rien à faire.');
    await mongoose.disconnect();
    return;
  }

  // ========== 2. Re-corriger chaque prédiction ==========
  const stats = {
    processed: 0,
    confirmedLost: 0,    // bug a eu de la chance, le résultat était bien lost
    flippedToWon: 0,     // VICTIMES DU BUG : on les sauve
    flippedToVoid: 0,
    errors: 0,
    skippedNoData: 0,
  };
  const impactedTicketIds = new Set();

  // Cache fetchAndStoreData par (sport, date) pour éviter de spammer l'API
  const fetchCache = new Map();
  const getMatches = async (sport, date) => {
    const key = `${sport}|${date}`;
    if (fetchCache.has(key)) return fetchCache.get(key);
    // false = pas de force refresh : on utilise le cache local s'il est frais
    const data = await fetchAndStoreData(sport, date, false);
    fetchCache.set(key, data);
    return data;
  };

  for (const p of predictions) {
    stats.processed++;
    try {
      const sport = p.sport?.id || 'football';
      const matchDate = (p.matchData?.date || '').toString().split('T')[0];
      if (!matchDate) {
        console.log(`   ⏭️  ${p._id} : pas de date de match`);
        stats.skippedNoData++;
        continue;
      }

      let freshData = await getMatches(sport, matchDate);
      const matchId = String(p.matchData?.id || '');
      let m = freshData?.matches?.find((x) => String(x.id) === matchId);

      // Si match non terminé dans le cache, on force un refresh API
      if (!m || !['FINISHED', 'FT'].includes(m.status)) {
        console.log(`   🔄 ${p._id} : refresh API (match ${matchId} ${m?.status || 'introuvable'})`);
        freshData = await fetchAndStoreData(sport, matchDate, true);
        fetchCache.set(`${sport}|${matchDate}`, freshData);
        m = freshData?.matches?.find((x) => String(x.id) === matchId);
      }

      if (!m) {
        console.log(`   ⏭️  ${p._id} : match ${matchId} introuvable dans l'API`);
        stats.skippedNoData++;
        continue;
      }
      if (!['FINISHED', 'FT'].includes(m.status)) {
        console.log(`   ⏭️  ${p._id} : match pas terminé (${m.status})`);
        stats.skippedNoData++;
        continue;
      }

      const correction = corrector.correctPrediction(
        {
          id: p._id.toString(),
          event: p.event,
          matchData: p.matchData,
          sport: p.sport,
          status: p.status,
        },
        m,
        sport
      );

      if (!correction.success || !correction.correction?.canCorrect) {
        console.log(`   ⏭️  ${p._id} : correction impossible (${correction.correction?.reason})`);
        stats.skippedNoData++;
        continue;
      }

      const newStatus = correction.correction.result ? 'won' : 'lost';
      const home = m.score?.home;
      const away = m.score?.away;
      const teams = `${m.teams?.home?.name || '?'} ${home}-${away} ${m.teams?.away?.name || '?'}`;
      const eventLabel =
        p.event?.label?.fr || p.event?.label?.en || p.event?.id || '?';

      if (newStatus === 'lost') {
        // Le bug avait eu de la chance → on confirme
        console.log(`   ✓ ${p._id} : confirmé LOST | ${teams} | "${eventLabel}"`);
        stats.confirmedLost++;
        continue;
      }

      // VICTIME DU BUG : la prédiction était en réalité gagnée
      console.log(
        `   🎯 ${p._id} : LOST → ${newStatus.toUpperCase()} ✨ | ${teams} | "${eventLabel}"`
      );
      stats.flippedToWon++;

      if (APPLY) {
        await Prediction.findByIdAndUpdate(p._id, {
          $set: {
            status: newStatus,
            'correctionMetadata.correctedAt': new Date(),
            'correctionMetadata.correctionSource': 'bug-fix-rerun',
            'correctionMetadata.confidence':
              correction.correction.confidence || 'high',
            'correctionMetadata.expression': correction.correction.expression,
            'correctionMetadata.reason': `[BUG FIX] ${correction.correction.reason}`,
          },
        });
      }

      if (p.ticket) {
        impactedTicketIds.add(p.ticket.toString());
      }
    } catch (err) {
      stats.errors++;
      console.error(`   ❌ ${p._id} : ${err.message}`);
    }
  }

  console.log('\n📈 Résumé prédictions :');
  console.log(`   Traitées       : ${stats.processed}`);
  console.log(`   Confirmées LOST: ${stats.confirmedLost}`);
  console.log(`   ✨ Récupérées WON : ${stats.flippedToWon}`);
  console.log(`   Skippées       : ${stats.skippedNoData}`);
  console.log(`   Erreurs        : ${stats.errors}`);

  // ========== 3. Re-corriger les tickets impactés ==========
  if (impactedTicketIds.size > 0) {
    console.log(`\n🎫 Re-correction de ${impactedTicketIds.size} ticket(s) impacté(s)...`);
    if (APPLY) {
      const ticketResult = await correctTickets({
        ticketIds: Array.from(impactedTicketIds),
        dryRun: false,
      });
      console.log(
        `   Tickets scanned=${ticketResult.scanned} updated=${ticketResult.updated}`
      );
      console.log(
        `   By result : pending=${ticketResult.byResult.pending} won=${ticketResult.byResult.won} lost=${ticketResult.byResult.lost} void=${ticketResult.byResult.void}`
      );
    } else {
      console.log(`   [DRY] tickets : ${Array.from(impactedTicketIds).join(', ')}`);
    }
  } else {
    console.log('\n🎫 Aucun ticket impacté.');
  }

  await mongoose.disconnect();
  console.log('\n✅ Terminé');
})().catch((err) => {
  console.error('❌ Erreur fatale:', err);
  process.exit(1);
});
