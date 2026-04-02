// services/user/CinetpayService.js
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const CinetpayTransaction = require('../../models/user/CinetpayTransaction');
const Package = require('../../models/common/Package');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

// Classe d'erreur personnalisée
class CinetpayError extends Error {
  constructor(message, statusCode, responseData) {
    super(message);
    this.name = 'CinetpayError';
    this.statusCode = statusCode;
    this.responseData = responseData;
  }
}

/**
 * Récupérer la configuration CinetPay
 * Priorité : Base de données > Variables d'environnement
 * @param {Object} app - Document App depuis req.currentApp
 * @returns {Object} Configuration CinetPay
 */
function getConfig(app) {
  const dbConfig = app?.payments?.cinetpay;
  
  // Si config en base et activée, l'utiliser
  if (dbConfig?.enabled) {
    return {
      apiUrl: dbConfig.apiUrl || process.env.CINETPAY_API_URL,
      xof: {
        apiKey: dbConfig.xof?.apiKey || process.env.CINETPAY_XOF_API_KEY,
        siteId: dbConfig.xof?.siteId || process.env.CINETPAY_XOF_SITE_ID,
        secretKey: dbConfig.xof?.secretKey || process.env.CINETPAY_XOF_SECRET_KEY
      },
      xaf: {
        apiKey: dbConfig.xaf?.apiKey || process.env.CINETPAY_XAF_API_KEY,
        siteId: dbConfig.xaf?.siteId || process.env.CINETPAY_XAF_SITE_ID,
        secretKey: dbConfig.xaf?.secretKey || process.env.CINETPAY_XAF_SECRET_KEY
      },
      enabled: true
    };
  }
  
  // Fallback sur les variables d'environnement
  return {
    apiUrl: process.env.CINETPAY_API_URL,
    xof: {
      apiKey: process.env.CINETPAY_XOF_API_KEY,
      siteId: process.env.CINETPAY_XOF_SITE_ID,
      secretKey: process.env.CINETPAY_XOF_SECRET_KEY
    },
    xaf: {
      apiKey: process.env.CINETPAY_XAF_API_KEY,
      siteId: process.env.CINETPAY_XAF_SITE_ID,
      secretKey: process.env.CINETPAY_XAF_SECRET_KEY
    },
    enabled: !!(process.env.CINETPAY_API_URL)
  };
}

/**
 * Valider la configuration CinetPay
 * @param {Object} config - Configuration à valider
 * @param {String} currency - Devise (XOF ou XAF)
 * @throws {CinetpayError} Si configuration invalide
 */
function validateConfig(config, currency) {
  if (!config.enabled) {
    throw new CinetpayError('CinetPay n\'est pas configuré pour cette application', 400);
  }
  
  if (!config.apiUrl) {
    throw new CinetpayError('URL API CinetPay non configurée', 500);
  }
  
  const currencyConfig = currency === 'XAF' ? config.xaf : config.xof;
  
  if (!currencyConfig.apiKey || !currencyConfig.siteId || !currencyConfig.secretKey) {
    throw new CinetpayError(
      `Configuration CinetPay ${currency} incomplète. Vérifiez apiKey, siteId et secretKey`,
      500
    );
  }
}

/**
 * Obtenir la configuration selon la devise
 * @param {Object} config - Configuration globale
 * @param {String} currency - Devise (XOF ou XAF)
 */
function getConfigForCurrency(config, currency) {
  const currencyConfig = currency === 'XAF' ? config.xaf : config.xof;
  
  if (!currencyConfig) {
    throw new AppError(`Devise non supportée: ${currency}`, 400, ErrorCodes.VALIDATION_ERROR);
  }
  
  return {
    API_KEY: currencyConfig.apiKey,
    SITE_ID: currencyConfig.siteId,
    SECRET_KEY: currencyConfig.secretKey
  };
}

/**
 * Déterminer la devise selon le numéro de téléphone
 */
function detectCurrencyFromPhone(phoneNumber) {
  // Nettoyer le numéro
  const cleanPhone = phoneNumber.replace(/[\s\-\(\)]/g, '');
  
  // Préfixes XAF (Afrique Centrale - Zone CEMAC)
  const xafPrefixes = [
    '+237', '237',  // Cameroun
    '+241', '241',  // Gabon
    '+236', '236',  // République Centrafricaine
    '+242', '242',  // Congo-Brazzaville
    '+235', '235',  // Tchad
    '+240', '240'   // Guinée Équatoriale
  ];
  
  // Vérifier si c'est XAF
  if (xafPrefixes.some(prefix => cleanPhone.startsWith(prefix))) {
    return 'XAF';
  }
  
  // Par défaut XOF (Afrique de l'Ouest - Zone UEMOA)
  return 'XOF';
}

/**
 * Générer les URLs de notification et de retour
 */
function generateUrls() {
  const baseUrl = process.env.APP_BASE_URL;
  return {
    notify_url: `${baseUrl}/api/payments/cinetpay/webhook`,
    return_url: `${baseUrl}/api/payments/cinetpay/success`
  };
}

/**
 * Vérifier le token HMAC du webhook
 * @param {String} receivedToken - Token reçu
 * @param {Object} data - Données du webhook
 * @param {Object} config - Configuration CinetPay
 * @param {String} currency - Devise
 */
function verifyHmacToken(receivedToken, data, config, currency) {
  try {
    const currencyConfig = getConfigForCurrency(config, currency);
    
    const concatenatedString = 
      data.cpm_site_id +
      data.cpm_trans_id +
      data.cpm_trans_date +
      data.cpm_amount +
      data.cpm_currency +
      data.signature +
      data.payment_method +
      data.cel_phone_num +
      data.cpm_phone_prefixe +
      data.cel_phone_num +
      data.cpm_language +
      data.cpm_version +
      data.cpm_payment_config +
      data.cpm_page_action +
      data.cpm_custom +
      data.cpm_designation +
      '';

    const calculatedToken = crypto
      .createHmac('sha256', currencyConfig.SECRET_KEY)
      .update(concatenatedString)
      .digest('hex');

    return calculatedToken === receivedToken;
  } catch (error) {
    console.error('Error verifying HMAC token:', error);
    return false;
  }
}

/**
 * Initier un paiement CinetPay
 * @param {String} appId - ID de l'application
 * @param {Object} app - Document App depuis req.currentApp
 * @param {String} userId - ID de l'utilisateur
 * @param {String} packageId - ID du package
 * @param {String} phoneNumber - Numéro de téléphone
 * @param {String} customerName - Nom du client
 * @param {String} email - Email du client
 */
async function initiatePayment(appId, app, userId, packageId, phoneNumber, customerName, email) {
  try {
    console.log(`[CinetPay-START] Démarrage initiate avec userId=${userId}, package=${packageId}, phone=${phoneNumber}`);

    // 1. Récupérer et valider la config
    const config = getConfig(app);
    
    // 2. Récupérer le package
    const packageDoc = await Package.findOne({ _id: packageId, appId });
    if (!packageDoc) {
      throw new AppError('Package non trouvé', 404, ErrorCodes.NOT_FOUND);
    }
    console.log(`[CinetPay-2] Package trouvé: ${packageDoc.name.fr}`);

    // 3. Détecter automatiquement la devise selon le numéro
    const currency = detectCurrencyFromPhone(phoneNumber);
    console.log(`[CinetPay-3] Devise détectée: ${currency}`);

    // 4. Valider la config pour cette devise
    validateConfig(config, currency);

    // 5. Récupérer le prix dans la devise détectée
    const amount = packageDoc.pricing.get(currency);
    if (!amount || amount <= 0) {
      throw new AppError(`Prix ${currency} non disponible pour ce package`, 400, ErrorCodes.VALIDATION_ERROR);
    }
    console.log(`[CinetPay-5] Prix: ${amount} ${currency}`);

    // 6. Obtenir la configuration pour cette devise
    const currencyConfig = getConfigForCurrency(config, currency);

    // 7. Générer un ID de transaction unique
    const transactionId = `TXN_${Date.now()}_${uuidv4().substring(0, 8)}`;
    console.log(`[CinetPay-7] TransactionId généré: ${transactionId}`);

    // 8. Générer les URLs
    const { notify_url, return_url } = generateUrls();

    // 9. Créer la transaction en base
    const cinetpayTransaction = new CinetpayTransaction({
      appId,
      transactionId,
      user: userId,
      package: packageId,
      amount,
      currency,
      phoneNumber,
      customerName,
      description: `${packageDoc.name.fr} - ${packageDoc.duration} jours`,
      notifyUrl: notify_url,
      returnUrl: return_url,
      status: 'PENDING'
    });

    await cinetpayTransaction.save();
    console.log(`[CinetPay-9] Transaction sauvegardée`);

    // 10. Préparer les données pour l'API CinetPay
    const paymentData = {
      apikey: currencyConfig.API_KEY,
      site_id: parseInt(currencyConfig.SITE_ID),
      transaction_id: transactionId,
      amount,
      description: `${packageDoc.name.fr} - ${packageDoc.duration} jours`,
      customer_id: userId.toString(),
      customer_name: customerName,
      currency,
      notify_url,
      return_url,
      channels: 'ALL',
      lang: 'FR'
    };
    console.log(`[CinetPay-10] PaymentData préparée`);

    // 11. Appeler l'API CinetPay
    console.log(`[CinetPay-11] Appel API CinetPay...`);
    const response = await axios.post(config.apiUrl, paymentData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    console.log(`[CinetPay-11] Réponse API:`, response.data);

    // 12. Vérifier la réponse
    if (response.data.code !== '201') {
      console.error('Payment initialization failed with code:', response.data.code);
      await CinetpayTransaction.findByIdAndDelete(cinetpayTransaction._id);
      
      throw new CinetpayError(
        response.data.message || 'Payment initialization failed',
        response.status || 400,
        response.data
      );
    }

    // 13. Mettre à jour la transaction avec les données CinetPay
    cinetpayTransaction.paymentToken = response.data.data.payment_token;
    cinetpayTransaction.paymentUrl = response.data.data.payment_url;
    cinetpayTransaction.apiResponseId = response.data.api_response_id;
    await cinetpayTransaction.save();
    
    // 14. Populer et retourner
    await cinetpayTransaction.populate(['package', 'user']);
    console.log(`[CinetPay-END] Transaction complétée avec succès`);

    return {
      transaction: cinetpayTransaction,
      paymentUrl: response.data.data.payment_url
    };

  } catch (error) {
    console.error(`[CinetPay-ERROR] Erreur:`, {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data
    });

    if (error instanceof CinetpayError || error instanceof AppError) {
      throw error;
    }

    if (error.response) {
      throw new CinetpayError(
        error.response.data.message || error.response.data.description || error.message,
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
 * @param {String} transactionId - ID de la transaction
 */
async function checkTransactionStatus(appId, app, transactionId) {
  try {
    // 1. Récupérer la config
    const config = getConfig(app);

    // 2. Trouver la transaction
    const transaction = await CinetpayTransaction.findOne({ appId, transactionId })
      .populate(['package', 'user']);

    if (!transaction) {
      throw new AppError('Transaction non trouvée', 404, ErrorCodes.NOT_FOUND);
    }

    // 3. Valider la config pour cette devise
    validateConfig(config, transaction.currency);

    // 4. Obtenir la configuration pour cette devise
    const currencyConfig = getConfigForCurrency(config, transaction.currency);

    // 5. Appeler l'API CinetPay pour vérifier
    const checkData = {
      apikey: currencyConfig.API_KEY,
      site_id: parseInt(currencyConfig.SITE_ID),
      transaction_id: transactionId
    };

    console.log(`Checking ${transaction.currency} transaction ${transactionId} with SITE_ID: ${currencyConfig.SITE_ID}`);

    const response = await axios.post(`${config.apiUrl}/check`, checkData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log(`Check response for ${transactionId}:`, response.data);

    // 6. Traiter la réponse selon le code
    if (response.data.code === '00') {
      // Transaction réussie
      const paymentData = response.data.data;
      
      transaction.status = paymentData.status;
      transaction.paymentMethod = paymentData.payment_method;
      transaction.operatorTransactionId = paymentData.operator_id;
      transaction.paymentDate = paymentData.payment_date ? new Date(paymentData.payment_date) : null;
      transaction.fundAvailabilityDate = paymentData.fund_availability_date ? new Date(paymentData.fund_availability_date) : null;
      transaction.apiResponseId = response.data.api_response_id;
      
      await transaction.save();

    } else if (response.data.code === '662') {
      // En attente de confirmation client
      const paymentData = response.data.error?.data || response.data.data;
      
      transaction.status = 'WAITING_FOR_CUSTOMER';
      transaction.cpmErrorMessage = 'WAITING_CUSTOMER_PAYMENT';
      transaction.errorCode = response.data.code;
      transaction.errorMessage = response.data.message;
      transaction.apiResponseId = response.data.api_response_id;
      
      if (paymentData) {
        transaction.paymentMethod = paymentData.payment_method;
        transaction.fundAvailabilityDate = paymentData.fund_availability_date ? new Date(paymentData.fund_availability_date) : null;
      }
      
      await transaction.save();

    } else if (response.data.code === '600') {
      // Paiement échoué
      const paymentData = response.data.error?.data || response.data.data;
      
      transaction.status = paymentData?.status || 'REFUSED';
      transaction.errorCode = response.data.code;
      transaction.errorMessage = response.data.message;
      transaction.cpmErrorMessage = 'PAYMENT_FAILED';
      transaction.apiResponseId = response.data.api_response_id;
      
      if (paymentData) {
        transaction.paymentMethod = paymentData.payment_method;
        transaction.operatorTransactionId = paymentData.operator_id;
        transaction.fundAvailabilityDate = paymentData.fund_availability_date ? new Date(paymentData.fund_availability_date) : null;
      }
      
      await transaction.save();

    } else if (response.data.code === '627') {
      // Transaction annulée
      const paymentData = response.data.data;
      
      transaction.status = paymentData?.status || 'CANCELED';
      transaction.errorCode = response.data.code;
      transaction.errorMessage = response.data.message;
      transaction.cpmErrorMessage = 'TRANSACTION_CANCEL';
      transaction.apiResponseId = response.data.api_response_id;
      
      if (paymentData) {
        transaction.paymentMethod = paymentData.payment_method;
        transaction.operatorTransactionId = paymentData.operator_id;
        transaction.fundAvailabilityDate = paymentData.fund_availability_date ? new Date(paymentData.fund_availability_date) : null;
      }
      
      await transaction.save();

    } else {
      throw new CinetpayError(
        response.data.message || 'Transaction check failed',
        response.status || 400,
        response.data
      );
    }

    return transaction;

  } catch (error) {
    console.error('Error checking transaction status:', error.message);
    
    if (error instanceof CinetpayError || error instanceof AppError) {
      throw error;
    }

    if (error.response) {
      console.error('CinetPay status check error:', error.response.data);
      throw new CinetpayError(
        error.response.data.message || error.response.data.description || error.message,
        error.response.status,
        error.response.data
      );
    }

    throw error;
  }
}

module.exports = {
  getConfig,
  initiatePayment,
  checkTransactionStatus,
  verifyHmacToken,
  getConfigForCurrency,
  detectCurrencyFromPhone,
  CinetpayError
};