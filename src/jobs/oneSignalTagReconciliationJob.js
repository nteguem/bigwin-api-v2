// src/jobs/oneSignalTagReconciliationJob.js
//
// Cron quotidien qui aligne les tags OneSignal `is_vip` avec l'état réel des
// abonnements en BD. Couvre :
//   • VIPs actifs    → push is_vip='true' (idempotent, corrige les réinstalls)
//   • Récemment expirés (7 derniers jours) → push is_vip='false' (corrige drifts)
//
// Tourne à 00h05 UTC chaque jour. Le pool est petit (quelques milliers de VIPs
// + quelques centaines d'expirations) donc ~1-2 min max.

const cron = require('node-cron');
const logger = require('../utils/logger');
const { reconcileTags } = require('../api/services/common/oneSignalTagService');

class OneSignalTagReconciliationJob {
  constructor() {
    this.cronJob = null;
    this.isRunning = false;
    // 00h05 UTC daily — décalé de 5 min après le tour de minuit pour laisser
    // le temps aux expirations de se propager dans Mongo
    this.cronExpression = '5 0 * * *';
    this.stats = {
      lastRun: null,
      totalRuns: 0,
      lastError: null,
    };
  }

  async start() {
    try {
      logger.info('Starting OneSignal Tag Reconciliation Job...');
      const job = cron.schedule(
        this.cronExpression,
        async () => this.runReconciliation(),
        { scheduled: false, timezone: 'UTC' }
      );
      this.cronJob = job;
      job.start();
      this.isRunning = true;
      logger.info(
        `OneSignal Tag Reconciliation started — cron: ${this.cronExpression} UTC (00:05)`
      );
    } catch (error) {
      logger.error(`Failed to start OneSignal Tag Reconciliation: ${error.message}`);
      throw error;
    }
  }

  async stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    this.isRunning = false;
    logger.info('OneSignal Tag Reconciliation stopped');
  }

  async runReconciliation() {
    logger.info('=== OneSignal Tag Reconciliation cron started ===');
    try {
      const result = await reconcileTags({ lookbackDays: 7 });
      this.stats.lastRun = new Date();
      this.stats.totalRuns += 1;
      this.stats.lastError = null;
      logger.info(
        `=== OneSignal Tag Reconciliation completed — ` +
        `vip=${result.totals.vip} free=${result.totals.free} ` +
        `noDevice=${result.totals.noDevice} duration=${result.durationMs}ms ===`
      );
    } catch (error) {
      this.stats.lastError = error.message;
      logger.error(`=== OneSignal Tag Reconciliation FAILED: ${error.message} ===`);
    }
  }

  getStats() {
    return {
      isRunning: this.isRunning,
      cronExpression: this.cronExpression,
      ...this.stats,
    };
  }
}

module.exports = new OneSignalTagReconciliationJob();
