// src/jobs/pawapayPollingJob.js
//
// Polling serveur des transactions pawaPay PENDING/INITIATED, en complement
// du webhook. Garantit qu'on ne perd JAMAIS un paiement meme si pawaPay
// n'envoie pas (ou pas a temps) son callback. Tourne toutes les 30 secondes.
//
// Pour chaque tx pending de moins de 15 minutes, on appelle
// pawapayService.checkTransactionStatus(). Si le statut est devenu final
// (SUCCESS / FAILED / EXPIRED) on passe par paymentMiddleware.processTransactionUpdate
// — meme chemin que le webhook, donc idempotency identique (claim
// atomique + processed=true).
//
// Au-dela de 15 minutes sans confirmation, la tx est forcee a EXPIRED
// (pawaPay considere la transaction morte au-dela).

const cron = require('node-cron');
const logger = require('../core/logger');
const PawapayTransaction = require('../api/models/user/PawapayTransaction');
const App = require('../api/models/common/App');
const pawapayService = require('../api/services/user/PawapayService');
const paymentMiddleware = require('../api/middlewares/payment/paymentMiddleware');

const SERVICE = 'pawapay';

// Toutes les 30 secondes (cron syntax 6 fields, node-cron supporte).
const POLL_CRON = '*/30 * * * * *';

// Une tx fraichement creee a besoin de quelques secondes pour que pawaPay
// l'enregistre cote eux — on ne la check pas trop vite pour eviter du bruit.
const MIN_AGE_MS = 25 * 1000;            // 25 secondes

// Au-dela de cette age, on abandonne (pawaPay considere la tx morte).
const MAX_AGE_MS = 15 * 60 * 1000;       // 15 minutes

// Statuts internes consideres comme "encore en attente" cote pawaPay.
const PENDING_STATUSES = ['PENDING', 'INITIATED', 'ACCEPTED'];

// Mutex pour eviter le chevauchement si un cycle prend > 30s.
let isRunning = false;

async function pollPendingTransactions() {
  if (isRunning) {
    logger.debug('polling: skip (previous cycle still running)', {
      service: SERVICE,
      category: 'polling',
    });
    return;
  }
  isRunning = true;

  const startedAt = Date.now();

  try {
    const now = new Date();
    const minDate = new Date(now.getTime() - MAX_AGE_MS);
    const maxDate = new Date(now.getTime() - MIN_AGE_MS);

    // 1. Marquer EXPIRED les tx trop vieilles (> 15 min) AVANT le poll
    //    pour ne pas les appeler inutilement.
    const expiredResult = await PawapayTransaction.updateMany(
      {
        status: { $in: PENDING_STATUSES },
        processed: { $ne: true },
        createdAt: { $lt: minDate }
      },
      {
        $set: {
          status: 'EXPIRED',
          failureCode: 'POLLING_TIMEOUT',
          failureMessage: 'No confirmation from pawaPay after 15 minutes'
        }
      }
    );

    if (expiredResult.modifiedCount > 0) {
      logger.warn('polling: marked transactions as EXPIRED (> 15min)', {
        service: SERVICE,
        category: 'polling',
        count: expiredResult.modifiedCount,
      });
    }

    // 2. Lister les tx encore polables (entre 25s et 15min)
    const pendings = await PawapayTransaction.find({
      status: { $in: PENDING_STATUSES },
      processed: { $ne: true },
      createdAt: { $gte: minDate, $lte: maxDate }
    })
      .select('_id appId depositId createdAt status')
      .limit(200)
      .lean();

    if (pendings.length === 0) {
      isRunning = false;
      return;
    }

    logger.info('polling: cycle start', {
      service: SERVICE,
      category: 'polling',
      pending: pendings.length,
    });

    let success = 0, failed = 0, stillPending = 0, errors = 0;

    // Cache des apps pour ne charger chaque app qu'une fois par cycle.
    const appCache = new Map();

    for (const tx of pendings) {
      try {
        let app = appCache.get(tx.appId);
        if (!app) {
          app = await App.findOne({ appId: tx.appId, isActive: true }).lean();
          if (!app) {
            logger.warn('polling: app not found', {
              service: SERVICE,
              category: 'polling',
              depositId: tx.depositId,
              appId: tx.appId,
            });
            errors++;
            continue;
          }
          appCache.set(tx.appId, app);
        }

        // checkTransactionStatus persiste le nouveau status + failureReason
        // et renvoie le doc mis a jour (avec populate package + user).
        const updated = await pawapayService.checkTransactionStatus(
          tx.appId,
          app,
          tx.depositId
        );

        if (updated.status === 'SUCCESS') {
          await paymentMiddleware.processTransactionUpdate(tx.appId, updated);
          success++;
          logger.info('polling: SUCCESS captured (subscription created)', {
            service: SERVICE,
            category: 'polling',
            depositId: tx.depositId,
            appId: tx.appId,
          });
        } else if (updated.status === 'FAILED' || updated.status === 'EXPIRED') {
          await paymentMiddleware.processTransactionUpdate(tx.appId, updated);
          failed++;
          logger.info('polling: FAILED handled', {
            service: SERVICE,
            category: 'polling',
            depositId: tx.depositId,
            appId: tx.appId,
            finalStatus: updated.status,
            failureCode: updated.failureCode,
          });
        } else {
          stillPending++;
        }
      } catch (err) {
        errors++;
        logger.error('polling: tx check failed', {
          service: SERVICE,
          category: 'polling',
          depositId: tx.depositId,
          appId: tx.appId,
          message: err.message,
          stack: err.stack,
        });
      }
    }

    logger.info('polling: cycle done', {
      service: SERVICE,
      category: 'polling',
      pending: pendings.length,
      success,
      failed,
      stillPending,
      errors,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    logger.error('polling: top-level error', {
      service: SERVICE,
      category: 'polling',
      message: err.message,
      stack: err.stack,
    });
  } finally {
    isRunning = false;
  }
}

const cronJob = cron.schedule(POLL_CRON, pollPendingTransactions, {
  scheduled: false,
});

module.exports = {
  start: () => {
    logger.info('pawapay polling job started (every 30s)', {
      service: SERVICE,
      category: 'polling',
    });
    cronJob.start();
  },
  stop: () => {
    cronJob.stop();
  },
  // Pour declenchement manuel (admin debug)
  pollNow: pollPendingTransactions,
};
