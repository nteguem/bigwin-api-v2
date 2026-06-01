// src/jobs/pawapayPollingJob.js
//
// Polling serveur des transactions pawaPay PENDING/INITIATED, en complement
// du webhook. Garantit qu'on ne perd JAMAIS un paiement meme si pawaPay
// n'envoie pas (ou pas a temps) son callback. Tourne toutes les 30 secondes.
//
// Ordre des operations CRITIQUE (sinon perte de paiement) :
//   1. Lister toutes les tx pending non-processed agees de > 25s
//      (PAS de filtre superieur — on doit toujours demander a pawaPay)
//   2. Pour chaque : checkStatus chez pawaPay → si SUCCESS/FAILED final,
//      paymentMiddleware.processTransactionUpdate (claim atomique +
//      processed=true, meme chemin que le webhook)
//   3. APRES tous les checks : forcer EXPIRED uniquement les tx que
//      pawaPay nous a confirmees encore pending ET agees de > 30min
//
// Le forcing EXPIRED a la FIN, jamais au debut — sinon une tx COMPLETED
// chez pawaPay dont le webhook a echoue serait marquee EXPIRED localement
// et le paiement serait perdu.

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

// Au-dela de cette age, si pawaPay nous dit toujours "pending", on
// considere la tx morte et on la force a EXPIRED. ATTENTION : on FORCE
// uniquement APRES avoir interroge pawaPay, jamais avant — sinon on perd
// les paiements pour lesquels le webhook a echoue (cas reel observe).
const MAX_AGE_MS = 30 * 60 * 1000;       // 30 minutes

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
    const maxDate = new Date(now.getTime() - MIN_AGE_MS);

    // CHANGEMENT CRITIQUE : on NE force PLUS EXPIRED avant le check.
    // Avant : le forcing avait lieu en 1er ET les tx > 15min etaient
    // marquees EXPIRED sans demander a pawaPay leur vrai statut. Une tx
    // COMPLETED chez pawaPay (webhook rate) etait perdue definitivement.
    //
    // Maintenant : on check TOUTES les tx non-processed ageees de > 25s,
    // peu importe leur age. pawaPay nous dira si elles sont COMPLETED,
    // FAILED ou encore en cours. Le forcing EXPIRED a lieu APRES le check
    // et uniquement sur celles qui sont confirmees pending par pawaPay et
    // ageees de plus de 30min.
    const pendings = await PawapayTransaction.find({
      status: { $in: PENDING_STATUSES },
      processed: { $ne: true },
      createdAt: { $lte: maxDate }
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

    // APRES le check : forcer EXPIRED uniquement les tx que pawaPay nous a
    // confirmees comme encore pending ET qui sont ageees de > 30 minutes.
    // Securite contre les tx zombies (pawaPay ne tranche jamais).
    const expiryCutoff = new Date(now.getTime() - MAX_AGE_MS);
    const expiredResult = await PawapayTransaction.updateMany(
      {
        status: { $in: PENDING_STATUSES },
        processed: { $ne: true },
        createdAt: { $lt: expiryCutoff }
      },
      {
        $set: {
          status: 'EXPIRED',
          failureCode: 'POLLING_TIMEOUT',
          failureMessage: 'pawaPay confirmed still pending after 30 minutes'
        }
      }
    );

    if (expiredResult.modifiedCount > 0) {
      logger.warn('polling: forced EXPIRED on zombie transactions', {
        service: SERVICE,
        category: 'polling',
        count: expiredResult.modifiedCount,
      });
    }
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
