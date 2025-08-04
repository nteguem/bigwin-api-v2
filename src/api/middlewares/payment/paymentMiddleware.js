const subscriptionService = require('../../services/user/subscriptionService');


async function handleSuccessfulTransaction(transaction) {
  try {
    if (transaction.isSuccessful() && !transaction.processed) {
      console.log(`Processing successful transaction: ${transaction.paymentId}`);
      
      // Créer la souscription avec XAF par défaut
      const subscription = await subscriptionService.createSubscription(
        transaction.user,
        transaction.package,
        'XAF', // Toujours XAF pour Smobilpay
        transaction.paymentId
      );
      
      console.log(`Subscription created: ${subscription._id}`);
      
      // Marquer comme traité
      transaction.processed = true;
      await transaction.save();
      
      console.log(`Transaction ${transaction.paymentId} marked as processed`);
      
      return subscription;
    }
    
    return null;
  } catch (error) {
    console.error(`Error processing transaction ${transaction.paymentId}:`, error.message);
    throw error;
  }
}

/**
 * Middleware pour traiter les transactions échouées
 */
async function handleFailedTransaction(transaction) {
  try {
    if (transaction.status === 'FAILED' || transaction.status === 'ERRORED') {
      console.log(`Processing failed transaction: ${transaction.paymentId}`);
      
      // TODO: Envoyer notification d'échec
      // await notificationService.sendPaymentFailed(transaction);
      
      // Marquer comme traité même en cas d'échec
      transaction.processed = true;
      await transaction.save();
    }
  } catch (error) {
    console.error(`Error processing failed transaction ${transaction.paymentId}:`, error.message);
  }
}

/**
 * Traiter une transaction mise à jour
 */
async function processTransactionUpdate(transaction) {
  try {
    // Traiter selon le statut
    if (transaction.isSuccessful()) {
      return await handleSuccessfulTransaction(transaction);
    } else if (transaction.status === 'FAILED' || transaction.status === 'ERRORED') {
      await handleFailedTransaction(transaction);
    }
    
    return null;
  } catch (error) {
    console.error(`Error in transaction middleware:`, error.message);
    throw error;
  }
}

module.exports = {
  processTransactionUpdate,
  handleSuccessfulTransaction,
  handleFailedTransaction
};