// controllers/user/afribaPayController.js
const afribaPayService = require('../../services/user/AfribaPayService');
const paymentMiddleware = require('../../middlewares/payment/paymentMiddleware');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const catchAsync = require('../../../utils/catchAsync');
const App = require('../../models/common/App');

/**
 * Récupérer les pays et opérateurs
 */
exports.getCountries = catchAsync(async (req, res, next) => {
  const { country } = req.query;
  
  const data = afribaPayService.getCountriesData(country);
  
  res.status(200).json({
    success: true,
    data: country ? {
      country: data.country,
      availableCountries: Object.keys(afribaPayService.getCountriesData().countries)
    } : {
      countries: data.countries,
      availableCountries: Object.keys(data.countries)
    }
  });
});

/**
 * Vérifier si OTP est requis pour un opérateur
 */
exports.checkOtpRequirement = catchAsync(async (req, res, next) => {
  const { operator, country } = req.query;

  if (!operator || !country) {
    return next(new AppError(
      'operator et country sont requis',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }

  const otpRequired = afribaPayService.isOtpRequired(operator, country);

  res.status(200).json({
    success: true,
    data: {
      operator,
      country,
      otpRequired,
      message: otpRequired ? 'Code OTP requis pour cet opérateur' : 'Paiement direct sans OTP'
    }
  });
});

/**
 * Initier un paiement AfribaPay
 */
exports.initiatePayment = catchAsync(async (req, res, next) => {
  const { packageId, phoneNumber, operator, country, currency, otpCode } = req.body;

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

  // Validation de base
  if (!packageId || !phoneNumber || !operator || !country || !currency) {
    return next(new AppError(
      'packageId, phoneNumber, operator, country et currency sont requis',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }

  // Vérifier que AfribaPay est activé pour cette app
  if (!currentApp?.payments?.afribapay?.enabled) {
    return next(new AppError(
      'AfribaPay n\'est pas activé pour cette application',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }

  // Vérifier abonnement actif POUR CETTE APP
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

  try {
    const result = await afribaPayService.initiatePayment(
      appId,
      currentApp,
      req.user._id,
      packageId,
      phoneNumber,
      operator,
      country,
      currency,
      otpCode
    );

    res.status(201).json({
      success: true,
      message: 'Paiement initié avec succès',
      data: {
        transaction: {
          transactionId: result.transaction.transactionId,
          orderId: result.transaction.orderId,
          amount: result.transaction.amount,
          currency: result.transaction.currency,
          status: result.transaction.status,
          operator: result.transaction.operator,
          country: result.transaction.country,
          phoneNumber: result.transaction.phoneNumber,
          providerId: result.transaction.providerId,
          package: result.transaction.package
        }
      }
    });

  } catch (error) {
    // Gestion spéciale pour erreur OTP
    if (error instanceof afribaPayService.AfribaPayError && error.responseData?.code === 'OTP_REQUIRED') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'OTP_REQUIRED',
          message: error.message,
          details: {
            operator: error.responseData.operator,
            country: error.responseData.country,
            currency: error.responseData.currency,
            requiresOtp: true
          }
        }
      });
    }

    // Gestion des erreurs AfribaPay API
    if (error instanceof afribaPayService.AfribaPayError) {
      return res.status(error.statusCode || 400).json({
        success: false,
        error: {
          code: 'AFRIBAPAY_ERROR',
          message: error.message,
          details: error.responseData
        }
      });
    }

    // Autres erreurs
    throw error;
  }
});

/**
 * Vérifier le statut d'un paiement
 */
exports.checkStatus = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;

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

  // Vérifier que AfribaPay est activé pour cette app
  if (!currentApp?.payments?.afribapay?.enabled) {
    return next(new AppError(
      'AfribaPay n\'est pas activé pour cette application',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }

  const transaction = await afribaPayService.checkTransactionStatus(appId, currentApp, orderId);

  if (transaction.user._id.toString() !== req.user._id.toString()) {
    return next(new AppError('Transaction non autorisée', 403, ErrorCodes.UNAUTHORIZED));
  }

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
        transactionId: transaction.transactionId,
        orderId: transaction.orderId,
        status: transaction.status,
        amount: transaction.amount,
        currency: transaction.currency,
        operator: transaction.operator,
        country: transaction.country,
        operatorId: transaction.operatorId,
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
 * Webhook AfribaPay
 */
exports.webhook = catchAsync(async (req, res, next) => {
  const receivedSignature = req.headers['x-signature'];
  const { order_id: orderId, status } = req.body;
  const rawPayload = JSON.stringify(req.body);

  console.log('=== WEBHOOK AFRIBAPAY REÇU ===');
  console.log('Body:', JSON.stringify(req.body));
  
  if (!orderId) {
    return next(new AppError('Order ID requis', 400, ErrorCodes.VALIDATION_ERROR));
  }

  try {
    const AfribaPayTransaction = require('../../models/user/AfribaPayTransaction');
    
    // Chercher la transaction SANS filtrer par appId (on ne l'a pas encore)
    const transaction = await AfribaPayTransaction.findOne({ orderId })
      .populate(['package', 'user']);

    if (!transaction) {
      console.error(`[Webhook AfribaPay] Transaction ${orderId} non trouvée`);
      return next(new AppError('Transaction non trouvée', 404, ErrorCodes.NOT_FOUND));
    }

    // Récupérer l'appId depuis la transaction
    const appId = transaction.appId;
    console.log(`[Webhook AfribaPay] AppId récupéré depuis transaction: ${appId}`);

    // Récupérer l'app depuis la base de données
    const currentApp = await App.findOne({ appId, isActive: true }).lean();

    if (!currentApp) {
      console.error(`[Webhook AfribaPay] App ${appId} non trouvée`);
      return next(new AppError('Application non trouvée', 404, ErrorCodes.NOT_FOUND));
    }

    // Vérifier que AfribaPay est activé pour cette app
    if (!currentApp?.payments?.afribapay?.enabled) {
      console.error(`[Webhook AfribaPay] AfribaPay non activé pour app ${appId}`);
      return next(new AppError(
        'AfribaPay n\'est pas activé pour cette application',
        400,
        ErrorCodes.VALIDATION_ERROR
      ));
    }

    // Récupérer la config pour vérifier la signature
    const config = afribaPayService.getConfig(currentApp);

    if (config.apiKey && receivedSignature) {
      const isValidSignature = afribaPayService.verifyHmacToken(receivedSignature, rawPayload, config.apiKey);
      if (!isValidSignature) {
        console.warn('AfribaPay - Invalid HMAC signature');
      }
      transaction.webhookVerified = isValidSignature;
    } else {
      transaction.webhookVerified = false;
    }

    transaction.status = status;
    transaction.webhookReceived = true;
    transaction.webhookData = req.body;
    transaction.webhookSignature = receivedSignature;

    if (req.body.operator_id) transaction.operatorId = req.body.operator_id;
    if (req.body.status_date) transaction.statusDate = new Date(req.body.status_date);
    if (req.body.amount) transaction.amount = req.body.amount;
    if (req.body.amount_total) transaction.amountTotal = req.body.amount_total;

    await transaction.save();
    console.log(`[Webhook AfribaPay] Transaction ${orderId} updated to status: ${transaction.status}`);
    
    await paymentMiddleware.processTransactionUpdate(appId, transaction);

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
  getCountries: exports.getCountries,
  checkOtpRequirement: exports.checkOtpRequirement,
  initiatePayment: exports.initiatePayment,
  checkStatus: exports.checkStatus,
  webhook: exports.webhook
};