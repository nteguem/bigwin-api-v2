/**
 * @fileoverview Correction des tickets (coupons) basée sur le résultat de
 * leurs prédictions.
 *
 * Règle métier :
 *   - won  : toutes les prédictions décidées sont 'won' (au moins 1 décidée)
 *   - lost : au moins 1 prédiction 'lost' parmi celles du ticket
 *   - pending : il reste des prédictions 'pending' et aucune 'lost'
 *   - void : seulement des 'void' (cas marginal)
 *
 * Doit s'exécuter APRÈS la correction des prédictions, sinon les tickets
 * resteront 'pending' alors que les pronos sont corrigés.
 *
 * Utilisé en deux modes :
 *   1) cron quotidien (juste après le cron de correction des pronos)
 *   2) backfill manuel : `correctTickets({ lookbackDays: 10 })`
 */

const logger = require('../../../utils/logger');
const Ticket = require('../../models/common/Ticket');
const Prediction = require('../../models/common/Prediction');

function deriveResult(predStatuses) {
  let pending = 0, won = 0, lost = 0, voidCount = 0;
  for (const s of predStatuses) {
    if (s === 'pending') pending++;
    else if (s === 'won') won++;
    else if (s === 'lost') lost++;
    else if (s === 'void') voidCount++;
  }
  if (lost > 0) return 'lost';
  if (pending > 0) return 'pending';
  if (won > 0) return 'won';
  if (voidCount > 0) return 'void';
  return 'pending';
}

/**
 * Corrige tous les tickets dont la date de création est dans la fenêtre
 * lookback. On ne se base pas sur ticket.result pour décider qui inclure :
 * un ticket déjà 'won' peut être recalculé si une pred a été corrigée
 * tardivement (cas rare mais réel).
 *
 * @param {Object} opts
 * @param {number} [opts.lookbackDays=10] - Fenêtre en jours
 * @param {string} [opts.appId]            - Limiter à une app
 * @param {boolean} [opts.dryRun=false]    - Ne pas écrire en base
 * @returns {Promise<Object>} Stats {scanned, updated, byResult}
 */
async function correctTickets({ lookbackDays = 10, appId, dryRun = false } = {}) {
  const startTime = Date.now();
  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);

  const ticketQuery = { createdAt: { $gte: since } };
  if (appId && appId !== 'all') ticketQuery.appId = appId;

  const tickets = await Ticket.find(ticketQuery).select('_id appId result').lean();
  if (tickets.length === 0) {
    logger.info(`[ticketCorrection] Aucun ticket dans les ${lookbackDays} derniers jours`);
    return { scanned: 0, updated: 0, byResult: {}, durationMs: Date.now() - startTime };
  }

  const ticketIds = tickets.map((t) => t._id);

  // Récupérer toutes les prédictions liées en un seul query
  const preds = await Prediction.find({ ticket: { $in: ticketIds } })
    .select('ticket status')
    .lean();

  // Indexer par ticket
  const predsByTicket = new Map();
  for (const p of preds) {
    const key = String(p.ticket);
    if (!predsByTicket.has(key)) predsByTicket.set(key, []);
    predsByTicket.get(key).push(p.status);
  }

  // Calculer + mettre à jour
  const stats = { scanned: tickets.length, updated: 0, byResult: { pending: 0, won: 0, lost: 0, void: 0 } };
  const bulkOps = [];

  for (const t of tickets) {
    const statuses = predsByTicket.get(String(t._id)) || [];
    // Pas de pronos ⇒ on laisse pending (ticket draft probable)
    if (statuses.length === 0) continue;

    const newResult = deriveResult(statuses);
    stats.byResult[newResult] = (stats.byResult[newResult] || 0) + 1;

    if (t.result !== newResult) {
      stats.updated++;
      if (!dryRun) {
        bulkOps.push({
          updateOne: {
            filter: { _id: t._id },
            update: { $set: { result: newResult, resultUpdatedAt: new Date() } },
          },
        });
      }
    }
  }

  if (bulkOps.length > 0 && !dryRun) {
    await Ticket.bulkWrite(bulkOps, { ordered: false });
  }

  stats.durationMs = Date.now() - startTime;
  logger.info(
    `[ticketCorrection] scanned=${stats.scanned} updated=${stats.updated} ` +
    `won=${stats.byResult.won} lost=${stats.byResult.lost} ` +
    `pending=${stats.byResult.pending} void=${stats.byResult.void} ` +
    `dryRun=${dryRun} duration=${stats.durationMs}ms`
  );

  return stats;
}

module.exports = {
  correctTickets,
  deriveResult,
};
