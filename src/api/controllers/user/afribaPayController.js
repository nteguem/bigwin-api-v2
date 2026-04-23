// controllers/user/afribaPayController.js
const afribaPayService = require('../../services/user/AfribaPayService');
const paymentMiddleware = require('../../middlewares/payment/paymentMiddleware');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const catchAsync = require('../../../utils/catchAsync');
const App = require('../../models/common/App');
const logger = require('../../../core/logger');

const SERVICE = 'afribapay';

/**
 * Récupérer les pays et opérateurs.
 *
 * Préfère l'API live AfribaPay (cache 1h en mémoire serveur) pour rester
 * synchronisé avec les opérateurs réellement supportés, avec fallback sur
 * le fichier JSON local si l'API est down.
 */
exports.getCountries = catchAsync(async (req, res, next) => {
  const { country } = req.query;
  const currentApp = req.currentApp;

  // Passer l'app pour que le service puisse utiliser sa config AfribaPay
  // (token, apiUrl) pour taper /v1/countries.
  const data = await afribaPayService.getCountriesDataAsync(currentApp, country);

  // Liste complète des codes pays disponibles (pour le dropdown mobile)
  const fullList = country
    ? await afribaPayService.getCountriesDataAsync(currentApp)
    : data;

  res.status(200).json({
    success: true,
    data: country ? {
      country: data.country,
      availableCountries: Object.keys(fullList.countries)
    } : {
      countries: data.countries,
      availableCountries: Object.keys(data.countries)
    }
  });
});

/**
 * Déclencher l'envoi d'un OTP pour un wallet (Coris, LigdiCash, etc.).
 *
 * Étape 1 du flow 2-step pour les wallets. Le user reçoit un SMS avec un
 * code, qu'il doit ensuite passer à /initiate via le champ `otpCode`.
 */
exports.requestOtp = catchAsync(async (req, res, next) => {
  const { packageId, phoneNumber, operator, country, currency } = req.body;
  const appId = req.appId;
  const currentApp = req.currentApp;

  if (!appId || !currentApp) {
    return next(new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR));
  }

  if (!packageId || !phoneNumber || !operator || !country || !currency) {
    return next(new AppError(
      'packageId, phoneNumber, operator, country et currency sont requis',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }

  if (!currentApp?.payments?.afribapay?.enabled) {
    return next(new AppError(
      'AfribaPay n\'est pas activé pour cette application',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }

  try {
    const result = await afribaPayService.requestWalletOtp(
      appId, currentApp, packageId, phoneNumber, operator, country, currency
    );

    res.status(200).json({
      success: true,
      message: result.message,
      data: { status: result.status }
    });
  } catch (error) {
    if (error instanceof afribaPayService.AfribaPayError) {
      return res.status(error.statusCode || 400).json({
        success: false,
        error: {
          code: 'AFRIBAPAY_OTP_ERROR',
          message: error.message,
          details: error.responseData
        }
      });
    }
    throw error;
  }
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
  sub.package && sub.package._id.toString() === packageId
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
          // providerLink : URL de checkout externe renvoyée par certains
          // opérateurs (Wave notamment). Le mobile l'ouvre si présent.
          // Null pour les opérateurs classiques (MTN, Moov, Orange...).
          providerLink: result.transaction.providerLink || null,
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
    req.log.error('checkStatus: processTransactionUpdate failed', {
      service: SERVICE,
      category: 'checkStatus',
      orderId: transaction.orderId,
      message: error.message,
      stack: error.stack,
    });
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
  // Header officiel AfribaPay = "Afribapay-Sign" (cf. doc Postman).
  // Express met les headers en lowercase, donc on lit `afribapay-sign`.
  // Fallback sur `x-signature` pour compat historique si AfribaPay en
  // envoyait un des deux selon l'environnement. Non-bloquant : on vérifie
  // la signature à titre informatif (flag `webhookVerified` en BD) mais
  // on continue de traiter le webhook comme avant.
  const receivedSignature = req.headers['afribapay-sign']
    || req.headers['x-signature'];

  // Le raw body (non-re-sérialisé) est capturé par express.json({verify})
  // dans app.js. Indispensable pour HMAC-SHA256 qui exige le payload
  // byte-for-byte tel que reçu. Avant, `JSON.stringify(req.body)` ré-
  // ordonnait les clés → la HMAC ne matchait jamais la signature.
  // Fallback sur JSON.stringify si rawBody absent (dégradation gracieuse).
  const rawPayload = req.rawBody || JSON.stringify(req.body);

  const { order_id: orderId, status } = req.body;

  // On log uniquement les champs non-PII. `req.body` contient phone / user
  // potentiellement → le détail part dans le context masqué par le sanitizer.
  req.log.info('webhook: received', {
    service: SERVICE,
    category: 'webhook',
    orderId,
    status,
    hasSignature: !!receivedSignature,
  });

  if (!orderId) {
    return next(new AppError('Order ID requis', 400, ErrorCodes.VALIDATION_ERROR));
  }

  try {
    const AfribaPayTransaction = require('../../models/user/AfribaPayTransaction');

    // Chercher la transaction SANS filtrer par appId (on ne l'a pas encore)
    const transaction = await AfribaPayTransaction.findOne({ orderId })
      .populate(['package', 'user']);

    if (!transaction) {
      req.log.warn('webhook: transaction not found', {
        service: SERVICE,
        category: 'webhook',
        orderId,
      });
      return next(new AppError('Transaction non trouvée', 404, ErrorCodes.NOT_FOUND));
    }

    const appId = transaction.appId;

    const currentApp = await App.findOne({ appId, isActive: true }).lean();

    if (!currentApp) {
      req.log.error('webhook: app not found', {
        service: SERVICE,
        category: 'webhook',
        orderId,
        appId,
      });
      return next(new AppError('Application non trouvée', 404, ErrorCodes.NOT_FOUND));
    }

    if (!currentApp?.payments?.afribapay?.enabled) {
      req.log.warn('webhook: afribapay disabled for app', {
        service: SERVICE,
        category: 'webhook',
        orderId,
        appId,
      });
      return next(new AppError(
        'AfribaPay n\'est pas activé pour cette application',
        400,
        ErrorCodes.VALIDATION_ERROR
      ));
    }

    const config = afribaPayService.getConfig(currentApp);

    if (config.apiKey && receivedSignature) {
      const isValidSignature = afribaPayService.verifyHmacToken(receivedSignature, rawPayload, config.apiKey);
      if (!isValidSignature) {
        // FATAL : signature invalide → potentielle tentative de fraude webhook.
        // Doit déclencher un email alert en J2.
        req.log.fatal('webhook: HMAC signature invalid', {
          service: SERVICE,
          category: 'webhook.signature',
          orderId,
          appId,
        });
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

    req.log.info('webhook: transaction updated', {
      service: SERVICE,
      category: 'webhook',
      orderId,
      appId,
      status: transaction.status,
      verified: transaction.webhookVerified,
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
      orderId,
      message: error.message,
      stack: error.stack,
    });

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
  requestOtp: exports.requestOtp,        // nouveau : flow 2-step wallet
  initiatePayment: exports.initiatePayment,
  checkStatus: exports.checkStatus,
  webhook: exports.webhook
};