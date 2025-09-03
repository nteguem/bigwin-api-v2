/**
 * @fileoverview Service de mise à jour des données sportives (fetch + storage)
 */

const cron = require('node-cron');
const logger = require('../../../utils/logger');
const { fetchAndStoreData } = require('../../../core/sports/providers/initService');

class DataRefreshService {
  constructor() {
    this.cronJob = null;
    this.isRunning = false;
  }

  /**
   * Démarre le service de rafraîchissement
   */
  async start() {
    try {
      logger.info('Starting Data Refresh CRON Service...');

      // Toutes les 2h à la minute 5
      this.cronJob = cron.schedule('5 */2 * * *', async () => {
        await this.refreshFootballData();
      }, {
        scheduled: false,
        timezone: 'UTC'
      });

      this.cronJob.start();
      this.isRunning = true;
      logger.info('Data Refresh CRON Service started (every 2h at minute 5 UTC)');
    } catch (error) {
      logger.error(`Failed to start Data Refresh CRON Service: ${error.message}`);
      throw error;
    }
  }

  /**
   * Récupère et stocke les données de football (force refresh)
   */
  async refreshFootballData() {
    try {
      const today = new Date().toISOString().split('T')[0];
      logger.info(`Refreshing football data for ${today}...`);
      
      await fetchAndStoreData('football', today, true); // forceRefresh = true

      logger.info('Football data refreshed successfully ✅');
    } catch (error) {
      logger.error(`Error refreshing football data: ${error.message}`);
    }
  }

  /**
   * Stop le service
   */
  async stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      logger.info('Data Refresh CRON Service stopped');
    }
    this.isRunning = false;
  }
}

module.exports = DataRefreshService;
