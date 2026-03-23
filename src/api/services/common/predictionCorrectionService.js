/**
 * @fileoverview Service unifié de correction des prédictions
 *
 * 3 fenêtres par jour : 18h, 21h, 00h GMT
 * À chaque fenêtre :
 *   1. Trouver les prédictions pending du jour
 *   2. Grouper par sport
 *   3. Pour chaque sport : 1 appel API (refresh du fichier cache)
 *   4. Corriger toutes les prédictions avec les données fraîches
 *   5. À 00h : marquer void les matchs commencés il y a +5h sans résultat
 */

const cron = require('node-cron');
const logger = require('../../../utils/logger');
const Corrector = require('../../../core/events/Corrector');
const { fetchAndStoreData } = require('../../../core/sports/providers/initService');
const Prediction = require('../../models/common/Prediction');

class PredictionCorrectionService {
  constructor() {
    this.corrector = new Corrector();
    this.cronJobs = [];
    this.isRunning = false;

    // 3 fenêtres de correction (heures UTC)
    this.correctionWindows = [18, 21, 0];

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

      this.correctionWindows.forEach(hour => {
        const cronExpression = `0 ${hour} * * *`;

        const job = cron.schedule(cronExpression, async () => {
          await this.runCorrectionWindow(hour);
        }, {
          scheduled: false,
          timezone: 'UTC'
        });

        this.cronJobs.push({ hour, job, expression: cronExpression });
      });

      // Démarrer tous les jobs
      this.cronJobs.forEach(({ hour, job }) => {
        job.start();
        logger.info(`Correction window scheduled at ${hour}:00 UTC`);
      });

      this.isRunning = true;
      logger.info(`Prediction Correction Service started — windows: ${this.correctionWindows.map(h => h + 'h').join(', ')} UTC`);

    } catch (error) {
      logger.error(`Failed to start Prediction Correction Service: ${error.message}`);
      throw error;
    }
  }

  /**
   * Exécute une fenêtre de correction
   */
  async runCorrectionWindow(windowHour) {
    const startTime = Date.now();
    const isLastWindow = windowHour === 0;
    logger.info(`=== Correction window ${windowHour}h UTC started ===`);

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
          // Un seul appel API par sport/date
          logger.info(`Refreshing ${sport} data for ${date} (${predictions.length} predictions)...`);
          const freshData = await fetchAndStoreData(sport, date, true);
          apiCalls++;

          if (!freshData || !freshData.matches) {
            logger.error(`No data returned for ${sport} on ${date}`);
            totalErrors += predictions.length;
            continue;
          }

          logger.info(`Got ${freshData.matches.length} matches for ${sport} on ${date}`);

          // Corriger chaque prédiction du groupe
          for (const prediction of predictions) {
            try {
              const result = await this.correctPrediction(prediction, freshData, isLastWindow);

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
      logger.info(`=== Window ${windowHour}h completed in ${duration}ms — corrected: ${totalCorrected}, void: ${totalVoid}, errors: ${totalErrors}, API calls: ${apiCalls} ===`);

    } catch (error) {
      logger.error(`Critical error in correction window ${windowHour}h: ${error.message}`);
    }
  }

  /**
   * Récupère les prédictions pending du jour
   */
  async getPendingPredictions() {
    const now = new Date();
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    return Prediction.find({
      status: 'pending',
      'matchData.date': {
        $gte: startOfDay,
        $lt: endOfDay
      }
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
   * @returns {'corrected'|'void'|'skipped'}
   */
  async correctPrediction(prediction, freshData, isLastWindow) {
    const matchId = prediction.matchData?.id;
    if (!matchId) {
      logger.warn(`Prediction ${prediction._id} has no matchData.id`);
      return 'skipped';
    }

    // Chercher le match dans les données fraîches
    const currentMatch = freshData.matches.find(m => m.id === matchId);

    if (!currentMatch) {
      logger.warn(`Match ${matchId} not found in fresh data`);
      if (isLastWindow) {
        await this.markVoid(prediction._id, 'Match introuvable dans les données API');
        return 'void';
      }
      return 'skipped';
    }

    // Vérifier si le match est terminé
    if (currentMatch.status !== 'FINISHED' && currentMatch.status !== 'FT') {
      // Match pas encore terminé
      if (isLastWindow) {
        // Fenêtre de minuit : vérifier le délai depuis le début du match
        const matchStart = new Date(prediction.matchData.date);
        const hoursElapsed = (Date.now() - matchStart.getTime()) / (1000 * 60 * 60);

        if (hoursElapsed > 5) {
          await this.markVoid(prediction._id, `Match non terminé après ${Math.round(hoursElapsed)}h (statut: ${currentMatch.status})`);
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
        await this.markVoid(prediction._id, correctionResult.correction.reason);
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
        'correctionMetadata.correctionSource': 'auto-cron',
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
  async markVoid(predictionId, reason) {
    await Prediction.findByIdAndUpdate(predictionId, {
      $set: {
        status: 'void',
        'correctionMetadata.correctedAt': new Date(),
        'correctionMetadata.correctionSource': 'auto-cron',
        'correctionMetadata.confidence': 'low',
        'correctionMetadata.reason': reason
      }
    });

    logger.info(`Prediction ${predictionId} → void (${reason})`);
  }

  /**
   * Arrête le service
   */
  async stop() {
    logger.info('Stopping Prediction Correction Service...');

    this.cronJobs.forEach(({ hour, job }) => {
      job.stop();
      logger.info(`Window ${hour}h stopped`);
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
      windows: this.correctionWindows.map(h => `${h}:00 UTC`),
      stats: this.stats,
      nextRuns: this.getNextRuns()
    };
  }

  /**
   * Prochaines exécutions
   */
  getNextRuns() {
    const now = new Date();
    const runs = [];

    for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
      for (const hour of this.correctionWindows) {
        const run = new Date(Date.UTC(
          now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset,
          hour, 0, 0
        ));
        if (run > now) runs.push(run);
      }
    }

    return runs.sort((a, b) => a - b).slice(0, 3);
  }

  /**
   * Force une exécution manuelle (pour les tests)
   */
  async runManualCycle(windowHour = 0) {
    logger.info(`Running manual correction cycle (simulating window ${windowHour}h)...`);
    await this.runCorrectionWindow(windowHour);
  }
}

module.exports = PredictionCorrectionService;
