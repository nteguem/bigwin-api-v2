/**
 * @fileoverview KoraPay Payment Controller
 * Gestion des paiements via KoraPay (Nigeria, Ghana, Kenya, etc.)
 */

const korapayService = require('../../services/user/KorapayService');
const KorapayTransaction = require('../../models/user/KorapayTransaction');
const paymentMiddleware = require('../../middlewares/payment/paymentMiddleware');
const App = require('../../models/common/App');
const logger = require('../../../core/logger');

const SERVICE = 'korapay';

/**
 * Initier un paiement KoraPay
 * POST /api/payments/korapay/initiate
 */
exports.initiatePayment = async (req, res) => {
  try {
    const { packageId, currency, phone, merchantBearsCost } = req.body;
    const { appId, currentApp } = req;
    const userId = req.user._id;

    // 1. Validation basique
    if (!appId || !currentApp) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Application non identifiée'
        }
      });
    }

    // 2. Vérifier que KoraPay est activé
    if (!currentApp.payments?.korapay?.enabled) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'PROVIDER_DISABLED',
          message: 'KoraPay n\'est pas activé pour cette application'
        }
      });
    }

    // 3. Vérifier qu'il n'y a pas déjà un abonnement actif pour ce package
    const Subscription = require('../../models/common/Subscription');
    const existingSubscription = await Subscription.findOne({
      appId,
      user: userId,
      package: packageId,
      status: 'active',
      endDate: { $gt: new Date() }
    });

    if (existingSubscription) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'ACTIVE_SUBSCRIPTION_EXISTS',
          message: 'Vous avez déjà un abonnement actif pour ce package'
        }
      });
    }

    // 4. Auto-populate name/email si non fourni
    const customerName = req.body.customerName || req.user.name || `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || 'User';
    const customerEmail = req.body.customerEmail || req.user.email || `user_${userId}@temp.app`;
    const customerPhone = phone || req.user.phone;

    // 5. Appeler le service KoraPay
    const result = await korapayService.initiatePayment(
      appId,
      currentApp,
      userId,
      packageId,
      currency,
      customerName,
      customerEmail,
      customerPhone,
      merchantBearsCost
    );

    return res.status(200).json({
      success: true,
      message: 'Paiement initié avec succès',
      data: result
    });

  } catch (error) {
    req.log.error('initiatePayment: failed', {
      service: SERVICE,
      category: 'initiate',
      message: error.message,
      stack: error.stack,
    });

    // Gérer les erreurs spécifiques
    if (error.name === 'KorapayError') {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: {
          code: error.message,
          message: error.message,
          details: error.responseData
        }
      });
    }

    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message
      }
    });
  }
};

/**
 * Initier un paiement Mobile Money
 * POST /api/payments/korapay/mobile-money
 */
exports.initiateMobileMoneyPayment = async (req, res) => {
  try {
    const { packageId, currency, mobileNumber, merchantBearsCost } = req.body;
    const { appId, currentApp } = req;
    const userId = req.user._id;

    // 1. Validation
    if (!appId || !currentApp) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Application non identifiée'
        }
      });
    }

    if (!mobileNumber) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Numéro de téléphone mobile requis'
        }
      });
    }

    // 2. Vérifier que KoraPay est activé
    if (!currentApp.payments?.korapay?.enabled) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'PROVIDER_DISABLED',
          message: 'KoraPay n\'est pas activé'
        }
      });
    }

    // 3. Auto-populate
    const customerName = req.body.customerName || req.user.name || `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || 'User';
    const customerEmail = req.body.customerEmail || req.user.email || `user_${userId}@temp.app`;

    // 4. Appeler service
    const result = await korapayService.initiateMobileMoneyPayment(
      appId,
      currentApp,
      userId,
      packageId,
      currency,
      mobileNumber,
      customerName,
      customerEmail,
      merchantBearsCost
    );

    return res.status(200).json({
      success: true,
      message: 'Paiement Mobile Money initié',
      data: result
    });

  } catch (error) {
    req.log.error('initiateMobileMoney: failed', {
      service: SERVICE,
      category: 'initiateMobileMoney',
      message: error.message,
      stack: error.stack,
    });

    if (error.name === 'KorapayError') {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: {
          code: error.message,
          message: error.message,
          details: error.responseData
        }
      });
    }

    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message
      }
    });
  }
};

/**
 * Vérifier le statut d'une transaction (protected)
 * GET /api/payments/korapay/status/:reference
 */
exports.checkTransactionStatus = async (req, res) => {
  try {
    const { reference } = req.params;
    const { appId, currentApp } = req;
    const userId = req.user._id;

    // 1. Trouver la transaction
    const transaction = await KorapayTransaction.findOne({
      appId,
      $or: [
        { transactionId: reference },
        { reference: reference },
        { korapayReference: reference }
      ]
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Transaction non trouvée'
        }
      });
    }

    // 2. Vérifier que la transaction appartient à l'utilisateur
    if (transaction.user.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Accès non autorisé à cette transaction'
        }
      });
    }

    // 3. Vérifier le statut auprès de KoraPay
    const updatedTransaction = await korapayService.checkTransactionStatus(
      appId,
      currentApp,
      reference
    );

    // 4. Traiter si succès et non traité
    let subscription = null;
    if (updatedTransaction.isSuccessful() && !updatedTransaction.processed) {
      subscription = await paymentMiddleware.processTransactionUpdate(appId, updatedTransaction);
    }

    return res.status(200).json({
      success: true,
      message: 'Statut de la transaction récupéré',
      data: {
        transaction: updatedTransaction,
        subscription
      }
    });

  } catch (error) {
    req.log.error('checkTransactionStatus: failed', {
      service: SERVICE,
      category: 'checkStatus',
      message: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message
      }
    });
  }
};

/**
 * Webhook KoraPay (public - NO X-App-Id required)
 * POST /api/payments/korapay/webhook
 */
exports.webhook = async (req, res) => {
  try {
    const signature = req.headers['x-korapay-signature'];
    const webhookBody = req.body;

    const paymentReference = webhookBody?.data?.payment_reference;

    req.log.info('webhook: received', {
      service: SERVICE, category: 'webhook', paymentReference, hasSignature: !!signature,
    });

    if (!paymentReference) {
      req.log.warn('webhook: payment_reference missing', {
        service: SERVICE, category: 'webhook',
      });
      return res.status(400).json({ success: false, message: 'Invalid webhook data' });
    }

    const transaction = await KorapayTransaction.findOne({
      $or: [
        { transactionId: paymentReference },
        { reference: paymentReference },
        { korapayReference: paymentReference }
      ]
    });

    if (!transaction) {
      req.log.warn('webhook: transaction not found', {
        service: SERVICE, category: 'webhook', paymentReference,
      });
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    const app = await App.findOne({ appId: transaction.appId });

    if (!app) {
      req.log.error('webhook: app not found', {
        service: SERVICE, category: 'webhook',
        paymentReference, appId: transaction.appId,
      });
      return res.status(404).json({ success: false, message: 'App not found' });
    }

    const config = korapayService.getConfig(app);
    const isValidSignature = korapayService.verifyWebhookSignature(
      signature,
      webhookBody.data,
      config.secretKey
    );

    if (!isValidSignature) {
      // FATAL : tentative de fraude webhook.
      req.log.fatal('webhook: signature invalid', {
        service: SERVICE, category: 'webhook.signature',
        paymentReference, appId: transaction.appId,
      });
      return res.status(401).json({ success: false, message: 'Invalid signature' });
    }

    await transaction.recordWebhook(webhookBody);

    if (transaction.isSuccessful() && !transaction.processed) {
      await paymentMiddleware.processTransactionUpdate(transaction.appId, transaction);
    }

    req.log.info('webhook: transaction updated', {
      service: SERVICE, category: 'webhook',
      paymentReference, appId: transaction.appId,
      status: transaction.status, processed: transaction.processed,
    });

    return res.status(200).json({
      success: true,
      message: 'Webhook processed successfully'
    });

  } catch (error) {
    req.log.error('webhook: processing failed', {
      service: SERVICE, category: 'webhook',
      message: error.message, stack: error.stack,
    });

    return res.status(200).json({
      success: true,
      message: 'Webhook received'
    });
  }
};

/**
 * Callback après paiement (public - NO X-App-Id required)
 * GET /api/payments/korapay/callback
 */
exports.callback = async (req, res) => {
  try {
    const { reference } = req.query;

    if (!reference) {
      return res.status(400).send(renderHTML('ERROR', 'Missing reference'));
    }

    const transaction = await KorapayTransaction.findOne({
      $or: [
        { transactionId: reference },
        { reference: reference },
        { korapayReference: reference }
      ]
    }).populate('package');

    if (!transaction) {
      req.log.warn('callback: transaction not found', {
        service: SERVICE, category: 'callback', reference,
      });
      return res.status(404).send(renderHTML('ERROR', 'Transaction not found'));
    }

    const app = await App.findOne({ appId: transaction.appId });

    if (!app) {
      req.log.error('callback: app not found', {
        service: SERVICE, category: 'callback', reference, appId: transaction.appId,
      });
      return res.status(404).send(renderHTML('ERROR', 'Application not found'));
    }

    const updatedTransaction = await korapayService.checkTransactionStatus(
      transaction.appId,
      app,
      reference
    );

    if (updatedTransaction.isSuccessful() && !updatedTransaction.processed) {
      await paymentMiddleware.processTransactionUpdate(transaction.appId, updatedTransaction);
    }

    req.log.info('callback: processed', {
      service: SERVICE, category: 'callback',
      reference, appId: transaction.appId, status: updatedTransaction.status,
    });

    const html = renderHTML(updatedTransaction.status, updatedTransaction);

    return res.send(html);

  } catch (error) {
    req.log.error('callback: failed', {
      service: SERVICE, category: 'callback',
      message: error.message, stack: error.stack,
    });
    return res.status(500).send(renderHTML('ERROR', 'Server error occurred'));
  }
};

/**
 * Generate HTML response for callback page
 */
function renderHTML(status, transaction) {
  const statusConfig = {
    SUCCESS: {
      icon: '✓',
      color: '#10b981',
      title: 'Payment Successful',
      message: 'Your payment has been confirmed. Your subscription is now active.'
    },
    PROCESSING: {
      icon: '⏳',
      color: '#f59e0b',
      title: 'Payment Processing',
      message: 'Your payment is being processed. This may take a few moments.'
    },
    FAILED: {
      icon: '✗',
      color: '#ef4444',
      title: 'Payment Failed',
      message: 'The payment failed. Please try again.'
    },
    CANCELLED: {
      icon: '⊗',
      color: '#6b7280',
      title: 'Payment Cancelled',
      message: 'The payment was cancelled.'
    },
    PENDING: {
      icon: '⋯',
      color: '#3b82f6',
      title: 'Payment Pending',
      message: 'Your payment is pending confirmation.'
    },
    ERROR: {
      icon: '⚠',
      color: '#dc2626',
      title: 'Error',
      message: typeof transaction === 'string' ? transaction : 'An error occurred.'
    }
  };

  const config = statusConfig[status] || statusConfig.ERROR;
  const details = typeof transaction === 'object' && transaction.transactionId ? transaction : null;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${config.title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 20px;
      padding: 40px;
      max-width: 500px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      text-align: center;
      animation: slideUp 0.4s ease-out;
    }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .icon {
      width: 80px;
      height: 80px;
      margin: 0 auto 24px;
      border-radius: 50%;
      background: ${config.color}15;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 48px;
      color: ${config.color};
      font-weight: bold;
    }
    h1 {
      font-size: 28px;
      color: #1f2937;
      margin-bottom: 12px;
      font-weight: 700;
    }
    .message {
      font-size: 16px;
      color: #6b7280;
      line-height: 1.6;
      margin-bottom: 24px;
    }
    .details {
      background: #f9fafb;
      border-radius: 12px;
      padding: 20px;
      margin: 24px 0;
      text-align: left;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid #e5e7eb;
    }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { 
      color: #6b7280; 
      font-size: 14px;
      font-weight: 500;
    }
    .detail-value { 
      color: #1f2937; 
      font-weight: 600; 
      font-size: 14px;
      text-align: right;
    }
    .badge {
      display: inline-block;
      padding: 6px 16px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      background: ${config.color}15;
      color: ${config.color};
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .footer {
      font-size: 14px;
      color: #9ca3af;
      margin-top: 32px;
      padding-top: 24px;
      border-top: 1px solid #e5e7eb;
    }
    .close-btn {
      display: inline-block;
      margin-top: 16px;
      padding: 12px 32px;
      background: ${config.color};
      color: white;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      transition: all 0.2s;
    }
    .close-btn:hover {
      opacity: 0.9;
      transform: translateY(-2px);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">${config.icon}</div>
    <h1>${config.title}</h1>
    <p class="message">${config.message}</p>
    
    ${details ? `
      <div class="details">
        <div class="detail-row">
          <span class="detail-label">Reference</span>
          <span class="detail-value">${details.transactionId}</span>
        </div>
        ${details.amount ? `
        <div class="detail-row">
          <span class="detail-label">Amount</span>
          <span class="detail-value">${details.amount.toLocaleString()} ${details.currency}</span>
        </div>` : ''}
        ${details.package && details.package.name ? `
        <div class="detail-row">
          <span class="detail-label">Package</span>
          <span class="detail-value">${typeof details.package.name === 'object' ? (details.package.name.en || details.package.name.fr || '') : details.package.name}</span>
        </div>` : ''}
        ${details.paymentMethod && typeof details.paymentMethod === 'string' ? `
        <div class="detail-row">
          <span class="detail-label">Payment Method</span>
          <span class="detail-value">${details.paymentMethod.replace('_', ' ').toUpperCase()}</span>
        </div>` : ''}
        <div class="detail-row">
          <span class="detail-label">Status</span>
          <span class="detail-value"><span class="badge">${status}</span></span>
        </div>
      </div>
    ` : ''}
    
    <div class="footer">
      <p>You can close this window now.</p>
      ${status === 'SUCCESS' ? '<p style="margin-top: 8px;">Your subscription is active!</p>' : ''}
    </div>
  </div>
</body>
</html>
  `;
}

module.exports = exports;