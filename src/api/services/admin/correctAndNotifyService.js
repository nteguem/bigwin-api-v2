// src/api/services/admin/correctAndNotifyService.js
//
// Orchestrateur "Corriger + Notifier" déclenché manuellement par l'admin
// depuis le bouton "Notifier le succès" d'un ticket ou d'une prédiction.
//
// Avant ce service, le bouton envoyait juste une push de célébration mais la
// prédiction/ticket restait `pending` en BD jusqu'au cron 23:57 UTC. Résultat :
// l'user ouvrait l'app et voyait "en attente" alors que la notif disait "gagné".
//
// Maintenant on corrige d'abord, puis on notifie SI ET SEULEMENT SI le résultat
// est effectivement gagné (sécurité contre fausses notifs de victoire).

const Prediction = require('../../models/common/Prediction');
const Ticket = require('../../models/common/Ticket');
const Corrector = require('../../../core/events/Corrector');
const { fetchAndStoreData } = require('../../../core/sports/providers/initService');
const { correctTickets } = require('../common/ticketCorrectionService');
const notificationService = require('../common/notificationService');
const logger = require('../../../utils/logger');
const { AppError } = require('../../../utils/AppError');

const corrector = new Corrector();

/* ─────────────────────────────────────────────────────────────────
 * Helpers : extraction date + correction d'une seule prédiction
 * ───────────────────────────────────────────────────────────────── */

function extractDateYYYYMMDD(matchDate) {
  if (!matchDate) return null;
  const d = typeof matchDate === 'string' ? matchDate : new Date(matchDate).toISOString();
  return d.split('T')[0];
}

/**
 * Corrige une seule prédiction en allant chercher les données du match.
 * Retourne 'corrected' / 'void' / 'skipped'.
 */
async function correctOnePrediction(prediction) {
  const sport = prediction.sport?.id || 'football';
  const matchDate = extractDateYYYYMMDD(prediction.matchData?.date);
  if (!matchDate) {
    return { status: 'skipped', reason: 'Pas de date de match' };
  }

  // 1) Cache local d'abord
  let freshData = await fetchAndStoreData(sport, matchDate, false);
  const matchId = String(prediction.matchData?.id);
  const matchInCache = freshData?.matches?.find((m) => String(m.id) === matchId);

  // 2) Si match introuvable ou pas terminé dans le cache → refresh API
  const cacheNeedsRefresh = !matchInCache ||
    ['NOT_STARTED', 'NS', 'LIVE'].includes(matchInCache.status);
  if (cacheNeedsRefresh) {
    logger.info(`[correctAndNotify] Refresh API pour ${sport}/${matchDate} (match ${matchId})`);
    freshData = await fetchAndStoreData(sport, matchDate, true);
  }

  if (!freshData?.matches) {
    return { status: 'skipped', reason: 'Aucune donnée de match disponible' };
  }

  // 3) Trouver les données de NOTRE match
  const matchData = freshData.matches.find((m) => String(m.id) === matchId);
  if (!matchData) {
    return { status: 'skipped', reason: 'Match non trouvé dans les données' };
  }

  // 4) Vérifier que le match est terminé
  if (!['FINISHED', 'FT'].includes(matchData.status)) {
    return { status: 'skipped', reason: `Match non terminé (${matchData.status})` };
  }

  // 5) Appliquer la correction via le Corrector
  const correction = corrector.correctPrediction(prediction, matchData, sport);
  if (!correction.success || !correction.correction?.canCorrect) {
    return { status: 'skipped', reason: correction.error || 'Correction impossible' };
  }

  // 6) Persister
  const newStatus = correction.correction.expressionResult ? 'won' : 'lost';
  prediction.status = newStatus;
  prediction.correctionAttempts = (prediction.correctionAttempts || 0) + 1;
  prediction.correctionMetadata = {
    correctedAt: new Date(),
    correctionSource: 'admin-notify-success',
    confidence: correction.correction.confidence || 'high',
    expression: correction.correction.expression,
    reason: correction.correction.reason || '',
  };
  await prediction.save();

  return { status: 'corrected', newStatus };
}

/* ─────────────────────────────────────────────────────────────────
 * Construction des notifications (porté du frontend)
 * ───────────────────────────────────────────────────────────────── */

function buildTicketName(predictions, maxDisplay = 5) {
  const matches = predictions.map((pred) => {
    const event = pred.event?.label?.fr || pred.event?.label?.en || '';
    if (pred.sport?.id === 'horse') {
      const race = pred.matchData?.raceInfo?.raceName || 'Course';
      return event ? `${race} - ${event}` : race;
    }
    const home = pred.matchData?.teams?.home?.name;
    const away = pred.matchData?.teams?.away?.name;
    const base = home && away ? `${home} vs ${away}` : 'Match';
    return event ? `${base} - ${event}` : base;
  });
  const display = matches.slice(0, maxDisplay);
  const remaining = matches.length - maxDisplay;
  return { matchList: display, remaining: remaining > 0 ? remaining : 0 };
}

function buildTicketSuccessNotification(ticket, predictions) {
  let categoryName = ticket.category?.description || ticket.category?.name || 'Coupon';
  if (categoryName && typeof categoryName === 'object') {
    categoryName = categoryName.fr || categoryName.en || 'Coupon';
  }
  const categoryIcon = ticket.category?.icon || '🎯';
  const { matchList, remaining } = buildTicketName(predictions);

  let matchesTextFr = matchList.map((m) => `✅ ${m}`).join('\n');
  let matchesTextEn = matchesTextFr; // même format, ✅ universel
  if (remaining > 0) {
    matchesTextFr += `\n...et ${remaining} autres 🎯`;
    matchesTextEn += `\n...and ${remaining} more 🎯`;
  }

  // category_id permet au mobile d'ouvrir directement la bonne catégorie
  // dans CouponDetailsModal sans avoir à fetch le ticket d'abord.
  const categoryId = ticket.category?._id ? String(ticket.category._id) : null;

  return {
    headings: {
      en: `${categoryIcon} ${categoryName} - All Predictions Won!`,
      fr: `${categoryIcon} Coupon ${categoryName} - Tous les Pronos Gagnés !`,
    },
    contents: {
      en: `PERFECT SCORE!\n${matchesTextEn}\n👉 View details!`,
      fr: `CARTON PLEIN !\n${matchesTextFr}\n👉 Voir les détails !`,
    },
    data: {
      type: 'ticket_success',
      ticket_id: String(ticket._id),
      category_id: categoryId,
      category_name: typeof categoryName === 'string' ? categoryName : 'Coupon',
      success_rate: 100,
      total_predictions: predictions.length,
      action: 'view_ticket_results',
    },
    options: {
      android_accent_color: 'FFD700',
      small_icon: 'ic_notification',
      large_icon: 'ic_launcher',
      priority: 10,
    },
  };
}

function buildPredictionSuccessNotification(prediction) {
  const sportName = prediction.sport?.name || 'Sport';
  const sportIcon = prediction.sport?.icon || '⚽';

  let matchDisplay, betDisplayFr, betDisplayEn;
  if (prediction.sport?.id === 'horse') {
    const race = prediction.matchData?.raceInfo?.raceName || 'Course';
    const horse = prediction.event?.horseSpecific?.selectedParticipant?.nom || '';
    const num = prediction.event?.horseSpecific?.selectedHorse || '';
    matchDisplay = race;
    betDisplayFr = horse ? `${horse} (${num})` : prediction.event?.label?.fr || '';
    betDisplayEn = horse ? `${horse} (${num})` : prediction.event?.label?.en || prediction.event?.label?.fr || '';
  } else {
    const home = prediction.matchData?.teams?.home?.name;
    const away = prediction.matchData?.teams?.away?.name;
    matchDisplay = home && away ? `${home} vs ${away}` : 'Match';
    betDisplayFr = prediction.event?.label?.fr || prediction.event?.label?.en || 'Pari';
    betDisplayEn = prediction.event?.label?.en || prediction.event?.label?.fr || 'Bet';
  }

  const odds = prediction.odds || 1;

  return {
    headings: {
      en: `${sportIcon} Winning Prediction - ${sportName}!`,
      fr: `${sportIcon} Prono Gagné - ${sportName} !`,
    },
    contents: {
      en: `${matchDisplay}\n✅ ${betDisplayEn} @${odds} WON!\n👉 View details!`,
      fr: `${matchDisplay}\n✅ ${betDisplayFr} @${odds} GAGNÉ !\n👉 Voir les détails !`,
    },
    data: {
      type: 'prediction_success',
      prediction_id: String(prediction._id),
      ticket_id: prediction.ticket ? String(prediction.ticket) : null,
      sport: sportName,
      match: matchDisplay,
      bet: betDisplayFr,
      odds,
      action: 'view_prediction_details',
    },
    options: {
      android_accent_color: '4CAF50',
      small_icon: 'ic_notification',
      large_icon: 'ic_launcher',
      priority: 8,
    },
  };
}

/* ─────────────────────────────────────────────────────────────────
 * API publique
 * ───────────────────────────────────────────────────────────────── */

/**
 * Pour un ticket :
 *  1. Corrige toutes ses prédictions pending (via Corrector + données API)
 *  2. Recalcule le ticket.result
 *  3. Si result === 'won' → broadcast notif célébration
 *  4. Sinon → renvoie le statut sans notifier (sécurité)
 *
 * @param {String} ticketId
 * @param {String} appId
 * @returns {Object} Résultat consolidé
 */
async function correctAndNotifyTicket(ticketId, appId) {
  const ticket = await Ticket.findById(ticketId).populate('category').lean();
  if (!ticket) {
    throw new AppError('Ticket introuvable', 404);
  }
  if (ticket.appId !== appId) {
    throw new AppError(`Ticket appartient à ${ticket.appId}, pas à ${appId}`, 403);
  }

  // Corriger les prédictions pending (les déjà corrigées restent inchangées)
  const predictions = await Prediction.find({ ticket: ticketId });
  if (predictions.length === 0) {
    throw new AppError('Aucune prédiction sur ce ticket', 400);
  }

  const correctionStats = { total: predictions.length, corrected: 0, alreadyDone: 0, skipped: 0 };
  const skippedReasons = [];

  for (const pred of predictions) {
    if (pred.status !== 'pending') {
      correctionStats.alreadyDone++;
      continue;
    }
    try {
      const r = await correctOnePrediction(pred);
      if (r.status === 'corrected') correctionStats.corrected++;
      else {
        correctionStats.skipped++;
        skippedReasons.push(r.reason);
      }
    } catch (err) {
      correctionStats.skipped++;
      skippedReasons.push(err.message);
      logger.error(`[correctAndNotifyTicket] Erreur prédiction ${pred._id}: ${err.message}`);
    }
  }

  // Recalculer le ticket.result via le service existant
  await correctTickets({ ticketIds: [ticketId] });

  // Re-fetch pour avoir result à jour + predictions populées
  const updatedTicket = await Ticket.findById(ticketId).populate('category').lean();
  const updatedPredictions = await Prediction.find({ ticket: ticketId }).lean();

  const result = updatedTicket.result || 'pending';

  // Décision : on n'envoie la notif que si le ticket est réellement gagné
  if (result !== 'won') {
    return {
      success: false,
      ticketResult: result,
      correction: correctionStats,
      skippedReasons: skippedReasons.slice(0, 5),
      message: result === 'lost'
        ? 'Ticket perdu — notification non envoyée (sécurité)'
        : result === 'pending'
          ? 'Certains matchs ne sont pas terminés — notification non envoyée'
          : `Ticket en statut ${result} — notification non envoyée`,
    };
  }

  // Ticket gagné → on notifie
  const payload = buildTicketSuccessNotification(updatedTicket, updatedPredictions);
  const notif = await notificationService.sendToAll(appId, payload);

  logger.info(`[correctAndNotifyTicket] Ticket ${ticketId} (${appId}) corrigé+notifié`);

  return {
    success: true,
    ticketResult: 'won',
    correction: correctionStats,
    notification: { id: notif.id, recipients: notif.recipients },
    message: 'Ticket gagné — notification envoyée',
  };
}

/**
 * Pour une prédiction unique :
 *  1. Corrige la prédiction (via Corrector + données API)
 *  2. Met à jour aussi le ticket parent (en cascade)
 *  3. Si pred.status === 'won' → broadcast notif
 *  4. Sinon → renvoie le statut sans notifier
 */
async function correctAndNotifyPrediction(predictionId, appId) {
  const prediction = await Prediction.findById(predictionId);
  if (!prediction) {
    throw new AppError('Prédiction introuvable', 404);
  }
  if (prediction.appId !== appId) {
    throw new AppError(`Prédiction appartient à ${prediction.appId}, pas à ${appId}`, 403);
  }

  let correctionResult;
  if (prediction.status === 'pending') {
    correctionResult = await correctOnePrediction(prediction);
  } else {
    correctionResult = { status: 'alreadyDone', currentStatus: prediction.status };
  }

  // Mettre à jour aussi le ticket parent
  if (prediction.ticket) {
    await correctTickets({ ticketIds: [prediction.ticket] });
  }

  // Re-fetch pour avoir status à jour
  const updated = await Prediction.findById(predictionId).lean();

  if (updated.status !== 'won') {
    return {
      success: false,
      predictionStatus: updated.status,
      correction: correctionResult,
      message: updated.status === 'lost'
        ? 'Prédiction perdue — notification non envoyée (sécurité)'
        : updated.status === 'void'
          ? 'Prédiction annulée — notification non envoyée'
          : 'Match non terminé — notification non envoyée',
    };
  }

  // Prédiction gagnée → notifier
  const payload = buildPredictionSuccessNotification(updated);
  const notif = await notificationService.sendToAll(appId, payload);

  logger.info(`[correctAndNotifyPrediction] Prédiction ${predictionId} (${appId}) corrigée+notifiée`);

  return {
    success: true,
    predictionStatus: 'won',
    correction: correctionResult,
    notification: { id: notif.id, recipients: notif.recipients },
    message: 'Prédiction gagnée — notification envoyée',
  };
}

module.exports = {
  correctAndNotifyTicket,
  correctAndNotifyPrediction,
};
