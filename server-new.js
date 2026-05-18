/**
 * @fileoverview Point d'entrée de l'application
 */
const dotenv = require('dotenv');

// Force Node à résoudre l'IPv4 en premier pour toute requête HTTP sortante.
// Sans ça, sur les VPS dual-stack (Hostinger, OVH…), Node 17+ part en IPv6
// par défaut (verbatim DNS order), ce qui fait que les PSP qui whitelistent
// notre IPv4 nous voient arriver depuis une IPv6 → 2011 NOT_ALLOWED.
require('dns').setDefaultResultOrder('ipv4first');

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

    // Jobs CRON — désactivables (effets de bord prod via OneSignal / Google
    // Play). En dev/staging sur une copie de la prod, mettre DISABLE_CRON_JOBS=true.
    if (process.env.DISABLE_CRON_JOBS === 'true') {
      logger.warn('Jobs CRON désactivés (DISABLE_CRON_JOBS=true).');
    } else {
      // Service unifié de correction des prédictions (18h, 21h, 00h UTC)
      correctionService = new PredictionCorrectionService();
      await correctionService.start();

      await googlePlayJobs.start();
      await retentionJobs.start();
      await oneSignalTagReconciliationJob.start();
    }

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
