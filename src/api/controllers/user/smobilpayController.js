// controllers/user/smobilpayController.js
const smobilpayService = require('../../services/user/SmobilpayService');
const paymentMiddleware = require('../../middlewares/payment/paymentMiddleware');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const catchAsync = require('../../../utils/catchAsync');
const App = require('../../models/common/App');

/**
 * Récupérer les services par pays
 */
exports.getServices = catchAsync(async (req, res, next) => {
  const { country } = req.query;

  const currentApp = req.currentApp;

  // Vérifier que appId est présent
  if (!currentApp) {
    return next(new AppError(
      'Header X-App-Id requis',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }

  // Vérifier que Smobilpay est activé pour cette app
  if (!currentApp?.payments?.smobilpay?.enabled) {
    return next(new AppError(
      'Smobilpay n\'est pas activé pour cette application',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }
  
  const services = await smobilpayService.getServices(currentApp, country);
  
  res.status(200).json({
    success: true,
    data: {
      services,
      count: services.length,
      country: country || 'ALL',
      availableCountries: Object.keys(smobilpayService.COUNTRY_MAPPING)
    }
  });
});

/**
 * Initier un paiement 
 */
exports.initiatePayment = catchAsync(async (req, res, next) => {
  const { packageId, serviceId, phoneNumber } = req.body;
  
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
  
  // Validation - seulement 3 champs requis
  if (!packageId || !serviceId || !phoneNumber) {
    return next(new AppError(
      'packageId, serviceId et phoneNumber sont requis',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }

  // Vérifier que Smobilpay est activé pour cette app
  if (!currentApp?.payments?.smobilpay?.enabled) {
    return next(new AppError(
      'Smobilpay n\'est pas activé pour cette application',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }
  
  // Vérifier si l'utilisateur a déjà un abonnement actif pour ce package DANS CETTE APP
  const subscriptionService = require('../../services/user/subscriptionService');
  const activeSubscriptions = await subscriptionService.getActiveSubscriptions(appId, req.user._id);
  const hasActivePackage = activeSubscriptions.some(sub => 
    sub.package._id.toString() === packageId
  );
  
  if (hasActivePackage) {
    return next(new AppError(
      'Vous avez déjà un abonnement actif pour ce package',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }
  
  // Récupérer automatiquement les données de l'utilisateur connecté
  const customerData = {
    phoneNumber,
    customerName: req.user.pseudo || req.user.name || req.user.username || 'Utilisateur',
    email: req.user.email || ''
  };
    
  const transaction = await smobilpayService.initiatePayment(
    appId,
    currentApp,
    req.user._id,
    packageId,
    serviceId,
    customerData
  );
  
  res.status(201).json({
    success: true,
    message: 'Paiement initié avec succès',
    data: {
      transaction: {
        paymentId: transaction.paymentId,
        amount: transaction.amount,
        currency: transaction.currency,
        status: transaction.status,
        operatorName: transaction.operatorName,
        phoneNumber: transaction.phoneNumber,
        customerName: transaction.customerName,
        package: transaction.package
      }
    }
  });
});

/**
 * Vérifier le statut d'un paiement
 */
exports.checkStatus = catchAsync(async (req, res, next) => {
  const { paymentId } = req.params;
  
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

  // Vérifier que Smobilpay est activé pour cette app
  if (!currentApp?.payments?.smobilpay?.enabled) {
    return next(new AppError(
      'Smobilpay n\'est pas activé pour cette application',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }
  
  const transaction = await smobilpayService.checkTransactionStatus(appId, currentApp, paymentId);
  
  // Vérifier que la transaction appartient à l'utilisateur
  if (transaction.user._id.toString() !== req.user._id.toString()) {
    return next(new AppError('Transaction non autorisée', 403, ErrorCodes.UNAUTHORIZED));
  }
  
  // Traiter la transaction si le statut a changé
  let subscription = null;
  try {
    subscription = await paymentMiddleware.processTransactionUpdate(appId, transaction);
  } catch (error) {
    console.error('Error processing transaction update:', error.message);
  }
  
  res.status(200).json({
    success: true,
    data: {
      transaction: {
        paymentId: transaction.paymentId,
        status: transaction.status,
        amount: transaction.amount,
        currency: transaction.currency,
        operatorName: transaction.operatorName,
        processed: transaction.processed,
        receiptNumber: transaction.receiptNumber,
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
 * Webhook pour les notifications Smobilpay
 */
exports.webhook = catchAsync(async (req, res, next) => {
  const { errorCode, status, trid: paymentId } = req.body;

  console.log('=== WEBHOOK SMOBILPAY REÇU ===');
  console.log('Body:', JSON.stringify(req.body));

  if (!paymentId) {
    return next(new AppError('PTN ou paymentId requis', 400, ErrorCodes.VALIDATION_ERROR));
  }
  
  try {
    const SmobilpayTransaction = require('../../models/user/SmobilpayTransaction');
    
    // Chercher la transaction SANS filtrer par appId (on ne l'a pas encore)
    const transaction = await SmobilpayTransaction.findOne({ paymentId })
      .populate(['package', 'user']);
    
    if (!transaction) {
      console.error(`[Webhook Smobilpay] Transaction ${paymentId} non trouvée`);
      return next(new AppError('Transaction non trouvée', 404, ErrorCodes.NOT_FOUND));
    }

    // Récupérer l'appId depuis la transaction
    const appId = transaction.appId;
    console.log(`[Webhook Smobilpay] AppId récupéré depuis transaction: ${appId}`);

    // Récupérer l'app depuis la base de données
    const currentApp = await App.findOne({ appId, isActive: true }).lean();

    if (!currentApp) {
      console.error(`[Webhook Smobilpay] App ${appId} non trouvée`);
      return next(new AppError('Application non trouvée', 404, ErrorCodes.NOT_FOUND));
    }

    // Vérifier que Smobilpay est activé pour cette app
    if (!currentApp?.payments?.smobilpay?.enabled) {
      console.error(`[Webhook Smobilpay] Smobilpay non activé pour app ${appId}`);
      return next(new AppError(
        'Smobilpay n\'est pas activé pour cette application',
        400,
        ErrorCodes.VALIDATION_ERROR
      ));
    }
    
    // Mettre à jour le statut si différent
    if (transaction.status !== status) {
      transaction.status = status;
      transaction.errorCode = errorCode || null;
      await transaction.save();
      console.log(`[Webhook Smobilpay] Transaction ${paymentId} updated to status: ${transaction.status}`);
      
      await paymentMiddleware.processTransactionUpdate(appId, transaction);
    }
    
    res.status(200).json({
      success: true,
      message: 'Webhook traité avec succès'
    });
  } catch (error) {
    console.error('Webhook processing error:', error.message);
    console.error('Error stack:', error.stack);
    
    res.status(200).json({
      success: false,
      message: 'Erreur lors du traitement du webhook',
      error: error.message
    });
  }
});

module.exports = {
  getServices: exports.getServices,
  initiatePayment: exports.initiatePayment,
  checkStatus: exports.checkStatus,
  webhook: exports.webhook
};