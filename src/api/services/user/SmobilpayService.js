// services/user/SmobilpayService.js
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const SmobilpayTransaction = require('../../models/user/SmobilpayTransaction');
const Package = require('../../models/common/Package');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

// Classe d'erreur personnalisée
class SmobilpayError extends Error {
  constructor(message, statusCode, responseData) {
    super(message);
    this.name = 'SmobilpayError';
    this.statusCode = statusCode;
    this.responseData = responseData;
  }
}

// Mapping des codes pays
const COUNTRY_MAPPING = {
  'CM': { name: 'Cameroun', prefixes: ['CM'] },
  'GA': { name: 'Gabon', prefixes: ['GAB'] },
  'TD': { name: 'Tchad', prefixes: ['TCD'] },
  'CF': { name: 'RCA', prefixes: ['RCA'] },
  'CG': { name: 'Congo', prefixes: ['CG'] }
};

/**
 * Récupérer la configuration Smobilpay
 * Priorité : Base de données > Variables d'environnement
 * @param {Object} app - Document App depuis req.currentApp
 * @returns {Object} Configuration Smobilpay
 */
function getConfig(app) {
  const dbConfig = app?.payments?.smobilpay;
  
  // Si config en base et activée, l'utiliser
  if (dbConfig?.enabled) {
    return {
      apiUrl: dbConfig.apiUrl || process.env.SMOBILPAY_API_URL,
      apiKey: dbConfig.apiKey || process.env.SMOBILPAY_API_KEY,
      apiSecret: dbConfig.apiSecret || process.env.SMOBILPAY_API_SECRET,
      enabled: true
    };
  }
  
  // Fallback sur les variables d'environnement
  return {
    apiUrl: process.env.SMOBILPAY_API_URL,
    apiKey: process.env.SMOBILPAY_API_KEY,
    apiSecret: process.env.SMOBILPAY_API_SECRET,
    enabled: !!(process.env.SMOBILPAY_API_URL && process.env.SMOBILPAY_API_KEY && process.env.SMOBILPAY_API_SECRET)
  };
}

/**
 * Valider la configuration Smobilpay
 * @param {Object} config - Configuration à valider
 * @throws {SmobilpayError} Si configuration invalide
 */
function validateConfig(config) {
  if (!config.enabled) {
    throw new SmobilpayError('Smobilpay n\'est pas configuré pour cette application', 400);
  }
  
  if (!config.apiUrl || !config.apiKey || !config.apiSecret) {
    throw new SmobilpayError(
      'Configuration Smobilpay incomplète. Vérifiez apiUrl, apiKey et apiSecret',
      500
    );
  }
}

/**
 * Générer l'en-tête d'authentification Smobilpay
 * @param {Object} config - Configuration Smobilpay
 * @param {String} method - Méthode HTTP
 * @param {String} url - URL complète
 * @param {Object} params - Paramètres de requête
 * @param {Object} data - Données du body
 */
function generateAuthHeader(config, method, url, params = {}, data = null) {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = Date.now().toString();
  const signatureMethod = "HMAC-SHA1";
  
  const s3pParams = {
    s3pAuth_nonce: nonce,
    s3pAuth_timestamp: timestamp,
    s3pAuth_signature_method: signatureMethod,
    s3pAuth_token: config.apiKey
  };
  
  const allParams = {...params, ...(data || {}), ...s3pParams};
  
  const sortedParams = Object.keys(allParams).sort().reduce((r, k) => {
    r[k] = typeof allParams[k] === 'string' ? allParams[k].trim() : allParams[k];
    return r;
  }, {});
  
  const parameterString = Object.keys(sortedParams)
    .map(key => key + '=' + sortedParams[key])
    .join('&');
  
  const baseString = method + "&" + encodeURIComponent(url) + "&" + encodeURIComponent(parameterString);
  
  const signature = crypto.createHmac('sha1', config.apiSecret)
    .update(baseString)
    .digest('base64');
  
  const authHeader = "s3pAuth " +
    "s3pAuth_timestamp=\"" + timestamp + "\", " +
    "s3pAuth_signature=\"" + signature + "\", " +
    "s3pAuth_nonce=\"" + nonce + "\", " +
    "s3pAuth_signature_method=\"" + signatureMethod + "\", " +
    "s3pAuth_token=\"" + config.apiKey + "\"";
  
  return authHeader;
}

/**
 * Filtrer les services par pays
 */
function filterServicesByCountry(services, countryCode) {
  if (!countryCode) return services;
  
  const mapping = COUNTRY_MAPPING[countryCode.toUpperCase()];
  if (!mapping) return [];
  
  return services.filter(service =>
    mapping.prefixes.some(prefix =>
      service.merchant && service.merchant.startsWith(prefix)
    )
  );
}

/**
 * Nettoyer le nom du merchant selon le pays
 */
function cleanMerchantName(merchantName, countryCode) {
  if (!merchantName || !countryCode) return merchantName;
  
  let cleanedName = merchantName;
  
  switch (countryCode.toUpperCase()) {
    case 'CM':
      if (cleanedName.startsWith('CM')) {
        cleanedName = cleanedName.substring(2);
      }
      if (cleanedName.endsWith('CC')) {
        cleanedName = cleanedName.slice(0, -2);
      }
      break;
      
    case 'GA':
      if (cleanedName.startsWith('GAB')) {
        cleanedName = cleanedName.substring(3);
      }
      break;
      
    case 'TD':
      if (cleanedName.startsWith('TCD')) {
        cleanedName = cleanedName.substring(3);
      }
      break;
      
    case 'CF':
      if (cleanedName.startsWith('RCA')) {
        cleanedName = cleanedName.substring(3);
      }
      break;
      
    case 'CG':
      if (cleanedName.startsWith('CG')) {
        cleanedName = cleanedName.substring(2);
      }
      break;
  }
  
  return cleanedName;
}

/**
 * Formater les services pour la réponse
 */
function formatServicesResponse(services, countryCode) {
  return services.map(service => ({
    ...service,
    merchant: cleanMerchantName(service.merchant, countryCode),
    originalMerchant: service.merchant
  }));
}

/**
 * Récupérer les services Smobilpay
 * @param {Object} app - Document App depuis req.currentApp
 * @param {String} countryCode - Code pays (optionnel)
 */
async function getServices(app, countryCode = null) {
  try {
    // 1. Récupérer et valider la config
    const config = getConfig(app);
    validateConfig(config);

    const endpoint = '/cashout';
    const fullUrl = `${config.apiUrl}${endpoint}`;
    
    const authHeader = generateAuthHeader(config, 'GET', fullUrl);
    
    const response = await axios.get(fullUrl, {
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      }
    });
    
    let services = [];
    
    if (response.data && response.data.data && Array.isArray(response.data.data)) {
      services = response.data.data;
    } else if (response.data && Array.isArray(response.data)) {
      services = response.data;
    }
    
    // Filtrer par pays si spécifié
    if (countryCode) {
      services = filterServicesByCountry(services, countryCode);
      services = formatServicesResponse(services, countryCode);
    }
    
    return services;
  } catch (error) {
    if (error instanceof SmobilpayError) {
      throw error;
    }
    if (error.response) {
      throw new SmobilpayError(
        error.response.data.usrMsg || error.response.data.devMsg || error.message,
        error.response.status,
        error.response.data
      );
    }
    throw error;
  }
}

/**
 * Demander un devis
 * @param {Object} config - Configuration Smobilpay
 * @param {String} payItemId - ID du payItem
 * @param {Number} amount - Montant
 */
async function requestQuote(config, payItemId, amount) {
  try {
    const endpoint = '/quotestd';
    const fullUrl = `${config.apiUrl}${endpoint}`;
    
    const data = { payItemId, amount };
    
    const authHeader = generateAuthHeader(config, 'POST', fullUrl, {}, data);
    
    const response = await axios.post(fullUrl, data, {
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      }
    });
    
    return response.data;
  } catch (error) {
    if (error.response) {
      throw new SmobilpayError(
        error.response.data.usrMsg || error.response.data.devMsg || error.message,
        error.response.status,
        error.response.data
      );
    }
    throw error;
  }
}

/**
 * Exécuter un paiement
 * @param {Object} config - Configuration Smobilpay
 * @param {String} quoteId - ID du devis
 * @param {Object} customerData - Données client
 * @param {String} paymentId - ID du paiement
 */
async function collectPayment(config, quoteId, customerData, paymentId) {
  try {
    const endpoint = '/collectstd';
    const fullUrl = `${config.apiUrl}${endpoint}`;
    
    const data = {
      quoteId,
      customerPhonenumber: customerData.phoneNumber,
      customerEmailaddress: customerData.email || '',
      customerName: customerData.customerName,
      serviceNumber: customerData.phoneNumber,
      trid: paymentId
    };
    
    const authHeader = generateAuthHeader(config, 'POST', fullUrl, {}, data);
    
    const response = await axios.post(fullUrl, data, {
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      }
    });
    
    return response.data;
  } catch (error) {
    if (error.response) {
      throw new SmobilpayError(
        error.response.data.usrMsg || error.response.data.devMsg || error.message,
        error.response.status,
        error.response.data
      );
    }
    throw error;
  }
}

/**
 * Vérifier le statut d'une transaction via API
 * @param {Object} config - Configuration Smobilpay
 * @param {String} identifier - PTN ou paymentId
 * @param {Boolean} isPaymentId - True si c'est un paymentId
 */
async function verifyTransaction(config, identifier, isPaymentId = false) {
  try {
    const endpoint = '/verifytx';
    const fullUrl = `${config.apiUrl}${endpoint}`;
    
    const queryParams = isPaymentId ? { trid: identifier } : { ptn: identifier };
    
    const authHeader = generateAuthHeader(config, 'GET', fullUrl, queryParams);
    
    const response = await axios.get(fullUrl, {
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      params: queryParams
    });
    
    return response.data;
  } catch (error) {
    if (error.response) {
      throw new SmobilpayError(
        error.response.data.usrMsg || error.response.data.devMsg || error.message,
        error.response.status,
        error.response.data
      );
    }
    throw error;
  }
}

/**
 * Initier un paiement complet
 * @param {String} appId - ID de l'application
 * @param {Object} app - Document App depuis req.currentApp
 * @param {String} userId - ID de l'utilisateur
 * @param {String} packageId - ID du package
 * @param {String} serviceId - ID du service
 * @param {Object} customerData - Données client
 */
async function initiatePayment(appId, app, userId, packageId, serviceId, customerData) {
  try {
    console.log(`[Smobilpay-START] Démarrage initiate avec userId=${userId}, package=${packageId}, service=${serviceId}`);

    // 1. Récupérer et valider la config
    const config = getConfig(app);
    validateConfig(config);
    console.log(`[Smobilpay-1] Config validée pour app=${appId}`);

    // 2. Récupérer le service
    const services = await getServices(app);
    const service = services.find(s => s.serviceid === serviceId);
    
    if (!service) {
      throw new AppError(`Service ${serviceId} non trouvé`, 404, ErrorCodes.NOT_FOUND);
    }
    console.log(`[Smobilpay-2] Service trouvé: ${service.name || service.serviceName}`);
    
    // 3. Récupérer le package
    const packageDoc = await Package.findOne({ _id: packageId, appId });
    if (!packageDoc) {
      throw new AppError('Package non trouvé', 404, ErrorCodes.NOT_FOUND);
    }
    console.log(`[Smobilpay-3] Package trouvé: ${packageDoc.name.fr}`);
    
    // 4. Récupérer le prix en XAF
    let amount;
    
    if (packageDoc.pricing instanceof Map) {
      amount = packageDoc.pricing.get('XAF');
    } else if (packageDoc.pricing && typeof packageDoc.pricing === 'object') {
      amount = packageDoc.pricing.XAF || packageDoc.pricing['XAF'];
    }
      
    if (!amount || amount <= 0) {
      throw new AppError('Prix XAF non disponible pour ce package', 400, ErrorCodes.VALIDATION_ERROR);
    }
    console.log(`[Smobilpay-4] Prix: ${amount} XAF`);
    
    // 5. Créer la transaction
    const paymentId = uuidv4();
    console.log(`[Smobilpay-5] PaymentId généré: ${paymentId}`);
    
    const transaction = new SmobilpayTransaction({
      appId,
      paymentId,
      user: userId,
      package: packageId,
      serviceId,
      operatorName: service.name || service.serviceName,
      payItemId: service.payItemId,
      amount,
      currency: 'XAF',
      phoneNumber: customerData.phoneNumber,
      customerName: customerData.customerName,
      email: customerData.email,
      status: 'PENDING'
    });
    
    await transaction.save();
    console.log(`[Smobilpay-5] Transaction sauvegardée`);
    
    // 6. Demander un devis
    console.log(`[Smobilpay-6] Demande de devis...`);
    const quote = await requestQuote(config, service.payItemId, amount);
    console.log(`[Smobilpay-6] Devis obtenu: ${quote.quoteId}`);
    
    // 7. Mettre à jour avec le quoteId
    transaction.quoteId = quote.quoteId;
    await transaction.save();
    
    // 8. Exécuter le paiement
    console.log(`[Smobilpay-8] Exécution du paiement...`);
    const collectResult = await collectPayment(config, quote.quoteId, customerData, paymentId);
    console.log(`[Smobilpay-8] Paiement exécuté, PTN: ${collectResult.ptn}`);
    
    // 9. Mettre à jour avec le PTN
    transaction.ptn = collectResult.ptn;
    await transaction.save();
    
    // 10. Populer et retourner
    await transaction.populate(['package', 'user']);
    console.log(`[Smobilpay-END] Transaction complétée avec succès`);
    
    return transaction;
  } catch (error) {
    console.error(`[Smobilpay-ERROR] Erreur:`, {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data
    });
    throw error;
  }
}

/**
 * Vérifier le statut d'une transaction
 * @param {String} appId - ID de l'application
 * @param {Object} app - Document App depuis req.currentApp
 * @param {String} paymentId - ID du paiement
 */
async function checkTransactionStatus(appId, app, paymentId) {
  try {
    // 1. Récupérer et valider la config
    const config = getConfig(app);
    validateConfig(config);

    // 2. Trouver la transaction
    const transaction = await SmobilpayTransaction.findOne({ appId, paymentId })
      .populate(['package', 'user']);
    
    if (!transaction) {
      throw new AppError('Transaction non trouvée', 404, ErrorCodes.NOT_FOUND);
    }
    
    let apiResponse;
    
    // 3. Vérifier par PTN ou paymentId
    if (transaction.ptn) {
      apiResponse = await verifyTransaction(config, transaction.ptn);
    } else {
      apiResponse = await verifyTransaction(config, paymentId, true);
    }
    
    // 4. Traiter la réponse API
    const transactionData = Array.isArray(apiResponse) ? apiResponse[0] : apiResponse;
    
    if (transactionData) {
      const fieldsToUpdate = [
        'ptn', 'status', 'timestamp', 'receiptNumber', 'veriCode',
        'clearingDate', 'priceLocalCur', 'pin', 'tag', 'errorCode'
      ];
      
      fieldsToUpdate.forEach(field => {
        if (transactionData[field]) {
          if (field === 'timestamp' || field === 'clearingDate') {
            transaction[field] = new Date(transactionData[field]);
          } else if (field === 'priceLocalCur') {
            transaction.priceLocalCur = transactionData[field];
          } else if (field === 'localCur') {
            transaction.currency = transactionData[field];
          } else {
            transaction[field] = transactionData[field];
          }
        }
      });
      
      await transaction.save();
    }
    
    return transaction;
  } catch (error) {
    throw error;
  }
}

module.exports = {
  getConfig,
  getServices,
  initiatePayment,
  checkTransactionStatus,
  verifyTransaction,
  formatServicesResponse,
  cleanMerchantName,
  SmobilpayError,
  COUNTRY_MAPPING
};