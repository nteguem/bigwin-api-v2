// services/user/FlutterwaveService.js
const Flutterwave = require('flutterwave-node-v3');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const FlutterwaveTransaction = require('../../models/user/FlutterwaveTransaction');
const Package = require('../../models/common/Package');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const logger = require('../../../core/logger');

const SERVICE = 'flutterwave';

// Classe d'erreur personnalisée
class FlutterwaveError extends Error {
  constructor(message, statusCode, responseData) {
    super(message);
    this.name = 'FlutterwaveError';
    this.statusCode = statusCode;
    this.responseData = responseData;
  }
}

/**
 * Récupérer la configuration Flutterwave
 * Priorité : Base de données > Variables d'environnement
 * @param {Object} app - Document App depuis req.currentApp
 * @returns {Object} Configuration Flutterwave
 */
function getConfig(app) {
  const dbConfig = app?.payments?.flutterwave;
  
  // Si config en base et activée, l'utiliser
  if (dbConfig?.enabled) {
    return {
      publicKey: dbConfig.publicKey || process.env.FLUTTERWAVE_PUBLIC_KEY,
      secretKey: dbConfig.secretKey || process.env.FLUTTERWAVE_SECRET_KEY,
      encryptionKey: dbConfig.encryptionKey || process.env.FLUTTERWAVE_ENCRYPTION_KEY,
      webhookHash: dbConfig.webhookHash || process.env.FLUTTERWAVE_WEBHOOK_HASH,
      enabled: true
    };
  }
  
  // Fallback sur les variables d'environnement
  return {
    publicKey: process.env.FLUTTERWAVE_PUBLIC_KEY,
    secretKey: process.env.FLUTTERWAVE_SECRET_KEY,
    encryptionKey: process.env.FLUTTERWAVE_ENCRYPTION_KEY,
    webhookHash: process.env.FLUTTERWAVE_WEBHOOK_HASH,
    enabled: !!(process.env.FLUTTERWAVE_PUBLIC_KEY && process.env.FLUTTERWAVE_SECRET_KEY)
  };
}

/**
 * Valider la configuration Flutterwave
 * @param {Object} config 
 */
function validateConfig(config) {
  if (!config.publicKey || !config.secretKey || !config.encryptionKey) {
    throw new AppError(
      'Configuration Flutterwave incomplète. Vérifiez vos clés API.',
      500,
      ErrorCodes.SERVER_ERROR
    );
  }
}

/**
 * Initialiser une instance du SDK Flutterwave
 * @param {Object} config 
 * @returns {Object} Instance Flutterwave
 */
function getFlutterwaveInstance(config) {
  return new Flutterwave(config.publicKey, config.secretKey);
}

// ============================================================
// MAPPINGS DEVISES <-> PAYS <-> RÉSEAUX
// ============================================================

/**
 * Mapping devise → country code
 * Ces codes sont utilisés pour les numéros de téléphone
 */
const CURRENCY_TO_COUNTRY = {
  'GHS': '233',  // Ghana
  'KES': '254',  // Kenya
  'UGX': '256',  // Uganda
  'TZS': '255',  // Tanzania
  'RWF': '250',  // Rwanda
  'ZMW': '260',  // Zambia
  'NGN': '234',  // Nigeria
  'XOF': '225',  // Côte d'Ivoire (UEMOA)
  'XAF': '237'   // Cameroun (CEMAC)
};

/**
 * Mapping devise → réseaux disponibles
 * Basé sur la documentation Flutterwave
 */
const CURRENCY_NETWORKS = {
  'GHS': ['MTN', 'VODAFONE', 'AIRTEL'],
  'KES': ['MPESA'],
  'UGX': ['MTN', 'AIRTEL'],
  'TZS': ['AIRTEL', 'TIGO', 'HALOPESA'],
  'RWF': ['MTN', 'AIRTEL'],
  'ZMW': ['MTN'],
  'NGN': [],  // Pas de mobile money direct pour NGN dans l'API standard
  'XOF': [],  // Francophone - réseaux gérés différemment
  'XAF': []   // Francophone - réseaux gérés différemment
};

/**
 * Mapping devise → charge type pour l'API v3
 */
const CURRENCY_CHARGE_TYPES = {
  'GHS': 'mobile_money_ghana',
  'KES': 'mpesa',
  'UGX': 'mobile_money_uganda',
  'TZS': 'mobile_money_tanzania',
  'RWF': 'mobile_money_rwanda',
  'ZMW': 'mobile_money_zambia',
  'XOF': 'mobile_money_franco',
  'XAF': 'mobile_money_franco'
};

// ============================================================
// FONCTIONS UTILITAIRES
// ============================================================

/**
 * Extraire le country code d'un numéro de téléphone
 * @param {String} phoneNumber - Numéro avec ou sans country code
 * @returns {String|null} Country code ou null
 */
function extractCountryCode(phoneNumber) {
  const cleaned = phoneNumber.replace(/\D/g, '');
  
  // Vérifier tous les country codes connus
  for (const code of Object.values(CURRENCY_TO_COUNTRY)) {
    if (cleaned.startsWith(code)) {
      return code;
    }
  }
  
  return null;
}

/**
 * Nettoyer un numéro de téléphone (retirer country code et zéro initial)
 * @param {String} phoneNumber 
 * @param {String} expectedCountryCode 
 * @returns {String} Numéro nettoyé
 */
function cleanPhoneNumber(phoneNumber, expectedCountryCode) {
  let cleaned = phoneNumber.replace(/\D/g, '');
  
  // Retirer le country code s'il est présent
  if (cleaned.startsWith(expectedCountryCode)) {
    cleaned = cleaned.substring(expectedCountryCode.length);
  }
  
  // Retirer le zéro initial s'il existe
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }
  
  return cleaned;
}

/**
 * Mapper les statuts Flutterwave vers les statuts internes
 * @param {String} flutterwaveStatus 
 * @returns {String} Statut interne
 */
function mapFlutterwaveStatus(flutterwaveStatus) {
  const statusMap = {
    'successful': 'ACCEPTED',
    'success': 'ACCEPTED',
    'pending': 'PENDING',
    'failed': 'REFUSED',
    'cancelled': 'CANCELED',
    'NEW': 'PENDING',
    'PENDING': 'PENDING',
    'SUCCESSFUL': 'ACCEPTED',
    'FAILED': 'REFUSED'
  };
  
  return statusMap[flutterwaveStatus] || 'PENDING';
}

/**
 * Vérifier la signature du webhook
 * @param {String} receivedHash 
 * @param {Object} config 
 * @returns {Boolean}
 */
function verifyWebhookSignature(receivedHash, config) {
  return receivedHash === config.webhookHash;
}

// ============================================================
// FONCTION PRINCIPALE : INITIER UN PAIEMENT
// ============================================================

/**
 * Initier un paiement Mobile Money via Flutterwave API v3
 * 
 * @param {String} appId - ID de l'application
 * @param {Object} app - Document App
 * @param {String} userId - ID de l'utilisateur
 * @param {String} packageId - ID du package
 * @param {String} phoneNumber - Numéro de téléphone (avec ou sans country code)
 * @param {String} customerName - Nom du client
 * @param {String} email - Email du client (optionnel)
 * @param {String} currency - Devise (GHS, KES, etc.)
 * @param {String} network - Réseau mobile money (MTN, MPESA, etc.)
 * @returns {Object} { transaction, nextAction }
 */
async function initiatePayment(appId, app, userId, packageId, phoneNumber, customerName, email, currency, network) {
  const ctx = { service: SERVICE, category: 'initiate', appId, userId: String(userId), packageId, currency, network };

  try {
    logger.info('initiate: start', ctx);

    const config = getConfig(app);
    validateConfig(config);

    const packageDoc = await Package.findOne({ _id: packageId, appId });
    if (!packageDoc) {
      throw new AppError('Package non trouvé', 404, ErrorCodes.NOT_FOUND);
    }

    const currencyUpper = currency.toUpperCase();
    if (!CURRENCY_TO_COUNTRY[currencyUpper]) {
      throw new AppError(`Devise non supportée: ${currency}`, 400, ErrorCodes.VALIDATION_ERROR);
    }

    const chargeType = CURRENCY_CHARGE_TYPES[currencyUpper];
    if (!chargeType) {
      throw new AppError(`Type de paiement non disponible pour ${currencyUpper}`, 400, ErrorCodes.VALIDATION_ERROR);
    }

    const amount = packageDoc.pricing.get(currencyUpper);
    if (!amount || amount <= 0) {
      throw new AppError(`Prix ${currencyUpper} non disponible pour ce package`, 400, ErrorCodes.VALIDATION_ERROR);
    }

    const networkUpper = network.toUpperCase();
    const availableNetworks = CURRENCY_NETWORKS[currencyUpper];
    if (availableNetworks && availableNetworks.length > 0 && !availableNetworks.includes(networkUpper)) {
      throw new AppError(
        `Réseau ${network} non supporté pour ${currencyUpper}. Réseaux disponibles: ${availableNetworks.join(', ')}`,
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    const countryCode = CURRENCY_TO_COUNTRY[currencyUpper];
    const cleanPhone = cleanPhoneNumber(phoneNumber, countryCode);
    const transactionId = `FLW_${Date.now()}_${uuidv4().substring(0, 8)}`;

    const chargePayload = {
      tx_ref: transactionId,
      amount: amount,
      currency: currencyUpper,
      network: networkUpper,
      email: email || `user${userId}@temp.com`,
      phone_number: cleanPhone,
      fullname: customerName
    };

    let chargeResponse;
    try {
      chargeResponse = await axios.post(
        `https://api.flutterwave.com/v3/charges?type=${chargeType}`,
        chargePayload,
        {
          headers: {
            'Authorization': `Bearer ${config.secretKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!chargeResponse.data || chargeResponse.data.status !== 'success') {
        const errorMsg = chargeResponse.data?.message || 'Échec de création du charge';
        logger.error('initiate: API returned non-success', {
          ...ctx, transactionId, responseData: chargeResponse.data,
        });
        throw new FlutterwaveError(errorMsg, 400, chargeResponse.data);
      }
    } catch (error) {
      if (error instanceof FlutterwaveError) throw error;

      logger.error('initiate: charge creation failed', {
        ...ctx,
        transactionId,
        httpStatus: error.response?.status,
        responseData: error.response?.data,
        message: error.message,
      });

      throw new FlutterwaveError(
        error.response?.data?.message || error.message || 'Erreur lors de la création du charge',
        error.response?.status || 500,
        error.response?.data
      );
    }

    const chargeData = chargeResponse.data.data;
    const chargeId = chargeData.id;
    const flwRef = chargeData.flw_ref;

    const flutterwaveTransaction = new FlutterwaveTransaction({
      appId,
      transactionId,
      customerId: 'v3_api',
      paymentMethodId: 'v3_api',
      chargeId: chargeId,
      user: userId,
      package: packageId,
      amount,
      currency: currencyUpper,
      phoneNumber,
      countryCode,
      network: networkUpper,
      customerName,
      customerEmail: email,
      description: `${packageDoc.name.fr || packageDoc.name.en} - ${packageDoc.duration} jours`,
      status: mapFlutterwaveStatus(chargeData.status),
      processorResponse: chargeData.processor_response,
      nextAction: chargeData.meta?.authorization,
      metadata: {
        packageName: packageDoc.name,
        packageDuration: packageDoc.duration,
        flwRef: flwRef,
        chargeType: chargeType
      }
    });

    await flutterwaveTransaction.save();
    await flutterwaveTransaction.populate(['package', 'user']);

    logger.info('initiate: success', { ...ctx, transactionId, chargeId, flwRef, amount });

    return {
      transaction: flutterwaveTransaction,
      nextAction: chargeData.meta?.authorization
    };

  } catch (error) {
    logger.error('initiate: failed', {
      ...ctx,
      message: error.message,
      httpStatus: error.statusCode || error.response?.status,
      responseData: error.responseData || error.response?.data,
      stack: error.stack,
    });

    if (error instanceof FlutterwaveError || error instanceof AppError) {
      throw error;
    }

    if (error.response) {
      throw new FlutterwaveError(
        error.response.data.message || error.message,
        error.response.status,
        error.response.data
      );
    }

    throw error;
  }
}

// ============================================================
// VÉRIFIER LE STATUT D'UNE TRANSACTION
// ============================================================

/**
 * Vérifier le statut d'une transaction
 * @param {String} appId 
 * @param {Object} app 
 * @param {String} transactionId - ID transaction ou chargeId
 * @returns {Object} Transaction mise à jour
 */
async function checkTransactionStatus(appId, app, transactionId) {
  const ctx = { service: SERVICE, category: 'checkStatus', appId, transactionId };

  try {
    const config = getConfig(app);
    validateConfig(config);

    let transaction = await FlutterwaveTransaction.findOne({
      $or: [
        { transactionId, appId },
        { chargeId: transactionId, appId }
      ]
    }).populate(['package', 'user']);

    if (!transaction) {
      throw new AppError('Transaction non trouvée', 404, ErrorCodes.NOT_FOUND);
    }

    const checkResponse = await axios.get(
      `https://api.flutterwave.com/v3/transactions/${transaction.chargeId}/verify`,
      {
        headers: {
          'Authorization': `Bearer ${config.secretKey}`
        }
      }
    );

    if (checkResponse.data.status === 'success' && checkResponse.data.data) {
      const verifyData = checkResponse.data.data;
      const newStatus = mapFlutterwaveStatus(verifyData.status);

      if (transaction.status !== newStatus) {
        logger.info('checkStatus: status change', {
          ...ctx, from: transaction.status, to: newStatus,
        });

        transaction.status = newStatus;
        transaction.processorResponse = verifyData.processor_response;

        if (newStatus === 'ACCEPTED' && !transaction.paymentDate) {
          transaction.paymentDate = new Date();
        }

        await transaction.save();
      }
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

    if (error instanceof AppError) {
      throw error;
    }
    
    throw new AppError(
      error.response?.data?.message || 'Erreur lors de la vérification du statut',
      error.response?.status || 500,
      ErrorCodes.SERVER_ERROR
    );
  }
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  initiatePayment,
  checkTransactionStatus,
  verifyWebhookSignature,
  getConfig,
  
  // Exports pour les endpoints d'info
  CURRENCY_TO_COUNTRY,
  CURRENCY_NETWORKS,
  
  // Classe d'erreur
  FlutterwaveError
};