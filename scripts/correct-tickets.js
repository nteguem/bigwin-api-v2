/**
 * Backfill / re-correction des tickets : calcule le champ `result` (won/lost/
 * pending/void) sur tous les tickets dans la fenêtre lookback, en se basant
 * sur le statut actuel de leurs prédictions.
 *
 * Le cron quotidien fait déjà ça automatiquement après la correction des
 * pronos. Ce script sert pour :
 *   1) le tout premier déploiement (champ `result` vient d'être ajouté au schéma)
 *   2) un backfill manuel après un fix de prédictions
 *
 * Mode DRY-RUN par défaut : ne touche pas à la base.
 *
 * Usage :
 *   node scripts/correct-tickets.js                          # dry-run, 10j
 *   node scripts/correct-tickets.js --apply                  # écrit en base
 *   node scripts/correct-tickets.js --apply --days=30        # fenêtre custom
 *   node scripts/correct-tickets.js --apply --app-id=bigwin  # une seule app
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { correctTickets } = require('../src/api/services/common/ticketCorrectionService');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DAYS = parseInt((args.find((a) => a.startsWith('--days=')) || '').split('=')[1], 10) || 10;
const APP_ID = (args.find((a) => a.startsWith('--app-id=')) || '').split('=')[1] || null;

(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI manquant dans .env');
    process.exit(1);
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Ticket correction  ${APPLY ? '[APPLY]' : '[DRY-RUN]'}`);
  console.log(`  Lookback : ${DAYS} jour(s)`);
  if (APP_ID) console.log(`  appId    : ${APP_ID}`);
  console.log(`${'═'.repeat(60)}\n`);

  await mongoose.connect(uri);
  console.log('MongoDB connecté\n');

  const stats = await correctTickets({
    lookbackDays: DAYS,
    appId: APP_ID || undefined,
    dryRun: !APPLY,
  });

  console.log('\nRésultats');
  console.log(`  Tickets scannés : ${stats.scanned}`);
  console.log(`  À mettre à jour : ${stats.updated}`);
  console.log(`  Dérivation :`);
  console.log(`    won     : ${stats.byResult.won || 0}`);
  console.log(`    lost    : ${stats.byResult.lost || 0}`);
  console.log(`    pending : ${stats.byResult.pending || 0}`);
  console.log(`    void    : ${stats.byResult.void || 0}`);
  console.log(`  Durée   : ${stats.durationMs}ms\n`);

  if (!APPLY) {
    console.log('Mode dry-run : rien n\'a été écrit en base.');
    console.log('Relancer avec --apply pour persister les changements.\n');
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('Erreur fatale :', err);
  process.exit(1);
});
