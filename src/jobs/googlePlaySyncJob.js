// jobs/googlePlaySyncJob.js
const cron = require('node-cron');
const GooglePlayTransaction = require('../api/models/user/GooglePlayTransaction');
const Subscription = require('../api/models/common/Subscription');
const App = require('../api/models/common/App');
const googlePlayService = require('../api/services/user/GooglePlayService');

// Job pour synchroniser les abonnements Google Play actifs
// S'exécute toutes les 6 heures
const syncGooglePlaySubscriptions = cron.schedule('0 */6 * * *', async () => {
  console.log('[CRON] Début de la synchronisation Google Play multi-tenant');
  
  try {
    // 1. Récupérer toutes les apps actives avec Google Play configuré
    const apps = await App.find({
      isActive: true,
      'googlePlay.packageName': { $exists: true, $ne: null },
      'googlePlay.serviceAccountKeyPath': { $exists: true, $ne: null }
    }).lean();

    console.log(`[CRON] ${apps.length} apps avec Google Play configuré`);

    let totalSuccess = 0;
    let totalErrors = 0;

    // 2. Pour chaque app, synchroniser les transactions
    for (const app of apps) {
      console.log(`[CRON] Synchronisation pour app: ${app.appId}`);

      try {
        // Récupérer les transactions actives de cette app
        const activeTransactions = await GooglePlayTransaction.find({
          appId: app.appId,
          status: { $in: ['ACTIVE', 'CANCELED'] },
          expiryTime: { $gt: new Date() }
        });

        console.log(`[CRON] ${activeTransactions.length} transactions à synchroniser pour ${app.appId}`);

        let appSuccess = 0;
        let appErrors = 0;

        for (const transaction of activeTransactions) {
          try {
            await googlePlayService.syncSubscription(app, transaction.purchaseToken);
            appSuccess++;
          } catch (error) {
            console.error(`[CRON] Erreur sync ${transaction.purchaseToken} (app: ${app.appId}):`, error.message);
            appErrors++;
          }
        }

        console.log(`[CRON] App ${app.appId} - Succès: ${appSuccess}, Erreurs: ${appErrors}`);
        totalSuccess += appSuccess;
        totalErrors += appErrors;

      } catch (error) {
        console.error(`[CRON] Erreur pour app ${app.appId}:`, error.message);
      }
    }

    console.log(`[CRON] Synchronisation terminée - Total Succès: ${totalSuccess}, Total Erreurs: ${totalErrors}`);

  } catch (error) {
    console.error('[CRON] Erreur globale synchronisation Google Play:', error);
  }
}, {
  scheduled: false
});

// Job pour nettoyer les abonnements expirés
// S'exécute tous les jours à 2h du matin
const cleanupExpiredSubscriptions = cron.schedule('0 2 * * *', async () => {
  console.log('[CRON] Début du nettoyage des abonnements expirés multi-tenant');
  
  try {
    // 1. Récupérer toutes les apps actives
    const apps = await App.find({ isActive: true }).lean();

    for (const app of apps) {
      console.log(`[CRON] Nettoyage pour app: ${app.appId}`);

      // 1.1 Nettoyer les abonnements Mobile Money expirés
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

      console.log(`[CRON] App ${app.appId}: ${expiredMobileMoney.modifiedCount} abonnements Mobile Money expirés`);

      // 1.2 Nettoyer les transactions Google Play expirées
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

      console.log(`[CRON] App ${app.appId}: ${expiredGooglePlay.length} transactions Google Play expirées`);
    }

    console.log('[CRON] Nettoyage terminé');

  } catch (error) {
    console.error('[CRON] Erreur nettoyage abonnements:', error);
  }
}, {
  scheduled: false
});

// Job pour vérifier les achats non-acknowledged
// S'exécute toutes les heures
const checkUnacknowledgedPurchases = cron.schedule('0 * * * *', async () => {
  console.log('[CRON] Vérification des achats non-acknowledged multi-tenant');
  
  try {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 2.5);

    // 1. Récupérer toutes les apps avec Google Play configuré
    const apps = await App.find({
      isActive: true,
      'googlePlay.packageName': { $exists: true, $ne: null },
      'googlePlay.serviceAccountKeyPath': { $exists: true, $ne: null }
    }).lean();

    for (const app of apps) {
      console.log(`[CRON] Vérification acknowledge pour app: ${app.appId}`);

      const unacknowledged = await GooglePlayTransaction.find({
        appId: app.appId,
        acknowledged: false,
        purchaseTime: { $lt: threeDaysAgo },
        status: { $ne: 'EXPIRED' }
      });

      console.log(`[CRON] App ${app.appId}: ${unacknowledged.length} achats à acknowledger d'urgence`);

      for (const transaction of unacknowledged) {
        try {
          // Déterminer le type d'acknowledge selon le type de produit
          if (transaction.purchaseType === 'ONE_TIME_PRODUCT') {
            await googlePlayService.acknowledgeOneTimePurchase(app, transaction.purchaseToken, transaction.productId);
          } else {
            await googlePlayService.acknowledgePurchase(app, transaction.purchaseToken);
          }
          console.log(`[CRON] Acknowledged: ${transaction.purchaseToken} (app: ${app.appId})`);
        } catch (error) {
          console.error(`[CRON] Erreur acknowledge ${transaction.purchaseToken} (app: ${app.appId}):`, error.message);
        }
      }
    }

    console.log('[CRON] Vérification acknowledge terminée');

  } catch (error) {
    console.error('[CRON] Erreur vérification acknowledgements:', error);
  }
}, {
  scheduled: false
});

// Fonctions pour démarrer/arrêter les jobs
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
  
  // Pour exécuter manuellement
  syncNow: async () => {
    console.log('[CRON] Synchronisation manuelle déclenchée');
    await syncGooglePlaySubscriptions._callbacks[0]();
  },
  
  cleanupNow: async () => {
    console.log('[CRON] Nettoyage manuel déclenché');
    await cleanupExpiredSubscriptions._callbacks[0]();
  },

  // Synchroniser une app spécifique
  syncAppNow: async (appId) => {
    console.log(`[CRON] Synchronisation manuelle pour app: ${appId}`);
    
    const app = await App.findOne({ 
      appId, 
      isActive: true,
      'googlePlay.packageName': { $exists: true, $ne: null }
    }).lean();

    if (!app) {
      console.log(`[CRON] App ${appId} non trouvée ou Google Play non configuré`);
      return;
    }

    const activeTransactions = await GooglePlayTransaction.find({
      appId: app.appId,
      status: { $in: ['ACTIVE', 'CANCELED'] },
      expiryTime: { $gt: new Date() }
    });

    console.log(`[CRON] ${activeTransactions.length} transactions à synchroniser`);

    for (const transaction of activeTransactions) {
      try {
        await googlePlayService.syncSubscription(app, transaction.purchaseToken);
        console.log(`[CRON] Sync OK: ${transaction.purchaseToken}`);
      } catch (error) {
        console.error(`[CRON] Erreur sync ${transaction.purchaseToken}:`, error.message);
      }
    }

    console.log(`[CRON] Synchronisation app ${appId} terminée`);
  }
};