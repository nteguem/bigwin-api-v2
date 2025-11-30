// src/jobs/googlePlaySyncJob.js

const cron = require('node-cron');
const GooglePlayTransaction = require('../api/models/user/GooglePlayTransaction');
const Subscription = require('../api/models/common/Subscription');
const App = require('../api/models/common/App');
const googlePlayService = require('../api/services/user/GooglePlayService');

/**
 * Synchroniser les abonnements Google Play de toutes les apps
 * S'exécute toutes les 6 heures
 */
const syncGooglePlaySubscriptions = cron.schedule('0 */6 * * *', async () => {
  console.log('[CRON] Début de la synchronisation Google Play multi-tenant');
  
  try {
    const apps = await App.find({
      isActive: true,
      'googlePlay.packageName': { $exists: true, $ne: null }
    });

    console.log(`[CRON] ${apps.length} apps à synchroniser`);

    for (const app of apps) {
      console.log(`[CRON] === Synchronisation de l'app: ${app.appId} ===`);
      
      try {
        const activeTransactions = await GooglePlayTransaction.find({
          appId: app.appId,
          status: { $in: ['ACTIVE', 'CANCELED'] },
          expiryTime: { $gt: new Date() }
        });

        console.log(`[CRON] [${app.appId}] ${activeTransactions.length} transactions à synchroniser`);

        let successCount = 0;
        let errorCount = 0;

        for (const transaction of activeTransactions) {
          try {
            await googlePlayService.syncSubscription(app.appId, transaction.purchaseToken);
            successCount++;
          } catch (error) {
            console.error(`[CRON] [${app.appId}] Erreur sync ${transaction.purchaseToken}:`, error.message);
            errorCount++;
          }
        }

        console.log(`[CRON] [${app.appId}] Synchronisation terminée - Succès: ${successCount}, Erreurs: ${errorCount}`);

      } catch (error) {
        console.error(`[CRON] [${app.appId}] Erreur synchronisation app:`, error.message);
      }
    }

    console.log('[CRON] Synchronisation multi-tenant terminée');

  } catch (error) {
    console.error('[CRON] Erreur globale synchronisation Google Play:', error);
  }
}, {
  scheduled: false
});

/**
 * Nettoyer les abonnements expirés de toutes les apps
 * S'exécute tous les jours à 2h du matin
 */
const cleanupExpiredSubscriptions = cron.schedule('0 2 * * *', async () => {
  console.log('[CRON] Début du nettoyage des abonnements expirés multi-tenant');
  
  try {
    const apps = await App.find({ isActive: true });

    for (const app of apps) {
      console.log(`[CRON] === Nettoyage de l'app: ${app.appId} ===`);
      
      try {
        const expiredMobileMoney = await Subscription.updateMany(
          {
            appId: app.appId,
            paymentProvider: 'MOBILE_MONEY',
            status: 'active',
            endDate: { $lt: new Date() }
          },
          {
            $set: { status: 'expired' }
          }
        );

        console.log(`[CRON] [${app.appId}] ${expiredMobileMoney.modifiedCount} abonnements Mobile Money expirés`);

        const expiredGooglePlay = await GooglePlayTransaction.find({
          appId: app.appId,
          status: { $in: ['ACTIVE', 'CANCELED'] },
          expiryTime: { $lt: new Date() },
          autoRenewing: false
        });

        for (const transaction of expiredGooglePlay) {
          transaction.status = 'EXPIRED';
          await transaction.save();

          await Subscription.findByIdAndUpdate(
            transaction.subscription,
            { status: 'expired' }
          );
        }

        console.log(`[CRON] [${app.appId}] ${expiredGooglePlay.length} transactions Google Play expirées`);

      } catch (error) {
        console.error(`[CRON] [${app.appId}] Erreur nettoyage app:`, error.message);
      }
    }

    console.log('[CRON] Nettoyage multi-tenant terminé');

  } catch (error) {
    console.error('[CRON] Erreur nettoyage abonnements:', error);
  }
}, {
  scheduled: false
});

/**
 * Vérifier les achats non-acknowledged de toutes les apps
 * S'exécute toutes les heures
 */
const checkUnacknowledgedPurchases = cron.schedule('0 * * * *', async () => {
  console.log('[CRON] Vérification des achats non-acknowledged multi-tenant');
  
  try {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 2.5);

    const apps = await App.find({ isActive: true });

    for (const app of apps) {
      console.log(`[CRON] === Vérification acknowledge pour l'app: ${app.appId} ===`);
      
      try {
        const unacknowledged = await GooglePlayTransaction.find({
          appId: app.appId,
          acknowledged: false,
          purchaseTime: { $lt: threeDaysAgo },
          status: { $ne: 'EXPIRED' }
        });

        console.log(`[CRON] [${app.appId}] ${unacknowledged.length} achats à acknowledger d'urgence`);

        for (const transaction of unacknowledged) {
          try {
            await googlePlayService.acknowledgePurchase(app.appId, transaction.purchaseToken);
            console.log(`[CRON] [${app.appId}] Acknowledged: ${transaction.purchaseToken}`);
          } catch (error) {
            console.error(`[CRON] [${app.appId}] Erreur acknowledge ${transaction.purchaseToken}:`, error.message);
          }
        }

      } catch (error) {
        console.error(`[CRON] [${app.appId}] Erreur vérification acknowledge:`, error.message);
      }
    }

    console.log('[CRON] Vérification acknowledge multi-tenant terminée');

  } catch (error) {
    console.error('[CRON] Erreur vérification acknowledgements:', error);
  }
}, {
  scheduled: false
});

module.exports = {
  start: () => {
    console.log('[CRON] Démarrage des jobs Google Play multi-tenant');
    syncGooglePlaySubscriptions.start();
    cleanupExpiredSubscriptions.start();
    checkUnacknowledgedPurchases.start();
  },
  
  stop: () => {
    console.log('[CRON] Arrêt des jobs Google Play');
    syncGooglePlaySubscriptions.stop();
    cleanupExpiredSubscriptions.stop();
    checkUnacknowledgedPurchases.stop();
  },
  
  syncNow: async () => {
    console.log('[CRON] Synchronisation manuelle déclenchée');
    await syncGooglePlaySubscriptions._callbacks[0]();
  },
  
  cleanupNow: async () => {
    console.log('[CRON] Nettoyage manuel déclenché');
    await cleanupExpiredSubscriptions._callbacks[0]();
  }
};