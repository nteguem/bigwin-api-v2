// controllers/user/flutterwaveController.js
const flutterwaveService = require('../../services/user/FlutterwaveService');
const paymentMiddleware = require('../../middlewares/payment/paymentMiddleware');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const catchAsync = require('../../../utils/catchAsync');
const App = require('../../models/common/App');
const logger = require('../../../core/logger');

const SERVICE = 'flutterwave';

/**
 * Initier un paiement Flutterwave Mobile Money
 */
exports.initiatePayment = catchAsync(async (req, res, next) => {
  const { packageId, phoneNumber, currency, network } = req.body;

  const appId = req.appId;
  const currentApp = req.currentApp;

  // Vérifier que appId est présent (obligatoire pour initier un paiement)
  if (!appId || !currentApp) {
    return next(new AppError(
      'Header X-App-Id requis',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }

  // Validation des champs requis
  if (!packageId || !phoneNumber || !currency || !network) {
    return next(new AppError(
      'packageId, phoneNumber, currency et network sont requis',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }

  // Vérifier que Flutterwave est activé pour cette app
  if (!currentApp?.payments?.flutterwave?.enabled) {
    return next(new AppError(
      'Flutterwave n\'est pas activé pour cette application',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }

  // Vérifier si l'utilisateur a déjà un abonnement actif pour ce package DANS CETTE APP
  const subscriptionService = require('../../services/user/subscriptionService');
  const activeSubscriptions = await subscriptionService.getActiveSubscriptions(appId, req.user._id);
  const hasActivePackage = activeSubscriptions.some(sub => 
  sub.package && sub.package._id.toString() === packageId
);

  if (hasActivePackage) {
    return next(new AppError(
      'Vous avez déjà un abonnement actif pour ce package',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }

  // Récupérer automatiquement les données utilisateur
  const customerName = req.user.pseudo || req.user.name || req.user.username || 'Utilisateur';
  const email = req.user.email || '';

  const result = await flutterwaveService.initiatePayment(
    appId,
    currentApp,
    req.user._id,
    packageId,
    phoneNumber,
    customerName,
    email,
    currency,
    network
  );

  res.status(201).json({
    success: true,
    message: 'Paiement initié avec succès',
    data: {
      transaction: {
        transactionId: result.transaction.transactionId,
        chargeId: result.transaction.chargeId,
        amount: result.transaction.amount,
        currency: result.transaction.currency,
        status: result.transaction.status,
        phoneNumber: result.transaction.phoneNumber,
        network: result.transaction.network,
        customerName: result.transaction.customerName,
        package: result.transaction.package
      },
      nextAction: result.nextAction,
      message: getNextActionMessage(result.nextAction)
    }
  });
});

/**
 * Générer un message utilisateur selon le next_action
 */
function getNextActionMessage(nextAction) {
  if (!nextAction) {
    return 'Paiement en cours de traitement';
  }

  if (nextAction.type === 'payment_instruction') {
    return nextAction.payment_instruction?.note || 
           'Veuillez autoriser le paiement sur votre téléphone mobile';
  }

  if (nextAction.type === 'redirect_url') {
    return 'Vous allez être redirigé pour compléter le paiement';
  }

  return 'Paiement en cours de traitement';
}

/**
 * Vérifier le statut d'un paiement
 */
exports.checkStatus = catchAsync(async (req, res, next) => {
  const { transactionId } = req.params;

  const appId = req.appId;
  const currentApp = req.currentApp;

  // Vérifier que appId est présent
  if (!appId || !currentApp) {
    return next(new AppError(
      'Header X-App-Id requis',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }

  // Vérifier que Flutterwave est activé pour cette app
  if (!currentApp?.payments?.flutterwave?.enabled) {
    return next(new AppError(
      'Flutterwave n\'est pas activé pour cette application',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }

  const transaction = await flutterwaveService.checkTransactionStatus(appId, currentApp, transactionId);

  // Vérifier que la transaction appartient à l'utilisateur
  if (transaction.user._id.toString() !== req.user._id.toString()) {
    return next(new AppError('Transaction non autorisée', 403, ErrorCodes.UNAUTHORIZED));
  }

  // Traiter la transaction si le statut a changé
  let subscription = null;
  try {
    subscription = await paymentMiddleware.processTransactionUpdate(appId, transaction);
  } catch (error) {
    req.log.error('checkStatus: processTransactionUpdate failed', {
      service: SERVICE,
      category: 'checkStatus',
      transactionId: transaction.transactionId,
      message: error.message,
      stack: error.stack,
    });
  }

  res.status(200).json({
    success: true,
    data: {
      transaction: {
        transactionId: transaction.transactionId,
        chargeId: transaction.chargeId,
        status: transaction.status,
        amount: transaction.amount,
        currency: transaction.currency,
        network: transaction.network,
        processorResponse: transaction.processorResponse,
        processed: transaction.processed,
        createdAt: transaction.createdAt,
        paymentDate: transaction.paymentDate,
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
 * Webhook Flutterwave
 * Reçoit les notifications de paiement de Flutterwave
 */
exports.webhook = catchAsync(async (req, res, next) => {
  const receivedHash = req.headers['verif-hash'];
  const webhookData = req.body;

  req.log.info('webhook: received', {
    service: SERVICE, category: 'webhook',
    event: webhookData.event, hasSignature: !!receivedHash,
  });

  if (!webhookData.event || !webhookData.data) {
    req.log.warn('webhook: invalid payload', {
      service: SERVICE, category: 'webhook',
    });
    return res.status(400).json({
      success: false,
      message: 'Données webhook invalides'
    });
  }

  const eventType = webhookData.event;
  const eventData = webhookData.data;

  if (eventType !== 'charge.completed') {
    return res.status(200).json({
      success: true,
      message: 'Event type non traité'
    });
  }

  const chargeId = eventData.id;
  const reference = eventData.reference;

  if (!chargeId) {
    req.log.warn('webhook: charge id missing', {
      service: SERVICE, category: 'webhook', reference,
    });
    return res.status(400).json({
      success: false,
      message: 'Charge ID requis'
    });
  }

  try {
    const FlutterwaveTransaction = require('../../models/user/FlutterwaveTransaction');

    const transaction = await FlutterwaveTransaction.findOne({
      $or: [
        { chargeId: chargeId },
        { transactionId: reference }
      ]
    }).populate(['package', 'user']);

    if (!transaction) {
      req.log.warn('webhook: transaction not found', {
        service: SERVICE, category: 'webhook', chargeId, reference,
      });
      return res.status(404).json({
        success: false,
        message: 'Transaction non trouvée'
      });
    }

    const appId = transaction.appId;
    const currentApp = await App.findOne({ appId, isActive: true }).lean();

    if (!currentApp) {
      req.log.error('webhook: app not found', {
        service: SERVICE, category: 'webhook', chargeId, appId,
      });
      return res.status(404).json({
        success: false,
        message: 'Application non trouvée'
      });
    }

    if (!currentApp?.payments?.flutterwave?.enabled) {
      req.log.warn('webhook: flutterwave disabled for app', {
        service: SERVICE, category: 'webhook', chargeId, appId,
      });
      return res.status(400).json({
        success: false,
        message: 'Flutterwave n\'est pas activé pour cette application'
      });
    }

    const config = flutterwaveService.getConfig(currentApp);
    const isValidSignature = flutterwaveService.verifyWebhookSignature(receivedHash, config);

    if (!isValidSignature) {
      // FATAL : signature invalide = potentielle tentative de fraude.
      // Non-bloquant pour l'instant (comportement historique) — à durcir.
      req.log.fatal('webhook: signature invalid', {
        service: SERVICE, category: 'webhook.signature', chargeId, appId,
      });
    }

    transaction.status = flutterwaveService.mapFlutterwaveStatus(eventData.status);
    transaction.processorResponse = eventData.processor_response;
    transaction.webhookSignature = receivedHash;
    transaction.webhookId = webhookData.webhook_id;
    transaction.webhookTimestamp = webhookData.timestamp;
    transaction.webhookEventType = eventType;

    if (eventData.created_datetime) {
      transaction.paymentDate = new Date(eventData.created_datetime);
    }

    transaction.metadata = {
      ...transaction.metadata,
      webhookData: eventData
    };

    await transaction.save();

    req.log.info('webhook: transaction updated', {
      service: SERVICE, category: 'webhook',
      transactionId: transaction.transactionId, appId,
      status: transaction.status, verified: isValidSignature,
    });

    await paymentMiddleware.processTransactionUpdate(appId, transaction);

    res.status(200).json({
      success: true,
      message: 'Webhook traité avec succès'
    });

  } catch (error) {
    req.log.error('webhook: processing failed', {
      service: SERVICE,
      category: 'webhook',
      chargeId,
      message: error.message,
      stack: error.stack,
    });

    // IMPORTANT: Toujours retourner 200 pour éviter les retry infinis
    res.status(200).json({
      success: false,
      message: 'Erreur lors du traitement du webhook',
      error: error.message
    });
  }
});

/**
 * Liste des réseaux disponibles par devise
 */
exports.getAvailableNetworks = catchAsync(async (req, res, next) => {
  const { currency } = req.params;

  if (!currency) {
    return next(new AppError('Devise requise', 400, ErrorCodes.VALIDATION_ERROR));
  }

  const currencyUpper = currency.toUpperCase();
  const networks = flutterwaveService.CURRENCY_NETWORKS[currencyUpper];

  if (!networks) {
    return next(new AppError(
      `Devise non supportée: ${currency}`,
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }

  res.status(200).json({
    success: true,
    data: {
      currency: currencyUpper,
      networks: networks,
      countryCode: flutterwaveService.CURRENCY_TO_COUNTRY[currencyUpper]
    }
  });
});

/**
 * Liste des devises supportées
 */
exports.getSupportedCurrencies = catchAsync(async (req, res, next) => {
  const currencies = Object.keys(flutterwaveService.CURRENCY_TO_COUNTRY).map(currency => ({
    currency,
    countryCode: flutterwaveService.CURRENCY_TO_COUNTRY[currency],
    networks: flutterwaveService.CURRENCY_NETWORKS[currency] || []
  }));

  res.status(200).json({
    success: true,
    data: {
      currencies
    }
  });
});

module.exports = {
  initiatePayment: exports.initiatePayment,
  checkStatus: exports.checkStatus,
  webhook: exports.webhook,
  getAvailableNetworks: exports.getAvailableNetworks,
  getSupportedCurrencies: exports.getSupportedCurrencies
};