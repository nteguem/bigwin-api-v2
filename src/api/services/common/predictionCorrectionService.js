/**
 * @fileoverview Service unifié de correction des prédictions
 *
 * 1 cron par jour à 23h57 UTC (tous les matchs européens + la plupart des sud-américains sont terminés)
 *   1. Trouver les prédictions pending (jusqu'à 7 jours en arrière)
 *   2. Grouper par sport + date
 *   3. Pour chaque sport/date : refresh API → cache fichier → correction
 *   4. Corriger toutes les prédictions avec les données du cache
 *   5. Marquer void les matchs commencés il y a +5h sans résultat
 *
 * Contrainte API : 100 requêtes/jour max → on privilégie le cache local
 */

const cron = require('node-cron');
const logger = require('../../../utils/logger');
const Corrector = require('../../../core/events/Corrector');
const { fetchAndStoreData } = require('../../../core/sports/providers/initService');
const Prediction = require('../../models/common/Prediction');

// Nombre de jours en arrière pour chercher les prédictions pending
const LOOKBACK_DAYS = 7;

class PredictionCorrectionService {
  constructor() {
    this.corrector = new Corrector();
    this.cronJobs = [];
    this.isRunning = false;

    // Cron unique à 23h57 UTC
    this.cronExpression = '57 23 * * *';

    // Statistiques
    this.stats = {
      totalProcessed: 0,
      totalCorrected: 0,
      totalVoid: 0,
      totalErrors: 0,
      lastRun: null,
      apiCallsMade: 0
    };
  }

  /**
   * Démarre le service
   */
  async start() {
    try {
      logger.info('Starting Prediction Correction Service...');

      const job = cron.schedule(this.cronExpression, async () => {
        await this.runCorrectionWindow();
      }, {
        scheduled: false,
        timezone: 'UTC'
      });

      this.cronJobs.push({ job, expression: this.cronExpression });
      job.start();

      this.isRunning = true;
      logger.info(`Prediction Correction Service started — cron: ${this.cronExpression} UTC (23:57)`);

    } catch (error) {
      logger.error(`Failed to start Prediction Correction Service: ${error.message}`);
      throw error;
    }
  }

  /**
   * Exécute une fenêtre de correction
   */
  async runCorrectionWindow() {
    const startTime = Date.now();
    logger.info(`=== Correction cron 23:57 UTC started ===`);

    try {
      // 1. Trouver toutes les prédictions pending
      const pendingPredictions = await this.getPendingPredictions();

      if (pendingPredictions.length === 0) {
        logger.info('No pending predictions to process');
        return;
      }

      logger.info(`Found ${pendingPredictions.length} pending predictions`);

      // 2. Grouper par sport + date
      const groups = this.groupBySportAndDate(pendingPredictions);
      logger.info(`Grouped into ${Object.keys(groups).length} sport/date combinations`);

      // 3. Pour chaque groupe : refresh API + correction
      let totalCorrected = 0;
      let totalVoid = 0;
      let totalErrors = 0;
      let apiCalls = 0;

      for (const [key, group] of Object.entries(groups)) {
        const { sport, date, predictions } = group;

        try {
          // D'abord charger le cache (0 requête API si fichier existe)
          logger.info(`Fetching ${sport} data for ${date} (${predictions.length} predictions)...`);
          let freshData = await fetchAndStoreData(sport, date, false);

          // Vérifier si les matchs de NOS prédictions sont terminés dans le cache
          const predictionMatchIds = new Set(predictions.map(p => String(p.matchData?.id)));
          const needsRefresh = freshData?.matches?.some(m =>
            predictionMatchIds.has(String(m.id)) &&
            (m.status === 'NOT_STARTED' || m.status === 'NS' || m.status === 'LIVE')
          );

          if (needsRefresh) {
            logger.info(`Cache has unfinished matches for our predictions in ${sport}/${date}, refreshing from API...`);
            freshData = await fetchAndStoreData(sport, date, true);
            apiCalls++;
          }

          if (!freshData || !freshData.matches) {
            logger.error(`No data returned for ${sport} on ${date}`);
            totalErrors += predictions.length;
            continue;
          }

          logger.info(`Got ${freshData.matches.length} matches for ${sport} on ${date}`);

          // Corriger chaque prédiction du groupe
          for (const prediction of predictions) {
            try {
              const result = await this.correctPrediction(prediction, freshData, true);

              if (result === 'corrected') totalCorrected++;
              else if (result === 'void') totalVoid++;
              // result === 'skipped' → on ne fait rien, retry à la prochaine fenêtre

            } catch (error) {
              logger.error(`Error correcting prediction ${prediction._id}: ${error.message}`);
              totalErrors++;
            }
          }

        } catch (error) {
          logger.error(`Error refreshing ${sport} on ${date}: ${error.message}`);
          totalErrors += predictions.length;
        }
      }

      // 4. Mise à jour des stats
      this.stats.totalProcessed += pendingPredictions.length;
      this.stats.totalCorrected += totalCorrected;
      this.stats.totalVoid += totalVoid;
      this.stats.totalErrors += totalErrors;
      this.stats.apiCallsMade += apiCalls;
      this.stats.lastRun = new Date();

      const duration = Date.now() - startTime;
      logger.info(`=== Correction completed in ${duration}ms — corrected: ${totalCorrected}, void: ${totalVoid}, errors: ${totalErrors}, API calls: ${apiCalls} ===`);

    } catch (error) {
      logger.error(`Critical error in correction cron: ${error.message}`);
    }
  }

  /**
   * Récupère les prédictions pending des N derniers jours
   * Note: matchData.date est stocké comme string ISO (Mixed schema)
   * donc on utilise $regex pour matcher par préfixe de date
   */
  async getPendingPredictions() {
    const now = new Date();
    const dates = [];
    for (let i = 0; i <= LOOKBACK_DAYS; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
      dates.push(d.toISOString().split('T')[0]);
    }

    return Prediction.find({
      status: 'pending',
      'matchData.date': { $regex: `^(${dates.join('|')})` }
    }).lean();
  }

  /**
   * Récupère les prédictions pending pour une date spécifique
   * matchData.date est une string ISO comme "2026-03-23T17:00:00+00:00"
   */
  async getPendingPredictionsByDate(date) {
    // date = "2026-03-23", matchData.date = "2026-03-23T17:00:00+00:00"
    return Prediction.find({
      status: 'pending',
      'matchData.date': { $regex: `^${date}` }
    }).lean();
  }

  /**
   * Groupe les prédictions par sport + date
   */
  groupBySportAndDate(predictions) {
    const groups = {};

    for (const prediction of predictions) {
      const sport = prediction.sport?.id || 'football';
      const matchDate = prediction.matchData?.date;
      if (!matchDate) continue;

      const dateStr = new Date(matchDate).toISOString().split('T')[0];
      const key = `${sport}_${dateStr}`;

      if (!groups[key]) {
        groups[key] = { sport, date: dateStr, predictions: [] };
      }
      groups[key].predictions.push(prediction);
    }

    return groups;
  }

  /**
   * Corrige une prédiction individuelle
   * @param {Object} prediction
   * @param {Object} freshData - Données du cache/API
   * @param {boolean} isLastWindow - Si c'est la fenêtre de minuit (void les non-terminés)
   * @param {string} source - 'auto-cron' ou 'manual'
   * @returns {'corrected'|'void'|'skipped'}
   */
  async correctPrediction(prediction, freshData, isLastWindow, source = 'auto-cron') {
    const matchId = prediction.matchData?.id;
    if (!matchId) {
      logger.warn(`Prediction ${prediction._id} has no matchData.id`);
      return 'skipped';
    }

    // Incrémenter le compteur de tentatives
    await Prediction.findByIdAndUpdate(prediction._id, {
      $inc: { correctionAttempts: 1 }
    });

    // Chercher le match dans les données fraîches
    const currentMatch = freshData.matches.find(m => String(m.id) === String(matchId));

    if (!currentMatch) {
      logger.warn(`Match ${matchId} not found in fresh data`);
      if (isLastWindow) {
        await this.markVoid(prediction._id, 'Match introuvable dans les données API', source);
        return 'void';
      }
      return 'skipped';
    }

    // Vérifier si le match est terminé
    if (currentMatch.status !== 'FINISHED' && currentMatch.status !== 'FT') {
      // Match pas encore terminé
      if (isLastWindow) {
        const matchStart = new Date(prediction.matchData.date);
        const hoursElapsed = (Date.now() - matchStart.getTime()) / (1000 * 60 * 60);

        if (hoursElapsed > 5) {
          await this.markVoid(prediction._id, `Match non terminé après ${Math.round(hoursElapsed)}h (statut: ${currentMatch.status})`, source);
          return 'void';
        }
      }

      logger.debug(`Match ${matchId} not finished yet (${currentMatch.status}), will retry next window`);
      return 'skipped';
    }

    // Match terminé → évaluer la prédiction
    const predictionData = {
      id: prediction._id.toString(),
      event: prediction.event,
      matchData: prediction.matchData,
      sport: prediction.sport,
      status: prediction.status
    };

    const correctionResult = this.corrector.correctPrediction(
      predictionData,
      currentMatch,
      prediction.sport?.id || 'football'
    );

    if (!correctionResult.success || !correctionResult.correction.canCorrect) {
      logger.warn(`Cannot correct prediction ${prediction._id}: ${correctionResult.correction.reason}`);
      if (isLastWindow) {
        await this.markVoid(prediction._id, correctionResult.correction.reason, source);
        return 'void';
      }
      return 'skipped';
    }

    // Mettre à jour en base : statut + score + metadata
    const newStatus = correctionResult.correction.result ? 'won' : 'lost';

    await Prediction.findByIdAndUpdate(prediction._id, {
      $set: {
        status: newStatus,
        'matchData.status': currentMatch.status,
        'matchData.score': currentMatch.score,
        'matchData.teams': currentMatch.teams,
        'matchData.league': currentMatch.league,
        'correctionMetadata.correctedAt': new Date(),
        'correctionMetadata.correctionSource': source,
        'correctionMetadata.confidence': correctionResult.correction.confidence,
        'correctionMetadata.expression': correctionResult.correction.expression,
        'correctionMetadata.reason': correctionResult.correction.reason
      }
    });

    logger.info(`Prediction ${prediction._id} → ${newStatus} (${correctionResult.correction.reason})`);
    return 'corrected';
  }

  /**
   * Marque une prédiction comme void
   */
  async markVoid(predictionId, reason, source = 'auto-cron') {
    await Prediction.findByIdAndUpdate(predictionId, {
      $set: {
        status: 'void',
        'correctionMetadata.correctedAt': new Date(),
        'correctionMetadata.correctionSource': source,
        'correctionMetadata.confidence': 'low',
        'correctionMetadata.reason': reason
      }
    });

    logger.info(`Prediction ${predictionId} → void (${reason})`);
  }

  /**
   * Corrige les prédictions pour une date spécifique (endpoint manuel)
   * Même logique que le cron mais ciblée sur une date
   * @param {string} date - Date au format YYYY-MM-DD
   * @param {boolean} forceApi - Forcer le refresh depuis l'API (sinon cache d'abord)
   * @returns {Object} Résultat détaillé de la correction
   */
  async correctByDate(date, forceApi = false) {
    const startTime = Date.now();
    logger.info(`=== Manual correction for date ${date} started ===`);

    const result = {
      date,
      predictions: { total: 0, corrected: 0, void: 0, skipped: 0, errors: 0 },
      apiCalls: 0,
      details: [],
      duration: 0
    };

    try {
      // 1. Trouver les prédictions pending pour cette date
      const pendingPredictions = await this.getPendingPredictionsByDate(date);
      result.predictions.total = pendingPredictions.length;

      if (pendingPredictions.length === 0) {
        logger.info(`No pending predictions for ${date}`);
        result.duration = Date.now() - startTime;
        return result;
      }

      logger.info(`Found ${pendingPredictions.length} pending predictions for ${date}`);

      // 2. Grouper par sport
      const groups = this.groupBySportAndDate(pendingPredictions);

      for (const [key, group] of Object.entries(groups)) {
        const { sport, date: groupDate, predictions } = group;

        try {
          // Charger les données : cache d'abord, API si forceApi ou si cache a des matchs non terminés
          let freshData = await fetchAndStoreData(sport, groupDate, forceApi);
          result.apiCalls++;

          if (!forceApi) {
            const hasUnfinished = freshData?.matches?.some(m =>
              m.status === 'NOT_STARTED' || m.status === 'NS' || m.status === 'LIVE'
            );
            if (hasUnfinished) {
              logger.info(`Cache has unfinished matches for ${sport}/${groupDate}, refreshing from API...`);
              freshData = await fetchAndStoreData(sport, groupDate, true);
              result.apiCalls++;
            }
          }

          if (!freshData || !freshData.matches) {
            logger.error(`No data returned for ${sport} on ${groupDate}`);
            result.predictions.errors += predictions.length;
            predictions.forEach(p => result.details.push({
              predictionId: p._id,
              matchId: p.matchData?.id,
              status: 'error',
              reason: 'Pas de données disponibles'
            }));
            continue;
          }

          logger.info(`Got ${freshData.matches.length} matches for ${sport} on ${groupDate}`);

          // Corriger chaque prédiction
          for (const prediction of predictions) {
            try {
              const correctionResult = await this.correctPrediction(prediction, freshData, false, 'manual');

              if (correctionResult === 'corrected') {
                result.predictions.corrected++;
              } else if (correctionResult === 'void') {
                result.predictions.void++;
              } else {
                result.predictions.skipped++;
              }

              result.details.push({
                predictionId: prediction._id,
                matchId: prediction.matchData?.id,
                teams: `${prediction.matchData?.teams?.home?.name} vs ${prediction.matchData?.teams?.away?.name}`,
                event: prediction.event?.label?.current || prediction.event?.id,
                status: correctionResult
              });

            } catch (error) {
              logger.error(`Error correcting prediction ${prediction._id}: ${error.message}`);
              result.predictions.errors++;
              result.details.push({
                predictionId: prediction._id,
                matchId: prediction.matchData?.id,
                status: 'error',
                reason: error.message
              });
            }
          }

        } catch (error) {
          logger.error(`Error fetching ${sport} on ${groupDate}: ${error.message}`);
          result.predictions.errors += predictions.length;
          predictions.forEach(p => result.details.push({
            predictionId: p._id,
            matchId: p.matchData?.id,
            status: 'error',
            reason: error.message
          }));
        }
      }

      result.duration = Date.now() - startTime;
      logger.info(`=== Manual correction for ${date} completed in ${result.duration}ms — corrected: ${result.predictions.corrected}, skipped: ${result.predictions.skipped}, errors: ${result.predictions.errors} ===`);

      return result;

    } catch (error) {
      logger.error(`Critical error in manual correction for ${date}: ${error.message}`);
      result.predictions.errors = result.predictions.total;
      result.duration = Date.now() - startTime;
      result.error = error.message;
      return result;
    }
  }

  /**
   * Arrête le service
   */
  async stop() {
    logger.info('Stopping Prediction Correction Service...');

    this.cronJobs.forEach(({ job }) => {
      job.stop();
    });

    this.cronJobs = [];
    this.isRunning = false;

    logger.info('Prediction Correction Service stopped');
  }

  /**
   * Statut du service
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      cron: '23:57 UTC',
      stats: this.stats,
      nextRun: this.getNextRun()
    };
  }

  /**
   * Prochaine exécution
   */
  getNextRun() {
    const now = new Date();
    const runs = [];

    for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
        const run = new Date(Date.UTC(
          now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset,
          23, 57, 0
        ));
        if (run > now) runs.push(run);
    }

    return runs.length > 0 ? runs[0] : null;
  }

  /**
   * Force une exécution manuelle (pour les tests)
   */
  async runManualCycle() {
    logger.info('Running manual correction cycle...');
    await this.runCorrectionWindow();
  }
}

module.exports = PredictionCorrectionService;
