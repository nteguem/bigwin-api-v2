// src/api/middlewares/payment/paymentMiddleware.js

const subscriptionService = require('../../services/user/subscriptionService');
const notificationService = require('../../services/common/notificationService');
const ga4mp = require('../../services/common/googleAnalyticsMpService');
const affiliateService = require('../../services/affiliate/affiliateService');
const App = require('../../models/common/App');
const User = require('../../models/user/User');
const Device = require('../../models/common/Device');
const logger = require('../../../core/logger');

const SERVICE = 'paymentMiddleware';

/**
 * Envoie un event GA4 Measurement Protocol en fire-and-forget.
 * Ne bloque JAMAIS le flux de paiement — les erreurs GA sont loggées et
 * absorbées. Utilisé depuis handleSuccessfulTransaction / handleFailedTransaction.
 */
async function _fireGa4Event(eventType, appId, transaction) {
  try {
    // On lean() les 2 queries en parallèle pour minimiser la latence
    const [app, user] = await Promise.all([
      App.findOne({ appId }).lean(),
      User.findById(transaction.user).lean(),
    ]);

    if (!app || !user) return;

    await transaction.populate('package');
    const pkg = transaction.package;
    const paymentMethod = transaction.constructor.modelName
      .replace(/Transaction$/, '')
      .toLowerCase(); // ex: 'afribapay', 'smobilpay'…

    // Identifiant unique de transaction selon le PSP
    const transactionId = String(
      transaction.orderId
        || transaction.transactionId
        || transaction.paymentId
        || transaction._id
    );

    if (eventType === 'purchase') {
      await ga4mp.sendPurchase({
        app,
        user,
        transactionId,
        value: transaction.amount,
        currency: transaction.currency,
        paymentMethod,
        packageId: pkg?._id ? String(pkg._id) : undefined,
        packageName: pkg?.name?.fr || pkg?.name?.en || undefined,
      });
    } else if (eventType === 'payment_failed') {
      await ga4mp.sendPaymentFailed({
        app,
        user,
        transactionId,
        value: transaction.amount,
        currency: transaction.currency,
        paymentMethod,
        reason: transaction.errorCode || transaction.status,
      });
    }
  } catch (err) {
    // Absorber toutes les erreurs — analytics ne doit jamais casser le webhook
    logger.error('_fireGa4Event failed', {
      service: SERVICE,
      category: 'ga4',
      eventType,
      appId,
      message: err.message,
    });
  }
}

/**
 * Traiter une transaction réussie
 */
async function handleSuccessfulTransaction(appId, transaction) {
  const ctx = {
    service: SERVICE,
    category: 'handleSuccess',
    appId,
    transactionId: String(transaction._id),
  };

  try {
    if (!transaction.isSuccessful()) {
      return null;
    }

    // Atomic : empêche le double-provisioning si 2 webhooks arrivent en même temps.
    const claimed = await transaction.constructor.findOneAndUpdate(
      { _id: transaction._id, processed: { $ne: true } },
      { $set: { processed: true } },
      { new: true }
    );

    if (!claimed) {
      logger.info('already processed, skipping (idempotency hit)', ctx);
      return null;
    }

    const subscription = await subscriptionService.createSubscription(
      appId,
      transaction.user,
      transaction.package,
      transaction.currency,
      transaction._id
    );

    logger.info('subscription created', {
      ...ctx,
      subscriptionId: String(subscription._id),
    });

    // Création automatique de la Commission affilié si le filleul a un
    // Referral éligible (status='signed_up'). Silencieux, pas bloquant.
    try {
      const commission = await affiliateService.tryCreateCommissionForSubscription(subscription);
      if (commission) {
        logger.info('affiliate commission created', {
          ...ctx,
          commissionId: String(commission._id),
          referrerId: String(commission.referrer),
          amount: commission.amount,
        });
      }
    } catch (err) {
      logger.warn('affiliate commission creation failed (non-blocking)', {
        ...ctx,
        error: err.message,
      });
    }

    // GA4 MP : fire l'event `purchase` pour Google Ads Smart Bidding.
    // Fire-and-forget — les erreurs ne bloquent pas le flow.
    await _fireGa4Event('purchase', appId, transaction);

    await sendPaymentSuccessNotification(appId, transaction);

    return subscription;
  } catch (error) {
    logger.error('handleSuccess failed', {
      ...ctx,
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Traiter une transaction échouée
 */
async function handleFailedTransaction(appId, transaction) {
  const ctx = {
    service: SERVICE,
    category: 'handleFailed',
    appId,
    transactionId: String(transaction._id),
    status: transaction.status,
  };

  try {
    await sendPaymentFailedNotification(appId, transaction);

    // GA4 MP : fire `payment_failed` pour diagnostic funnel (pas une conversion).
    await _fireGa4Event('payment_failed', appId, transaction);

    transaction.processed = true;
    await transaction.save();

    logger.info('failed transaction marked as processed', ctx);
  } catch (error) {
    logger.error('handleFailed error', {
      ...ctx,
      message: error.message,
      stack: error.stack,
    });
  }
}

/**
 * Envoyer notification de paiement réussi
 */
async function sendPaymentSuccessNotification(appId, transaction) {
  try {
    // Récupérer le device de l'utilisateur pour avoir son playerId
    const device = await Device.findOne({
      appId,
      user: transaction.user,
      isActive: true,
      playerId: { $exists: true, $ne: null }
    }).sort({ lastActiveAt: -1 });
    
    if (!device || !device.playerId) {
      logger.debug('no playerId found, skipping success notification', {
        service: SERVICE,
        category: 'notify',
        appId,
        userId: String(transaction.user),
      });
      return;
    }

    // Populer le package pour avoir son nom
    await transaction.populate('package');
    const packageName = transaction.package?.name?.fr || transaction.package?.name?.en || 'Package Premium';

    const notification = {
      headings: {
        en: "🎉 Payment Successful!",
        fr: "🎉 Paiement Réussi !"
      },
      contents: {
        en: `Your subscription to ${packageName} is now active! Enjoy your premium features.`,
        fr: `Votre abonnement à ${packageName} est maintenant actif ! Profitez de vos avantages premium.`
      },
      data: {
        type: "payment_success",
        transaction_id: transaction._id.toString(),
        // Le package peut avoir été supprimé en BD entre l'initiation et le webhook
        package_id: transaction.package?._id?.toString() || '',
        subscription_type: "premium",
        action: "view_subscription"
      },
      options: {
        android_accent_color: "00C853",
        small_icon: "ic_notification",
        large_icon: "ic_launcher",
        priority: 8
      }
    };
    
    await notificationService.sendToUsers(appId, [device.playerId], notification);

    logger.info('success notification sent', {
      service: SERVICE,
      category: 'notify',
      appId,
      userId: String(transaction.user),
    });
  } catch (error) {
    logger.error('success notification failed', {
      service: SERVICE,
      category: 'notify',
      appId,
      userId: String(transaction.user),
      message: error.message,
      stack: error.stack,
    });
  }
}

/**
 * Envoyer notification de paiement échoué
 */
async function sendPaymentFailedNotification(appId, transaction) {
  try {
    // Récupérer le device de l'utilisateur
    const device = await Device.findOne({
      appId,
      user: transaction.user,
      isActive: true,
      playerId: { $exists: true, $ne: null }
    }).sort({ lastActiveAt: -1 });
    
    if (!device || !device.playerId) {
      logger.debug('no playerId found, skipping failure notification', {
        service: SERVICE,
        category: 'notify',
        appId,
        userId: String(transaction.user),
      });
      return;
    }

    // Populer le package
    await transaction.populate('package');
    const packageName = transaction.package?.name?.fr || transaction.package?.name?.en || 'Package Premium';

    const notification = {
      headings: {
        en: "❌ Payment Failed",
        fr: "❌ Paiement Échoué"
      },
      contents: {
        en: `Your payment for ${packageName} could not be processed. Please try again or contact support.`,
        fr: `Votre paiement pour ${packageName} n'a pas pu être traité. Veuillez réessayer ou contacter le support.`
      },
      data: {
        type: "payment_failed",
        transaction_id: transaction._id.toString(),
        // Le package peut avoir été supprimé en BD entre l'initiation et le webhook
        package_id: transaction.package?._id?.toString() || '',
        action: "retry_payment"
      },
      options: {
        android_accent_color: "D32F2F",
        small_icon: "ic_notification",
        large_icon: "ic_launcher",
        priority: 7
      }
    };
    
    await notificationService.sendToUsers(appId, [device.playerId], notification);

    logger.info('failed notification sent', {
      service: SERVICE,
      category: 'notify',
      appId,
      userId: String(transaction.user),
    });
  } catch (error) {
    logger.error('failed notification failed', {
      service: SERVICE,
      category: 'notify',
      appId,
      userId: String(transaction.user),
      message: error.message,
      stack: error.stack,
    });
  }
}

/**
 * Traiter une transaction mise à jour
 */
/**
 * Traiter une transaction mise à jour
 */
async function processTransactionUpdate(appId, transaction) {
  try {
    if (transaction.isSuccessful()) {
      return await handleSuccessfulTransaction(appId, transaction);
    } 
    else if (transaction.status === 'FAILED' || transaction.status === 'REFUSED' || transaction.status === 'ERROR' || transaction.status === 'CANCELED') {
      await handleFailedTransaction(appId, transaction);
    }
    
    return null;
  } catch (error) {
    logger.error('processTransactionUpdate failed', {
      service: SERVICE,
      category: 'dispatch',
      appId,
      transactionId: String(transaction._id),
      status: transaction.status,
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

module.exports = {
  processTransactionUpdate,
  handleSuccessfulTransaction,
  handleFailedTransaction,
  sendPaymentSuccessNotification,
  sendPaymentFailedNotification
};