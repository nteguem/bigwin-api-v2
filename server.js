/**
 * @fileoverview Point d'entrée de l'application
 */
const dotenv = require('dotenv');
const app = require('./src/app');
const logger = require('./src/utils/logger');
const { connectDB } = require('./config/database');
const PredictionCronService = require('./src/api/services/common/predictionCorrectionService');

// Chargement des variables d'environnement
dotenv.config();

const PORT = process.env.PORT || 4000;

// NOUVEAU : Instance du service de correction
let cronService = null;

/**
 * Démarre le serveur après initialisation
 */
const startServer = async () => {
  try {
    // Connexion à la base de données
    await connectDB();
    
      logger.info('Starting Prediction CRON Service...');
      cronService = new PredictionCronService();
      await cronService.start();
    
    // Démarrer le serveur HTTP
    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Server started and listening on port ${PORT}`);
    });
  } catch (error) {
    logger.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
};

// Gestion des signaux d'arrêt
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  // NOUVEAU : Arrêter le service CRON
  if (cronService) {
    await cronService.stop();
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  if (cronService) {
    await cronService.stop();
  }
  process.exit(0);
});

// Démarrer le serveur
startServer();