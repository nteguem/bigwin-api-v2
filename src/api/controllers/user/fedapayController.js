// src/api/controllers/user/fedapayController.js

const fedapayService = require('../../services/user/FedapayService');
const paymentMiddleware = require('../../middlewares/payment/paymentMiddleware');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const catchAsync = require('../../../utils/catchAsync');
const App = require('../../models/common/App');
const User = require('../../models/user/User'); // ← Ajout
const crypto = require('crypto');

/**
 * Initier un paiement FedaPay
 */
exports.initiatePayment = catchAsync(async (req, res, next) => {
  const { packageId } = req.body;
  const appId = req.appId;
  const currentApp = req.currentApp;

  if (!appId || !currentApp) {
    return next(new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR));
  }

  if (!packageId) {
    return next(new AppError('packageId requis', 400, ErrorCodes.VALIDATION_ERROR));
  }

  if (!currentApp?.payments?.fedapay?.enabled) {
    return next(new AppError('FedaPay non activé', 400, ErrorCodes.VALIDATION_ERROR));
  }

  const subscriptionService = require('../../services/user/subscriptionService');
  const activeSubscriptions = await subscriptionService.getActiveSubscriptions(appId, req.user._id);
  const hasActivePackage = activeSubscriptions.some(sub => 
    sub.package._id.toString() === packageId
  );

  if (hasActivePackage) {
    return next(new AppError('Abonnement actif existant', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // ← Récupérer l'user complet depuis la base
  const fullUser = await User.findById(req.user._id).lean();
  
  if (!fullUser) {
    return next(new AppError('Utilisateur non trouvé', 404, ErrorCodes.NOT_FOUND));
  }

  console.log('=== USER COMPLET ===');
  console.log('Email:', fullUser.email);
  console.log('FirstName:', fullUser.firstName);
  console.log('LastName:', fullUser.lastName);
  console.log('Pseudo:', fullUser.pseudo);

  const result = await fedapayService.initiatePayment(
    appId,
    currentApp,
    req.user._id,
    packageId,
    fullUser // ← Passer l'user complet
  );

  res.status(201).json({
    success: true,
    message: 'Paiement initié avec succès',
    data: {
      transaction: {
        transactionId: result.transaction.transactionId,
        amount: result.transaction.amount,
        currency: result.transaction.currency,
        status: result.transaction.status,
        customerName: result.transaction.customerName,
        package: result.transaction.package
      },
      paymentUrl: result.paymentUrl
    }
  });
});

/**
 * Vérifier le statut
 */
exports.checkStatus = catchAsync(async (req, res, next) => {
  const { transactionId } = req.params;
  const appId = req.appId;
  const currentApp = req.currentApp;

  if (!appId || !currentApp) {
    return next(new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR));
  }

  if (!currentApp?.payments?.fedapay?.enabled) {
    return next(new AppError('FedaPay non activé', 400, ErrorCodes.VALIDATION_ERROR));
  }

  const transaction = await fedapayService.checkTransactionStatus(appId, currentApp, transactionId);

  if (transaction.user._id.toString() !== req.user._id.toString()) {
    return next(new AppError('Transaction non autorisée', 403, ErrorCodes.UNAUTHORIZED));
  }

  let subscription = null;
  try {
    subscription = await paymentMiddleware.processTransactionUpdate(appId, transaction);
  } catch (error) {
    console.error('Error processing transaction:', error.message);
  }

  res.status(200).json({
    success: true,
    data: {
      transaction: {
        transactionId: transaction.transactionId,
        status: transaction.status,
        amount: transaction.amount,
        currency: transaction.currency,
        paymentMethod: transaction.paymentMethod,
        processed: transaction.processed,
        createdAt: transaction.createdAt,
        package: transaction.package
      },
      subscription: subscription ? {
        id: subscription._id,
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        status: subscription.status
      } : null
    }
  });
});

/**
 * Webhook FedaPay
 */

exports.webhook = catchAsync(async (req, res, next) => {
  console.log('=== WEBHOOK FEDAPAY ===');
  console.log('Body:', JSON.stringify(req.body));

  const { id, status } = req.body;

  if (!id) {
    return next(new AppError('Transaction ID requis', 400, ErrorCodes.VALIDATION_ERROR));
  }

  try {
    const FedapayTransaction = require('../../models/user/FedapayTransaction');
    
    const transaction = await FedapayTransaction.findOne({ operatorTransactionId: id })
      .populate(['package', 'user']);

    if (!transaction) {
      console.error(`[Webhook FedaPay] Transaction ${id} non trouvée`);
      return res.status(200).json({
        success: false,
        message: 'Transaction non trouvée'
      });
    }

    const appId = transaction.appId;
    const currentApp = await App.findOne({ appId, isActive: true }).lean();

    if (!currentApp?.payments?.fedapay?.enabled) {
      console.error(`[Webhook FedaPay] FedaPay non activé pour ${appId}`);
      return res.status(200).json({
        success: false,
        message: 'FedaPay non activé'
      });
    }

    // Vérification signature (optionnel)
    const webhookSecret = currentApp.payments.fedapay.webhookSecret;
    if (webhookSecret && req.headers['x-fedapay-signature']) {
      const signature = req.headers['x-fedapay-signature'];
      const computedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(JSON.stringify(req.body))
        .digest('hex');

      if (signature !== computedSignature) {
        console.error('[Webhook FedaPay] Signature invalide');
        return res.status(401).json({
          success: false,
          message: 'Signature invalide'
        });
      }
    }

    transaction.status = status;
    transaction.webhookData = req.body;
    await transaction.save();

    console.log(`[Webhook FedaPay] Transaction ${id} updated to: ${status}`);

    await paymentMiddleware.processTransactionUpdate(appId, transaction);

    res.status(200).json({
      success: true,
      message: 'Webhook traité'
    });

  } catch (error) {
    console.error('Webhook error:', error.message);
    res.status(200).json({
      success: false,
      message: 'Erreur webhook',
      error: error.message
    });
  }
});

/**
 * Page de retour
 */
exports.paymentSuccess = catchAsync(async (req, res, next) => {
  const { transaction_id } = req.method === 'GET' ? req.query : req.body;

  if (!transaction_id) {
    return res.status(400).send(getHtmlTemplate('FedaPay - Erreur', `
      <div class="icon">❌</div>
      <h1 class="error">Erreur</h1>
      <p>Paramètres manquants</p>
    `));
  }

  const FedapayTransaction = require('../../models/user/FedapayTransaction');
  const transactionForApp = await FedapayTransaction.findOne({ transactionId: transaction_id });

  if (!transactionForApp) {
    return res.status(404).send(getHtmlTemplate('FedaPay - Erreur', `
      <div class="icon">❌</div>
      <h1 class="error">Transaction non trouvée</h1>
    `));
  }

  const appId = transactionForApp.appId;
  const currentApp = await App.findOne({ appId, isActive: true }).lean();

  if (!currentApp?.payments?.fedapay?.enabled) {
    return res.status(400).send(getHtmlTemplate('FedaPay - Erreur', `
      <div class="icon">❌</div>
      <h1 class="error">FedaPay non activé</h1>
    `));
  }

  let transactionStatus;
  let errorOccurred = false;

  try {
    transactionStatus = await fedapayService.checkTransactionStatus(appId, currentApp, transaction_id);
    await paymentMiddleware.processTransactionUpdate(appId, transactionStatus);
  } catch (error) {
    console.error('FedaPay - Erreur vérification:', error.message);
    errorOccurred = true;
  }

  let content;

  if (errorOccurred) {
    content = `
      <div class="icon">⏳</div>
      <h1 class="warning">Vérification en cours</h1>
      <p>Vérification du paiement...</p>
      <div class="transaction-id">${transaction_id}</div>
    `;
  } else if (transactionStatus.status === 'approved') {
    content = `
      <div class="icon">🎉</div>
      <h1 class="success">Paiement Réussi !</h1>
      <div class="status-badge status-success">✅ Confirmé</div>
      <p>Abonnement <strong>${transactionStatus.package.name.fr}</strong> activé</p>
      <div class="details">
        <p><strong>Transaction:</strong> <span class="transaction-id">${transaction_id}</span></p>
        <p><strong>Montant:</strong> <span class="amount">${transactionStatus.amount} ${transactionStatus.currency}</span></p>
        <p><strong>Durée:</strong> ${transactionStatus.package.duration} jours</p>
      </div>
    `;
  } else if (transactionStatus.status === 'declined' || transactionStatus.status === 'canceled') {
    content = `
      <div class="icon">❌</div>
      <h1 class="error">Paiement Échoué</h1>
      <div class="status-badge status-error">❌ Refusé</div>
      <div class="transaction-id">${transaction_id}</div>
      <p>Veuillez réessayer</p>
    `;
  } else {
    content = `
      <div class="icon">⏳</div>
      <h1 class="pending">En Attente</h1>
      <div class="status-badge status-pending">⏳ En cours</div>
      <div class="transaction-id">${transaction_id}</div>
    `;
  }

  return res.send(getHtmlTemplate('FedaPay', content));
});

const getMobileOptimizedCSS = () => `
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .container {
      background: white;
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.15);
      width: 100%;
      max-width: 400px;
      padding: 24px;
      text-align: center;
      animation: slideUp 0.3s ease-out;
    }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    h1 { font-size: 1.5rem; margin-bottom: 16px; font-weight: 600; }
    p { font-size: 0.95rem; color: #666; margin-bottom: 12px; }
    .success { color: #10b981; }
    .error { color: #ef4444; }
    .warning { color: #f59e0b; }
    .pending { color: #6366f1; }
    .details {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 16px;
      margin: 20px 0;
      text-align: left;
    }
    .details p { margin-bottom: 8px; font-size: 0.9rem; color: #374151; }
    .icon { font-size: 2rem; margin-bottom: 12px; }
    .transaction-id {
      font-family: 'Courier New', monospace;
      background: #f1f5f9;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 0.85rem;
      color: #475569;
      display: inline-block;
      margin: 8px 0;
    }
    .amount { font-size: 1.1rem; font-weight: 600; color: #1f2937; }
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.8rem;
      font-weight: 500;
      margin: 8px 0;
    }
    .status-success { background: #d1fae5; color: #065f46; }
    .status-error { background: #fee2e2; color: #991b1b; }
    .status-pending { background: #e0e7ff; color: #3730a3; }
  </style>
`;

const getHtmlTemplate = (title, content) => `
  <!DOCTYPE html>
  <html lang="fr">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    ${getMobileOptimizedCSS()}
  </head>
  <body>
    <div class="container">${content}</div>
  </body>
  </html>
`;

module.exports = {
  initiatePayment: exports.initiatePayment,
  checkStatus: exports.checkStatus,
  webhook: exports.webhook,
  paymentSuccess: exports.paymentSuccess
};