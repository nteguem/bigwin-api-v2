/**
 * @fileoverview Point d'entrée de l'application
 */
const dotenv = require('dotenv');

// Charger .env AVANT tout require qui en dépend (logger lit LOG_LEVEL).
dotenv.config();

const app = require('./src/app');
const logger = require('./src/core/logger');
const { connectDB } = require('./config/database');
const { initLogsConnection } = require('./src/core/logger/connection');

// Services CRON
const PredictionCorrectionService = require('./src/api/services/common/predictionCorrectionService');
const googlePlayJobs = require('./src/jobs/googlePlaySyncJob');
const retentionJobs = require('./src/jobs/retentionNotificationJob');
const oneSignalTagReconciliationJob = require('./src/jobs/oneSignalTagReconciliationJob');

const PORT = process.env.PORT || 4000;

// Instances des services
let correctionService = null;

/**
 * Démarre le serveur après initialisation
 */
const startServer = async () => {
  try {
    // Connexion à la base de données principale
    await connectDB();

    // Connexion à la DB logs (séparée). Après la principale pour que le
    // fallback fonctionne si MONGO_LOGS_URI est absent.
    await initLogsConnection();

    // Service unifié de correction des prédictions (18h, 21h, 00h UTC)
    correctionService = new PredictionCorrectionService();
    await correctionService.start();

    await googlePlayJobs.start();
    await retentionJobs.start();
    await oneSignalTagReconciliationJob.start();

    // Démarrer le serveur HTTP
    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Server started and listening on port ${PORT}`);
    });
  } catch (error) {
    logger.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
};

/**
 * Gestion des signaux d'arrêt
 */
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');

  if (correctionService) {
    await correctionService.stop();
  }

  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');

  if (correctionService) {
    await correctionService.stop();
  }

  process.exit(0);
});

// Démarrer le serveur
startServer();
