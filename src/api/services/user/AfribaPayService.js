// services/user/AfribaPayService.js
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const AfribaPayTransaction = require('../../models/user/AfribaPayTransaction');
const Package = require('../../models/common/Package');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

// Cache pour le token (global car même compte AfribaPay pour toutes les apps)
let cachedToken = null;
let tokenExpiry = null;

// Path vers les données des pays
const COUNTRIES_DATA_PATH = path.join(__dirname, '../../../../data/payments/afribapayData.json');

// Classe d'erreur personnalisée
class AfribaPayError extends Error {
  constructor(message, statusCode, responseData) {
    super(message);
    this.name = 'AfribaPayError';
    this.statusCode = statusCode;
    this.responseData = responseData;
  }
}

/**
 * Récupérer la configuration AfribaPay
 * Priorité : Base de données > Variables d'environnement
 * @param {Object} app - Document App depuis req.currentApp
 * @returns {Object} Configuration AfribaPay
 */
function getConfig(app) {
  const dbConfig = app?.payments?.afribapay;
  
  // Si config en base et activée, l'utiliser
  if (dbConfig?.enabled) {
    return {
      apiUrl: dbConfig.apiUrl || process.env.AFRIBAPAY_API_URL,
      apiUser: dbConfig.apiUser || process.env.AFRIBAPAY_API_USER,
      apiKey: dbConfig.apiKey || process.env.AFRIBAPAY_API_KEY,
      merchantKey: dbConfig.merchantKey || process.env.AFRIBAPAY_MERCHANT_KEY,
      enabled: true
    };
  }
  
  // Fallback sur les variables d'environnement
  return {
    apiUrl: process.env.AFRIBAPAY_API_URL,
    apiUser: process.env.AFRIBAPAY_API_USER,
    apiKey: process.env.AFRIBAPAY_API_KEY,
    merchantKey: process.env.AFRIBAPAY_MERCHANT_KEY,
    enabled: !!(process.env.AFRIBAPAY_API_USER && process.env.AFRIBAPAY_API_KEY && process.env.AFRIBAPAY_MERCHANT_KEY)
  };
}

/**
 * Valider la configuration AfribaPay
 * @param {Object} config - Configuration à valider
 * @throws {AfribaPayError} Si configuration invalide
 */
function validateConfig(config) {
  if (!config.enabled) {
    throw new AfribaPayError('AfribaPay n\'est pas configuré pour cette application', 400);
  }
  
  if (!config.apiUrl || !config.apiUser || !config.apiKey || !config.merchantKey) {
    throw new AfribaPayError(
      'Configuration AfribaPay incomplète. Vérifiez apiUrl, apiUser, apiKey et merchantKey',
      500
    );
  }
}

/**
 * Générer les URLs de notification
 */
function generateUrls() {
  const baseUrl = process.env.APP_BASE_URL;
  return {
    notify_url: `${baseUrl}/api/payments/afribapay/webhook`,
    return_url: `${baseUrl}/api/payments/afribapay/success`,
    cancel_url: `${baseUrl}/api/payments/afribapay/cancel`
  };
}

/**
 * Obtenir le token d'accès
 * @param {Object} config - Configuration AfribaPay
 */
async function getAccessToken(config) {
  try {
    // Vérifier le cache
    if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
      return cachedToken;
    }

    const credentials = Buffer.from(`${config.apiUser}:${config.apiKey}`).toString('base64');
    
    const response = await axios.post(`${config.apiUrl}/v1/token`, {}, {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    if (response.data.data && response.data.data.access_token) {
      cachedToken = response.data.data.access_token;
      const expiresIn = response.data.data.expires_in || 86400;
      tokenExpiry = Date.now() + ((expiresIn - 300) * 1000);
      return cachedToken;
    } else {
      throw new AfribaPayError('Failed to get access token', 401, response.data);
    }
  } catch (error) {
    if (error instanceof AfribaPayError) {
      throw error;
    }
    if (error.response) {
      throw new AfribaPayError(
        error.response.data?.message || error.message,
        error.response.status,
        error.response.data
      );
    }
    throw error;
  }
}

/**
 * Récupérer les données des pays
 */
function getCountriesData(countryCode = null) {
  try {
    const fileContent = fs.readFileSync(COUNTRIES_DATA_PATH, 'utf8');
    const countriesData = JSON.parse(fileContent);
    
    if (countryCode) {
      const upperCountryCode = countryCode.toUpperCase();
      const countryData = countriesData[upperCountryCode];
      
      if (!countryData) {
        throw new AfribaPayError(`Country not found: ${countryCode}`, 404);
      }
      
      return { country: countryData };
    }
    
    return { countries: countriesData };
    
  } catch (error) {
    if (error instanceof AfribaPayError) {
      throw error;
    }
    throw new AfribaPayError(`Error loading countries data: ${error.message}`, 500);
  }
}

/**
 * Vérifier si OTP est requis
 */
function isOtpRequired(operator, country) {
  try {
    const { country: countryData } = getCountriesData(country);
    
    for (const currencyData of Object.values(countryData.currencies)) {
      const operatorData = currencyData.operators.find(op => op.operator_code === operator);
      if (operatorData) {
        return Boolean(operatorData.otp_required);
      }
    }
    return false;
  } catch (error) {
    return false;
  }
}

/**
 * Vérifier la signature HMAC
 * @param {String} receivedSignature - Signature reçue
 * @param {String} payload - Payload JSON
 * @param {String} apiKey - Clé API pour HMAC
 */
function verifyHmacToken(receivedSignature, payload, apiKey) {
  try {
    if (!apiKey || !receivedSignature) return false;
    const calculatedSignature = crypto
      .createHmac('sha256', apiKey)
      .update(payload)
      .digest('hex');
    return calculatedSignature === receivedSignature;
  } catch (error) {
    return false;
  }
}

/**
 * Initier un paiement AfribaPay
 * @param {String} appId - ID de l'application
 * @param {Object} app - Document App depuis req.currentApp
 * @param {String} userId - ID de l'utilisateur
 * @param {String} packageId - ID du package
 * @param {String} phoneNumber - Numéro de téléphone
 * @param {String} operator - Code opérateur
 * @param {String} country - Code pays
 * @param {String} currency - Devise
 * @param {String} otpCode - Code OTP (optionnel)
 */
async function initiatePayment(appId, app, userId, packageId, phoneNumber, operator, country, currency, otpCode = null) {
  try {
    console.log(`[AfribaPay-START] Démarrage initiate avec userId=${userId}, package=${packageId}, phone=${phoneNumber}`);

    // 1. Récupérer et valider la config
    const config = getConfig(app);
    validateConfig(config);
    console.log(`[AfribaPay-1] Config validée pour app=${appId}`);

    // 2. Récupérer le package
    const packageDoc = await Package.findOne({ _id: packageId, appId });

    console.log(`[AfribaPay-2] Package trouvé:`, packageDoc ? packageDoc.name.fr : 'NON TROUVÉ');
    if (!packageDoc) {
      throw new AppError('Package non trouvé', 404, ErrorCodes.NOT_FOUND);
    }

    // 3. Récupérer le prix selon la devise fournie
    const amount = packageDoc.pricing.get(currency);
    console.log(`[AfribaPay-3] Prix récupéré: ${amount} ${currency}`);
    if (!amount || amount <= 0) {
      throw new AppError(`Prix ${currency} non disponible pour ce package`, 400, ErrorCodes.VALIDATION_ERROR);
    }

    // 4. Vérifier si OTP est requis
    const otpRequiredCheck = isOtpRequired(operator, country);
    console.log(`[AfribaPay-4] OTP check: required=${otpRequiredCheck}, provided=${!!otpCode}`);
    if (otpRequiredCheck && !otpCode) {
      throw new AfribaPayError(
        `Code OTP requis pour ${operator} dans ce pays`,
        400,
        { 
          code: 'OTP_REQUIRED', 
          operator, 
          country,
          currency,
          message: 'Veuillez fournir le code OTP pour cet opérateur'
        }
      );
    }

    // 5. Générer IDs et URLs
    const orderId = `order-${Date.now()}`;
    const { notify_url, return_url, cancel_url } = generateUrls();
    console.log(`[AfribaPay-5] OrderId généré: ${orderId}`);

    // 6. Obtenir le token
    console.log(`[AfribaPay-6] Tentative d'obtention du token...`);
    const accessToken = await getAccessToken(config);
    console.log(`[AfribaPay-6] Token obtenu:`, accessToken ? 'SUCCESS' : 'FAILED');

    // 7. Préparer les données pour l'API AfribaPay
    const paymentData = {
      operator,
      country,
      phone_number: phoneNumber,
      amount,
      currency,
      order_id: orderId,
      merchant_key: config.merchantKey,
      reference_id: `${packageDoc.name.fr} - ${packageDoc.duration} jours`,
      lang: 'fr',
      notify_url,
      return_url,
      cancel_url
    };

    if (otpRequiredCheck && otpCode) {
      paymentData.otp_code = otpCode;
    }
    console.log(`[AfribaPay-7] PaymentData préparée:`, paymentData);

    // 8. Appeler l'API AfribaPay
    console.log(`[AfribaPay-8] Appel API AfribaPay en cours...`);
    const response = await axios.post(`${config.apiUrl}/v1/pay/payin`, paymentData, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    console.log(`[AfribaPay-8] Réponse API:`, response.data);

    if (!response.data.data) {
      console.error(`[AfribaPay-ERROR] Pas de data dans la réponse:`, response.data);
      throw new AfribaPayError(
        response.data.error?.message || 'Payment initialization failed',
        response.status || 400,
        response.data
      );
    }

    // 9. Créer la transaction
    const responseData = response.data.data;
    console.log(`[AfribaPay-9] Création transaction avec ID:`, responseData.transaction_id);
    
    const afribaPayTransaction = new AfribaPayTransaction({
      appId, 
      transactionId: responseData.transaction_id,
      orderId,
      user: userId,
      package: packageId,
      operator,
      country,
      phoneNumber,
      otpCode,
      amount: responseData.amount || amount,
      currency,
      merchantKey: config.merchantKey,
      referenceId: `${packageDoc.name.fr} - ${packageDoc.duration} jours`,
      notifyUrl: notify_url,
      returnUrl: return_url,
      cancelUrl: cancel_url,
      lang: 'fr',
      status: 'PENDING',
      providerId: responseData.provider_id,
      providerLink: responseData.provider_link,
      taxes: responseData.taxes,
      fees: responseData.fees,
      feesTaxesTtc: responseData.fees_taxes_ttc,
      amountTotal: responseData.amount_total,
      dateCreated: responseData.date_created ? new Date(responseData.date_created) : new Date(),
      apiRequestId: response.data.request_id,
      apiRequestTime: response.data.request_time,
      apiRequestIp: response.data.request_ip
    });

    await afribaPayTransaction.save();
    console.log(`[AfribaPay-9] Transaction sauvegardée avec succès`);

    // 10. Populer et retourner
    await afribaPayTransaction.populate(['package', 'user']);
    console.log(`[AfribaPay-END] Transaction complétée avec succès`);

    return {
      transaction: afribaPayTransaction
    };

  } catch (error) {
    console.error(`[AfribaPay-ERROR] Erreur:`, {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
      stack: error.stack
    });

    if (error.response) {
      if (error.response.status === 401) {
        console.log(`[AfribaPay-ERROR] Token invalide/expiré, réinitialisation du cache`);
        cachedToken = null;
        tokenExpiry = null;
      }
      
      throw new AfribaPayError(
        error.response.data?.error?.message || error.response.data?.message || error.message,
        error.response.status,
        error.response.data
      );
    }

    if (error instanceof AfribaPayError || error instanceof AppError) {
      throw error;
    }

    throw error;
  }
}

/**
 * Vérifier le statut d'une transaction
 * @param {String} appId - ID de l'application
 * @param {Object} app - Document App depuis req.currentApp
 * @param {String} orderId - ID de la commande ou transaction
 */
async function checkTransactionStatus(appId, app, orderId) {
  try {
    // 1. Récupérer et valider la config
    const config = getConfig(app);
    validateConfig(config);

    // 2. Trouver la transaction
    const transaction = await AfribaPayTransaction.findOne({ 
      appId, 
      $or: [{ orderId }, { transactionId: orderId }] 
    }).populate(['package', 'user']);

    if (!transaction) {
      throw new AppError('Transaction non trouvée', 404, ErrorCodes.NOT_FOUND);
    }

    // 3. Obtenir le token et vérifier le statut
    const accessToken = await getAccessToken(config);
    const response = await axios.get(`${config.apiUrl}/v1/status?order_id=${transaction.orderId}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    // 4. Mettre à jour la transaction
    if (response.data.data) {
      const paymentData = response.data.data;

      transaction.status = paymentData.status;
      transaction.operatorId = paymentData.operator_id;
      transaction.statusDate = paymentData.status_date ? new Date(paymentData.status_date) : new Date();
      transaction.apiRequestId = response.data.request_id;
      transaction.apiRequestTime = response.data.request_time;

      await transaction.save();
    }

    return transaction;

  } catch (error) {
    if (error.response) {
      throw new AfribaPayError(
        error.response.data?.error?.message || error.response.data?.message || error.message,
        error.response.status,
        error.response.data
      );
    }

    if (error instanceof AfribaPayError || error instanceof AppError) {
      throw error;
    }

    throw error;
  }
}

module.exports = {
  getConfig,
  initiatePayment,
  checkTransactionStatus,
  getCountriesData,
  verifyHmacToken,
  getAccessToken,
  isOtpRequired,
  AfribaPayError
};