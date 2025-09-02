/**
 * @fileoverview Service de correction automatique des prédictions via CRON à heures fixes
 */

const cron = require('node-cron');
const mongoose = require('mongoose');
const logger = require('../../../utils/logger');
const Corrector = require('../../../core/events/Corrector');
const { findMatch } = require('../../../core/sports/providers/initService');

class PredictionCronService {
  constructor() {
    this.corrector = new Corrector();
    this.cronJobs = [];
    this.isRunning = false;
    this.retryAttempts = 3;
    
    // Heures de correction fixes (24h format)
    this.correctionHours = [0, 3, 8, 11, 13, 15, 16, 18, 19, 20, 22];
    
    // Statistiques
    this.stats = {
      totalProcessed: 0,
      totalCorrected: 0,
      totalErrors: 0,
      lastRun: null
    };
  }

  /**
   * Démarre le service CRON
   */
  async start() {
    try {
      logger.info('Starting Prediction CRON Service...');
      
      // Vérifier la connexion MongoDB
      if (mongoose.connection.readyState !== 1) {
        throw new Error('MongoDB not connected');
      }

      // Créer les tâches CRON pour chaque heure
      this.correctionHours.forEach(hour => {
        const cronExpression = `0 ${hour} * * *`; // À l'heure pile
        
        const job = cron.schedule(cronExpression, async () => {
          await this.runCorrectionCycle(hour);
        }, {
          scheduled: false, // Ne pas démarrer automatiquement
          timezone: 'UTC' // Utiliser UTC pour éviter les problèmes de timezone
        });
        
        this.cronJobs.push({ hour, job, expression: cronExpression });
      });

      // Démarrer tous les jobs
      this.cronJobs.forEach(({ hour, job }) => {
        job.start();
        logger.info(`CRON job scheduled for ${hour}:00 UTC`);
      });

      this.isRunning = true;
      logger.info(`✅ Prediction CRON Service started with ${this.correctionHours.length} scheduled times`);
      logger.info(`Correction hours (UTC): ${this.correctionHours.join('h, ')}h`);
      
    } catch (error) {
      logger.error(`Failed to start Prediction CRON Service: ${error.message}`);
      throw error;
    }
  }

  /**
   * Exécute un cycle de correction
   */
  async runCorrectionCycle(triggerHour) {
    const startTime = Date.now();
    logger.info(`🕐 Starting correction cycle at ${triggerHour}:00 UTC`);

    try {
      const Prediction = mongoose.model('Prediction');
      
      // Trouver toutes les prédictions pending où le match est passé
      const cutoffTime = new Date();
      
      const predictionsToProcess = await Prediction.find({
        status: 'pending',
        'matchData.date': { $lt: cutoffTime }, // Match déjà passé
        $or: [
          { 'correctionMetadata.attempts': { $exists: false } },
          { 'correctionMetadata.attempts': { $lt: this.retryAttempts } }
        ]
      }).limit(200); // Limiter pour éviter la surcharge

      if (predictionsToProcess.length === 0) {
        logger.info(`No predictions to process at ${triggerHour}:00`);
        return;
      }

      logger.info(`Found ${predictionsToProcess.length} predictions to process`);

      let processed = 0;
      let corrected = 0;
      let errors = 0;

      // Traiter chaque prédiction
      for (const prediction of predictionsToProcess) {
        try {
          await this.processPrediction(prediction);
          processed++;
          corrected++;
        } catch (error) {
          logger.error(`Error processing prediction ${prediction._id}: ${error.message}`);
          await this.handlePredictionError(prediction, error);
          processed++;
          errors++;
        }
        
        // Petite pause pour éviter la surcharge
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Mise à jour des statistiques
      this.stats.totalProcessed += processed;
      this.stats.totalCorrected += corrected;
      this.stats.totalErrors += errors;
      this.stats.lastRun = new Date();

      const duration = Date.now() - startTime;
      logger.info(`✅ Correction cycle completed in ${duration}ms: ${corrected} corrected, ${errors} errors`);
      
    } catch (error) {
      logger.error(`Error in correction cycle: ${error.message}`);
    }
  }

  /**
   * Traite une prédiction individuelle
   */
  async processPrediction(prediction) {
    const { matchData, sport } = prediction;
    
    logger.debug(`Processing prediction ${prediction._id} for match ${matchData.id}`);

    // 1. Récupérer les données actualisées du match
    const currentMatchData = await this.fetchMatchData(sport.id, matchData.id, matchData.date);
    
    if (!currentMatchData) {
      throw new Error(`Match data not found for ${matchData.id}`);
    }

    // 2. Vérifier si le match est terminé
    if (currentMatchData.status !== 'FINISHED' && currentMatchData.status !== 'FT') {
      logger.debug(`Match ${matchData.id} not finished yet (${currentMatchData.status})`);
      await this.incrementAttempts(prediction._id);
      return;
    }

    // 3. Utiliser le Corrector pour évaluer la prédiction
    const predictionData = {
      id: prediction._id.toString(),
      event: prediction.event,
      matchData: prediction.matchData,
      sport: prediction.sport,
      status: prediction.status
    };

    const correctionResult = this.corrector.correctPrediction(
      predictionData, 
      currentMatchData, 
      sport.id
    );

    if (!correctionResult.success || !correctionResult.correction.canCorrect) {
      throw new Error(`Correction failed: ${correctionResult.correction.reason}`);
    }

    // 4. Mettre à jour la prédiction en base
    const newStatus = correctionResult.correction.result ? 'won' : 'lost';
    await this.updatePredictionStatus(prediction._id, newStatus, correctionResult);
    
    logger.info(`Prediction ${prediction._id} corrected: ${newStatus} (${correctionResult.correction.reason})`);
  }

  /**
   * Récupère les données actualisées d'un match
   */
  async fetchMatchData(sport, matchId, originalDate) {
    try {
      // Convertir la date au format YYYY-MM-DD
      const dateStr = new Date(originalDate).toISOString().split('T')[0];
      
      // Utiliser findMatch du initService
      const matchData = await findMatch(sport, matchId, dateStr, true); // forceUpdate = true
      
      return matchData;
    } catch (error) {
      logger.error(`Error fetching match data ${sport}/${matchId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Met à jour le statut d'une prédiction en base
   */
  async updatePredictionStatus(predictionId, newStatus, correctionResult) {
    try {
      const Prediction = mongoose.model('Prediction');
      
      const updateData = {
        status: newStatus,
        'correctionMetadata.correctedAt': new Date(),
        'correctionMetadata.correctionSource': 'auto-cron',
        'correctionMetadata.confidence': correctionResult.correction.confidence,
        'correctionMetadata.expression': correctionResult.correction.expression,
        'correctionMetadata.reason': correctionResult.correction.reason
      };

      const result = await Prediction.findByIdAndUpdate(
        predictionId,
        { $set: updateData },
        { new: true }
      );

      if (!result) {
        throw new Error(`Prediction ${predictionId} not found for update`);
      }

      return result;
      
    } catch (error) {
      logger.error(`Error updating prediction ${predictionId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Incrémente le compteur de tentatives
   */
  async incrementAttempts(predictionId) {
    try {
      const Prediction = mongoose.model('Prediction');
      
      await Prediction.findByIdAndUpdate(predictionId, {
        $inc: { 'correctionMetadata.attempts': 1 },
        $set: { 'correctionMetadata.lastAttempt': new Date() }
      });
      
    } catch (error) {
      logger.error(`Error incrementing attempts for prediction ${predictionId}: ${error.message}`);
    }
  }

  /**
   * Gère les erreurs de prédiction
   */
  async handlePredictionError(prediction, error) {
    const attempts = prediction.correctionMetadata?.attempts || 0;
    
    if (attempts >= this.retryAttempts) {
      // Trop de tentatives, marquer comme void
      await this.updatePredictionStatus(prediction._id, 'void', {
        correction: {
          reason: `Max retry attempts reached: ${error.message}`,
          confidence: 'low'
        }
      });
      
      logger.warn(`Prediction ${prediction._id} marked as void after ${this.retryAttempts} failed attempts`);
    } else {
      // Incrémenter le compteur d'erreurs
      await this.incrementAttempts(prediction._id);
      
      // Enregistrer l'erreur
      try {
        const Prediction = mongoose.model('Prediction');
        await Prediction.findByIdAndUpdate(prediction._id, {
          $push: { 'correctionMetadata.errors': error.message },
          $set: { 'correctionMetadata.lastAttempt': new Date() }
        });
      } catch (updateError) {
        logger.error(`Error updating error log: ${updateError.message}`);
      }
    }
  }

  /**
   * Arrête le service CRON
   */
  async stop() {
    logger.info('Stopping Prediction CRON Service...');
    
    this.isRunning = false;
    
    // Arrêter tous les jobs CRON
    this.cronJobs.forEach(({ hour, job }) => {
      job.stop();
      logger.info(`CRON job stopped for ${hour}:00`);
    });
    
    this.cronJobs = [];
    
    logger.info('✅ Prediction CRON Service stopped');
  }

  /**
   * Statut du service
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      activeJobs: this.cronJobs.length,
      correctionHours: this.correctionHours,
      stats: this.stats,
      nextRuns: this.getNextRuns()
    };
  }

  /**
   * Calcule les prochaines exécutions
   */
  getNextRuns() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    
    const nextRuns = [];
    
    this.correctionHours.forEach(hour => {
      const todayRun = new Date(today.getTime() + hour * 60 * 60 * 1000);
      const tomorrowRun = new Date(tomorrow.getTime() + hour * 60 * 60 * 1000);
      
      if (todayRun > now) {
        nextRuns.push(todayRun);
      } else {
        nextRuns.push(tomorrowRun);
      }
    });
    
    return nextRuns.sort().slice(0, 3); // Retourner les 3 prochaines
  }

  /**
   * Force l'exécution manuelle d'un cycle de correction
   */
  async runManualCycle() {
    logger.info('Running manual correction cycle...');
    await this.runCorrectionCycle('manual');
  }

  /**
   * Corrige manuellement une prédiction spécifique
   */
  async manualCorrection(predictionId) {
    try {
      const prediction = await Prediction.findById(predictionId);
      
      if (!prediction) {
        throw new Error(`Prediction ${predictionId} not found`);
      }

      if (prediction.status !== 'pending') {
        throw new Error(`Prediction ${predictionId} is not pending (status: ${prediction.status})`);
      }

      await this.processPrediction(prediction);
      return { success: true, message: `Prediction ${predictionId} corrected manually` };
      
    } catch (error) {
      logger.error(`Manual correction failed for ${predictionId}: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}

module.exports = PredictionCronService;