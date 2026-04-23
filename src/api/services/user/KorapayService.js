// src/api/services/user/KorapayService.js

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const KorapayTransaction = require('../../models/user/KorapayTransaction');
const Package = require('../../models/common/Package');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const logger = require('../../../core/logger');

const SERVICE = 'korapay';

// Classe d'erreur personnalisée
class KorapayError extends Error {
  constructor(message, statusCode, responseData) {
    super(message);
    this.name = 'KorapayError';
    this.statusCode = statusCode;
    this.responseData = responseData;
  }
}

/**
 * Récupérer la configuration KoraPay
 * Priorité : Base de données > Variables d'environnement
 * @param {Object} app - Document App depuis req.currentApp
 * @returns {Object} Configuration KoraPay
 */
function getConfig(app) {
  const dbConfig = app?.payments?.korapay;
  
  // Si config en base et activée, l'utiliser
  if (dbConfig?.enabled) {
    return {
      apiUrl: dbConfig.apiUrl || process.env.KORAPAY_API_URL || 'https://api.korapay.com/merchant',
      publicKey: dbConfig.publicKey || process.env.KORAPAY_PUBLIC_KEY,
      secretKey: dbConfig.secretKey || process.env.KORAPAY_SECRET_KEY,
      encryptionKey: dbConfig.encryptionKey || process.env.KORAPAY_ENCRYPTION_KEY,
      enabled: true
    };
  }
  
  // Fallback sur les variables d'environnement
  return {
    apiUrl: process.env.KORAPAY_API_URL || 'https://api.korapay.com/merchant',
    publicKey: process.env.KORAPAY_PUBLIC_KEY,
    secretKey: process.env.KORAPAY_SECRET_KEY,
    encryptionKey: process.env.KORAPAY_ENCRYPTION_KEY,
    enabled: !!(process.env.KORAPAY_PUBLIC_KEY && process.env.KORAPAY_SECRET_KEY)
  };
}

/**
 * Valider la configuration KoraPay
 * @param {Object} config - Configuration à valider
 * @throws {KorapayError} Si configuration invalide
 */
function validateConfig(config) {
  if (!config.enabled) {
    throw new KorapayError('KoraPay n\'est pas configuré pour cette application', 400);
  }
  
  if (!config.apiUrl) {
    throw new KorapayError('URL API KoraPay non configurée', 500);
  }
  
  if (!config.publicKey || !config.secretKey) {
    throw new KorapayError(
      'Configuration KoraPay incomplète. Vérifiez publicKey et secretKey',
      500
    );
  }
}

/**
 * Générer les URLs de notification et de retour
 */
function generateUrls() {
  const baseUrl = process.env.APP_BASE_URL;
  return {
   notification_url: `${baseUrl}/api/payments/korapay/webhook`,
redirect_url: `${baseUrl}/api/payments/korapay/callback`
  };
}

/**
 * Créer les headers pour les requêtes KoraPay
 * @param {Object} config - Configuration KoraPay
 * @returns {Object} Headers
 */
function createHeaders(config) {
  return {
    'Authorization': `Bearer ${config.secretKey}`,
    'Content-Type': 'application/json'
  };
}

/**
 * Vérifier la signature du webhook KoraPay
 * @param {String} receivedSignature - Signature reçue dans le header x-korapay-signature
 * @param {Object} data - Objet data du webhook
 * @param {String} secretKey - Secret key KoraPay
 * @returns {Boolean} True si la signature est valide
 */
function verifyWebhookSignature(receivedSignature, data, secretKey) {
  try {
    // KoraPay utilise HMAC SHA256 sur le data object stringifié
    const calculatedSignature = crypto
      .createHmac('sha256', secretKey)
      .update(JSON.stringify(data))
      .digest('hex');

    return calculatedSignature === receivedSignature;
  } catch (error) {
    logger.error('verifyWebhookSignature: failed', {
      service: SERVICE, category: 'webhook.signature',
      message: error.message, stack: error.stack,
    });
    return false;
  }
}

/**
 * Mapper le statut KoraPay vers notre statut interne
 * @param {String} korapayStatus - Statut retourné par KoraPay
 * @returns {String} Statut interne
 */
function mapKorapayStatus(korapayStatus) {
  const statusMap = {
    'success': 'SUCCESS',
    'processing': 'PROCESSING',
    'failed': 'FAILED',
    'pending': 'PENDING',
    'cancelled': 'CANCELLED'
  };
  
  return statusMap[korapayStatus?.toLowerCase()] || 'PENDING';
}

/**
 * Initier un paiement KoraPay
 * @param {String} appId - ID de l'application
 * @param {Object} app - Document App depuis req.currentApp
 * @param {String} userId - ID de l'utilisateur
 * @param {String} packageId - ID du package
 * @param {String} currency - Devise (NGN, KES, GHS, XAF, XOF, etc.)
 * @param {String} customerName - Nom du client
 * @param {String} customerEmail - Email du client
 * @param {String} customerPhone - Téléphone du client (optionnel)
 * @param {Boolean} merchantBearsCost - Le marchand paie les frais (optionnel)
 */
async function initiatePayment(
  appId, 
  app, 
  userId, 
  packageId, 
  currency, 
  customerName, 
  customerEmail, 
  customerPhone = null,
  merchantBearsCost = false
) {
  const ctx = { service: SERVICE, category: 'initiate', appId, userId: String(userId), packageId, currency };

  try {
    logger.info('initiate: start', ctx);

    const config = getConfig(app);
    validateConfig(config);

    const packageDoc = await Package.findOne({ _id: packageId, appId });
    if (!packageDoc) {
      throw new AppError('Package non trouvé', 404, ErrorCodes.NOT_FOUND);
    }

    const normalizedCurrency = currency.toUpperCase();

    const amount = packageDoc.pricing.get(normalizedCurrency);
    if (!amount || amount <= 0) {
      throw new AppError(
        `Prix ${normalizedCurrency} non disponible pour ce package`,
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    const transactionId = `KPY_TXN_${Date.now()}_${uuidv4().substring(0, 8)}`;
    const reference = `${transactionId}`;

    // 6. Générer les URLs
    const { notification_url, redirect_url } = generateUrls();

    // 7. Créer la transaction en base
    const korapayTransaction = new KorapayTransaction({
      appId,
      transactionId,
      reference,
      user: userId,
      package: packageId,
      amount,
      currency: normalizedCurrency,
      customerName,
      customerEmail,
      customerPhone,
      description: `${packageDoc.name.fr} - ${packageDoc.duration} jours`,
      amountExpected: amount,
      notificationUrl: notification_url,
      redirectUrl: redirect_url,
      status: 'PENDING',
      merchantBearsCost
    });

    await korapayTransaction.save();

    const initializeData = {
      reference,
      amount,
      currency: normalizedCurrency,
      redirect_url,
      notification_url,
      customer: {
        name: customerName,
        email: customerEmail
      },
      merchant_bears_cost: merchantBearsCost,
      metadata: {
        app_id: appId,
        user_id: userId.toString(),
        package_id: packageId.toString(),
        transaction_id: transactionId
      }
    };

    // Ajouter le téléphone si fourni
    if (customerPhone) {
      initializeData.customer.phone = customerPhone;
    }

    const headers = createHeaders(config);

    const response = await axios.post(
      `${config.apiUrl}/api/v1/charges/initialize`,
      initializeData,
      { headers }
    );

    if (!response.data.status) {
      logger.error('initiate: API rejected', {
        ...ctx, transactionId, responseData: response.data,
      });
      await KorapayTransaction.findByIdAndDelete(korapayTransaction._id);
      
      throw new KorapayError(
        response.data.message || 'Payment initialization failed',
        response.status || 400,
        response.data
      );
    }

    // 11. Mettre à jour la transaction avec les données KoraPay
    const { data } = response.data;
    
    korapayTransaction.korapayReference = data.reference;
    korapayTransaction.checkoutUrl = data.checkout_url;
    korapayTransaction.status = 'PENDING';
    
    await korapayTransaction.save();
    
    await korapayTransaction.populate(['package', 'user']);
    logger.info('initiate: success', { ...ctx, transactionId, amount, currency: normalizedCurrency });

    return {
      transaction: korapayTransaction,
      checkoutUrl: data.checkout_url
    };

  } catch (error) {
    logger.error('initiate: failed', {
      ...ctx,
      message: error.message,
      httpStatus: error.response?.status,
      responseData: error.response?.data,
      stack: error.stack,
    });

    if (error instanceof KorapayError || error instanceof AppError) {
      throw error;
    }

    if (error.response) {
      throw new KorapayError(
        error.response.data.message || error.message,
        error.response.status,
        error.response.data
      );
    }

    throw error;
  }
}

/**
 * Vérifier le statut d'une transaction
 * @param {String} appId - ID de l'application
 * @param {Object} app - Document App depuis req.currentApp
 * @param {String} reference - Référence de la transaction (transactionId ou reference)
 */
async function checkTransactionStatus(appId, app, reference) {
  const ctx = { service: SERVICE, category: 'checkStatus', appId, reference };

  try {
    const config = getConfig(app);
    validateConfig(config);

    const transaction = await KorapayTransaction.findByReference(appId, reference);

    if (!transaction) {
      throw new AppError('Transaction non trouvée', 404, ErrorCodes.NOT_FOUND);
    }

    const headers = createHeaders(config);
    const verifyReference = transaction.korapayReference || transaction.reference;

    const response = await axios.get(
      `${config.apiUrl}/api/v1/charges/${verifyReference}`,
      { headers }
    );

    // 4. Traiter la réponse
    if (response.data.status && response.data.data) {
      const paymentData = response.data.data;
      
      // Mettre à jour le statut
      transaction.status = mapKorapayStatus(paymentData.status);
      
      // Mettre à jour les autres champs
      if (paymentData.payment_method) {
        transaction.paymentMethod = paymentData.payment_method;
      }
      
      if (paymentData.fee !== undefined) {
        transaction.fee = paymentData.fee;
      }
      
      if (paymentData.vat !== undefined) {
        transaction.vat = paymentData.vat;
      }
      
      if (paymentData.amount_charged !== undefined) {
        transaction.amountCharged = paymentData.amount_charged;
      }
      
      if (paymentData.reference) {
        transaction.korapayReference = paymentData.reference;
      }
      
      transaction.responseMessage = response.data.message || paymentData.status;
      
      // Si succès, enregistrer la date de paiement
      if (transaction.status === 'SUCCESS' && !transaction.paymentDate) {
        transaction.paymentDate = new Date();
      }
      
      // Si échec, enregistrer l'erreur
      if (transaction.status === 'FAILED') {
        transaction.errorMessage = paymentData.message || 'Payment failed';
      }
      
      await transaction.save();
      logger.info('checkStatus: transaction updated', { ...ctx, status: transaction.status });
    }

    return transaction;

  } catch (error) {
    logger.error('checkStatus: failed', {
      ...ctx,
      message: error.message,
      httpStatus: error.response?.status,
      responseData: error.response?.data,
      stack: error.stack,
    });

    if (error instanceof KorapayError || error instanceof AppError) {
      throw error;
    }

    if (error.response) {
      throw new KorapayError(
        error.response.data.message || error.message,
        error.response.status,
        error.response.data
      );
    }

    throw error;
  }
}

/**
 * Initier un paiement Mobile Money direct
 * @param {String} appId - ID de l'application
 * @param {Object} app - Document App depuis req.currentApp
 * @param {String} userId - ID de l'utilisateur
 * @param {String} packageId - ID du package
 * @param {String} currency - Devise
 * @param {String} mobileNumber - Numéro de mobile money
 * @param {String} customerName - Nom du client
 * @param {String} customerEmail - Email du client
 * @param {Boolean} merchantBearsCost - Le marchand paie les frais
 */
async function initiateMobileMoneyPayment(
  appId,
  app,
  userId,
  packageId,
  currency,
  mobileNumber,
  customerName,
  customerEmail,
  merchantBearsCost = false
) {
  const ctx = { service: SERVICE, category: 'initiateMobileMoney', appId, userId: String(userId), packageId, currency };

  try {
    logger.info('initiateMobileMoney: start', ctx);

    const config = getConfig(app);
    validateConfig(config);
    
    // 2. Récupérer le package
    const packageDoc = await Package.findOne({ _id: packageId, appId });
    if (!packageDoc) {
      throw new AppError('Package non trouvé', 404, ErrorCodes.NOT_FOUND);
    }

    // 3. Récupérer le prix
    const normalizedCurrency = currency.toUpperCase();
    const amount = packageDoc.pricing.get(normalizedCurrency);
    if (!amount || amount <= 0) {
      throw new AppError(
        `Prix ${normalizedCurrency} non disponible pour ce package`,
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    // 4. Générer référence
    const transactionId = `KPY_MM_${Date.now()}_${uuidv4().substring(0, 8)}`;
    const reference = `${appId}_${transactionId}`;

    // 5. Générer URLs
    const { notification_url, redirect_url } = generateUrls();

    // 6. Créer la transaction
    const korapayTransaction = new KorapayTransaction({
      appId,
      transactionId,
      reference,
      user: userId,
      package: packageId,
      amount,
      currency: normalizedCurrency,
      customerName,
      customerEmail,
      customerPhone: mobileNumber,
      description: `${packageDoc.name.fr} - ${packageDoc.duration} jours`,
      amountExpected: amount,
      notificationUrl: notification_url,
      redirectUrl: redirect_url,
      status: 'PENDING',
      paymentMethod: 'mobile_money',
      merchantBearsCost,
      mobileMoneyDetails: {
        number: mobileNumber
      }
    });

    await korapayTransaction.save();

    // 7. Appeler l'API Mobile Money de KoraPay
    const headers = createHeaders(config);
    const mobileMoneyData = {
      reference,
      amount,
      currency: normalizedCurrency,
      redirect_url,
      notification_url,
      customer: {
        name: customerName,
        email: customerEmail
      },
      mobile_money: {
        number: mobileNumber
      },
      merchant_bears_cost: merchantBearsCost,
      description: korapayTransaction.description
    };

    const response = await axios.post(
      `${config.apiUrl}/api/v1/charges/mobile-money`,
      mobileMoneyData,
      { headers }
    );

    if (!response.data.status) {
      await KorapayTransaction.findByIdAndDelete(korapayTransaction._id);
      throw new KorapayError(
        response.data.message || 'Mobile Money charge failed',
        response.status || 400,
        response.data
      );
    }

    // 8. Mettre à jour avec les données de réponse
    const { data } = response.data;
    
    korapayTransaction.korapayReference = data.transaction_reference || data.payment_reference;
    korapayTransaction.status = mapKorapayStatus(data.status);
    korapayTransaction.responseMessage = data.message || response.data.message;
    
    if (data.auth_model) {
      korapayTransaction.mobileMoneyDetails.authModel = data.auth_model;
    }
    
    await korapayTransaction.save();
    await korapayTransaction.populate(['package', 'user']);

    return {
      transaction: korapayTransaction,
      authModel: data.auth_model, // OTP ou STK_PROMPT
      message: data.message
    };

  } catch (error) {
    logger.error('initiateMobileMoney: failed', {
      ...ctx,
      message: error.message,
      httpStatus: error.response?.status,
      responseData: error.response?.data,
      stack: error.stack,
    });

    if (error instanceof KorapayError || error instanceof AppError) {
      throw error;
    }

    if (error.response) {
      throw new KorapayError(
        error.response.data.message || error.message,
        error.response.status,
        error.response.data
      );
    }

    throw error;
  }
}

module.exports = {
  getConfig,
  validateConfig,
  initiatePayment,
  checkTransactionStatus,
  initiateMobileMoneyPayment,
  verifyWebhookSignature,
  mapKorapayStatus,
  KorapayError
};