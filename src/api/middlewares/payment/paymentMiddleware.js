// src/api/middlewares/payment/paymentMiddleware.js

const subscriptionService = require('../../services/user/subscriptionService');
const notificationService = require('../../services/common/notificationService');
const Device = require('../../models/common/Device');

/**
 * Traiter une transaction réussie
 */
async function handleSuccessfulTransaction(appId, transaction) {
  try {
    if (!transaction.isSuccessful()) {
      return null;
    }

    // ⭐ Opération atomique pour éviter les doublons de souscription
    // Si deux webhooks arrivent en même temps, seul le premier réussira ce update
    const claimed = await transaction.constructor.findOneAndUpdate(
      { _id: transaction._id, processed: { $ne: true } },
      { $set: { processed: true } },
      { new: true }
    );

    if (!claimed) {
      console.log(`[${appId}] Transaction ${transaction._id} already processed, skipping`);
      return null;
    }

    console.log(`[${appId}] Processing successful transaction: ${transaction._id}`);

    const subscription = await subscriptionService.createSubscription(
      appId,
      transaction.user,
      transaction.package,
      transaction.currency,
      transaction._id
    );

    console.log(`[${appId}] Subscription created: ${subscription._id}`);
    console.log(`[${appId}] Transaction ${transaction._id} marked as processed`);

    // Envoyer notification de succès
    await sendPaymentSuccessNotification(appId, transaction);

    return subscription;
  } catch (error) {
    console.error(`[${appId}] Error processing transaction ${transaction._id}:`, error.message);
    throw error;
  }
}

/**
 * Traiter une transaction échouée
 */
async function handleFailedTransaction(appId, transaction) {
  try {
    console.log(`[${appId}] Processing failed transaction: ${transaction._id}`);
    
    // Envoyer notification d'échec
    await sendPaymentFailedNotification(appId, transaction);
    
    transaction.processed = true;
    await transaction.save();
    
    console.log(`[${appId}] Failed transaction ${transaction._id} marked as processed`);
  } catch (error) {
    console.error(`[${appId}] Error processing failed transaction ${transaction._id}:`, error.message);
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
      console.log(`[${appId}] No playerId found for user ${transaction.user}, skipping notification`);
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
        package_id: transaction.package._id.toString(),
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
    
    console.log(`[${appId}] Payment success notification sent to user ${transaction.user}`);
  } catch (error) {
    console.error(`[${appId}] Error sending payment success notification:`, error.message);
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
      console.log(`[${appId}] No playerId found for user ${transaction.user}, skipping notification`);
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
        package_id: transaction.package._id.toString(),
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
    
    console.log(`[${appId}] Payment failed notification sent to user ${transaction.user}`);
  } catch (error) {
    console.error(`[${appId}] Error sending payment failed notification:`, error.message);
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
    console.error(`[${appId}] Error in transaction middleware:`, error.message);
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