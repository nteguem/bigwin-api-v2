// services/user/FlutterwaveService.js
const Flutterwave = require('flutterwave-node-v3');
const { v4: uuidv4 } = require('uuid');
const FlutterwaveTransaction = require('../../models/user/FlutterwaveTransaction');
const Package = require('../../models/common/Package');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

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
 * @param {Object} config - Configuration à valider
 * @throws {FlutterwaveError} Si configuration invalide
 */
function validateConfig(config) {
  if (!config.enabled) {
    throw new FlutterwaveError('Flutterwave n\'est pas configuré pour cette application', 400);
  }
  
  if (!config.publicKey || !config.secretKey) {
    throw new FlutterwaveError(
      'Configuration Flutterwave incomplète. Vérifiez publicKey et secretKey',
      500
    );
  }
}

/**
 * Obtenir l'instance Flutterwave SDK
 * @param {Object} config - Configuration Flutterwave
 * @returns {Flutterwave} Instance du SDK
 */
function getFlutterwaveInstance(config) {
  return new Flutterwave(config.publicKey, config.secretKey);
}

/**
 * Mapping des devises vers les codes pays
 */
const CURRENCY_TO_COUNTRY = {
  'GHS': '233',  // Ghana
  'KES': '254',  // Kenya
  'UGX': '256',  // Uganda
  'TZS': '255',  // Tanzania
  'RWF': '250',  // Rwanda
  'ZMW': '260',  // Zambia
  'NGN': '234',  // Nigeria
  'XOF': '225',  // Côte d'Ivoire (exemple)
  'XAF': '237'   // Cameroun (exemple)
};

/**
 * Mapping des réseaux Mobile Money par devise
 */
const CURRENCY_NETWORKS = {
  'GHS': ['MTN', 'VODAFONE', 'AIRTEL'],
  'KES': ['MPESA'],
  'UGX': ['MTN', 'AIRTEL'],
  'TZS': ['AIRTEL', 'TIGO', 'HALOPESA'],
  'RWF': ['MTN', 'AIRTEL'],
  'ZMW': ['MTN']
};

/**
 * Extraire le country code du numéro de téléphone
 * @param {String} phoneNumber - Numéro avec ou sans préfixe
 * @returns {String} Country code (ex: "233")
 */
function extractCountryCode(phoneNumber) {
  const cleanPhone = phoneNumber.replace(/[\s\-\(\)+]/g, '');
  
  // Vérifier les préfixes connus
  for (const [currency, code] of Object.entries(CURRENCY_TO_COUNTRY)) {
    if (cleanPhone.startsWith(code)) {
      return code;
    }
  }
  
  // Si pas de préfixe reconnu, retourner null
  return null;
}

/**
 * Nettoyer le numéro de téléphone (enlever country code si présent)
 * @param {String} phoneNumber - Numéro complet
 * @param {String} countryCode - Code pays
 * @returns {String} Numéro sans country code
 */
function cleanPhoneNumber(phoneNumber, countryCode) {
  let cleanPhone = phoneNumber.replace(/[\s\-\(\)+]/g, '');
  
  // Enlever le country code s'il est présent
  if (cleanPhone.startsWith(countryCode)) {
    cleanPhone = cleanPhone.substring(countryCode.length);
  }
  
  // Enlever le 0 initial si présent
  if (cleanPhone.startsWith('0')) {
    cleanPhone = cleanPhone.substring(1);
  }
  
  return cleanPhone;
}

/**
 * Vérifier la signature du webhook
 * @param {String} receivedHash - Hash reçu dans le header
 * @param {Object} config - Configuration Flutterwave
 * @returns {Boolean} True si signature valide
 */
function verifyWebhookSignature(receivedHash, config) {
  if (!config.webhookHash) {
    console.warn('[Flutterwave] Webhook hash non configuré, vérification impossible');
    return false;
  }
  
  return receivedHash === config.webhookHash;
}

/**
 * Mapper le statut Flutterwave vers notre système
 * @param {String} flwStatus - Status Flutterwave
 * @returns {String} Notre status
 */
function mapFlutterwaveStatus(flwStatus) {
  const statusMap = {
    'succeeded': 'ACCEPTED',
    'successful': 'ACCEPTED',
    'pending': 'PENDING',
    'failed': 'REFUSED',
    'cancelled': 'CANCELED',
    'canceled': 'CANCELED'
  };
  
  return statusMap[flwStatus?.toLowerCase()] || 'PENDING';
}

/**
 * Initier un paiement Flutterwave Mobile Money
 * @param {String} appId - ID de l'application
 * @param {Object} app - Document App depuis req.currentApp
 * @param {String} userId - ID de l'utilisateur
 * @param {String} packageId - ID du package
 * @param {String} phoneNumber - Numéro de téléphone
 * @param {String} customerName - Nom du client
 * @param {String} email - Email du client
 * @param {String} currency - Devise (GHS, KES, etc.)
 * @param {String} network - Réseau mobile (MTN, MPESA, etc.)
 */
async function initiatePayment(appId, app, userId, packageId, phoneNumber, customerName, email, currency, network) {
  try {
    console.log(`[Flutterwave-START] Démarrage initiate avec userId=${userId}, package=${packageId}, phone=${phoneNumber}`);

    // 1. Récupérer et valider la config
    const config = getConfig(app);
    validateConfig(config);
    
    // 2. Récupérer le package
    const packageDoc = await Package.findOne({ _id: packageId, appId });
    if (!packageDoc) {
      throw new AppError('Package non trouvé', 404, ErrorCodes.NOT_FOUND);
    }
    console.log(`[Flutterwave-2] Package trouvé: ${packageDoc.name.fr || packageDoc.name.en}`);

    // 3. Valider la devise
    const currencyUpper = currency.toUpperCase();
    if (!CURRENCY_TO_COUNTRY[currencyUpper]) {
      throw new AppError(`Devise non supportée: ${currency}`, 400, ErrorCodes.VALIDATION_ERROR);
    }
    console.log(`[Flutterwave-3] Devise: ${currencyUpper}`);

    // 4. Récupérer le prix dans la devise
    const amount = packageDoc.pricing.get(currencyUpper);
    if (!amount || amount <= 0) {
      throw new AppError(`Prix ${currencyUpper} non disponible pour ce package`, 400, ErrorCodes.VALIDATION_ERROR);
    }
    console.log(`[Flutterwave-5] Prix: ${amount} ${currencyUpper}`);

    // 5. Valider le réseau pour cette devise
    const networkUpper = network.toUpperCase();
    if (!CURRENCY_NETWORKS[currencyUpper]?.includes(networkUpper)) {
      throw new AppError(
        `Réseau ${network} non supporté pour ${currencyUpper}. Réseaux disponibles: ${CURRENCY_NETWORKS[currencyUpper]?.join(', ')}`,
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    // 6. Extraire et nettoyer le numéro
    const countryCode = CURRENCY_TO_COUNTRY[currencyUpper];
    const cleanPhone = cleanPhoneNumber(phoneNumber, countryCode);
    console.log(`[Flutterwave-6] Country code: ${countryCode}, Clean phone: ${cleanPhone}`);

    // 7. Générer un ID de transaction unique
    const transactionId = `FLW_${Date.now()}_${uuidv4().substring(0, 8)}`;
    console.log(`[Flutterwave-7] TransactionId généré: ${transactionId}`);

    // 8. Initialiser le SDK Flutterwave
    const flw = getFlutterwaveInstance(config);
    console.log(`[Flutterwave-8] SDK initialisé`);

    // ============================================================
    // ÉTAPE API 1 : Créer le Customer
    // ============================================================
    console.log(`[Flutterwave-9] Création du customer...`);
    const customerPayload = {
      email: email || `user${userId}@temp.com`,
      name: {
        first: customerName.split(' ')[0] || customerName,
        last: customerName.split(' ').slice(1).join(' ') || customerName
      },
      phone: {
        country_code: countryCode,
        number: cleanPhone
      }
    };

    let customerResponse;
    try {
      // Utiliser l'API directe car le SDK peut ne pas avoir la méthode customer.create
      const axios = require('axios');
      customerResponse = await axios.post(
        'https://api.flutterwave.com/v3/customers',
        customerPayload,
        {
          headers: {
            'Authorization': `Bearer ${config.secretKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (customerResponse.data.status !== 'success') {
        throw new FlutterwaveError(
          'Échec de création du customer',
          400,
          customerResponse.data
        );
      }
    } catch (error) {
      console.error('[Flutterwave-9-ERROR] Erreur création customer:', error.response?.data || error.message);
      throw new FlutterwaveError(
        error.response?.data?.message || 'Erreur lors de la création du customer',
        error.response?.status || 500,
        error.response?.data
      );
    }

    const customerId = customerResponse.data.data.id;
    console.log(`[Flutterwave-9] Customer créé: ${customerId}`);

    // ============================================================
    // ÉTAPE API 2 : Créer le Payment Method
    // ============================================================
    console.log(`[Flutterwave-10] Création du payment method...`);
    const paymentMethodPayload = {
      type: 'mobile_money',
      mobile_money: {
        country_code: countryCode,
        network: networkUpper,
        phone_number: cleanPhone
      }
    };

    let paymentMethodResponse;
    try {
      const axios = require('axios');
      paymentMethodResponse = await axios.post(
        'https://api.flutterwave.com/v3/payment-methods',
        paymentMethodPayload,
        {
          headers: {
            'Authorization': `Bearer ${config.secretKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (paymentMethodResponse.data.status !== 'success') {
        throw new FlutterwaveError(
          'Échec de création du payment method',
          400,
          paymentMethodResponse.data
        );
      }
    } catch (error) {
      console.error('[Flutterwave-10-ERROR] Erreur création payment method:', error.response?.data || error.message);
      throw new FlutterwaveError(
        error.response?.data?.message || 'Erreur lors de la création du payment method',
        error.response?.status || 500,
        error.response?.data
      );
    }

    const paymentMethodId = paymentMethodResponse.data.data.id;
    console.log(`[Flutterwave-10] Payment method créé: ${paymentMethodId}`);

    // ============================================================
    // ÉTAPE API 3 : Créer le Charge
    // ============================================================
    console.log(`[Flutterwave-11] Création du charge...`);
    const chargePayload = {
      customer_id: customerId,
      payment_method_id: paymentMethodId,
      amount: amount,
      currency: currencyUpper,
      reference: transactionId
    };

    let chargeResponse;
    try {
      const axios = require('axios');
      chargeResponse = await axios.post(
        'https://api.flutterwave.com/v3/charges',
        chargePayload,
        {
          headers: {
            'Authorization': `Bearer ${config.secretKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (chargeResponse.data.status !== 'success') {
        throw new FlutterwaveError(
          'Échec de création du charge',
          400,
          chargeResponse.data
        );
      }
    } catch (error) {
      console.error('[Flutterwave-11-ERROR] Erreur création charge:', error.response?.data || error.message);
      throw new FlutterwaveError(
        error.response?.data?.message || 'Erreur lors de la création du charge',
        error.response?.status || 500,
        error.response?.data
      );
    }

    const chargeData = chargeResponse.data.data;
    const chargeId = chargeData.id;
    console.log(`[Flutterwave-11] Charge créé: ${chargeId}`);
    console.log(`[Flutterwave-11] Status: ${chargeData.status}`);

    // ============================================================
    // ÉTAPE 4 : Créer la transaction en base
    // ============================================================
    console.log(`[Flutterwave-12] Sauvegarde transaction en DB...`);
    
    const flutterwaveTransaction = new FlutterwaveTransaction({
      appId,
      transactionId,
      customerId,
      paymentMethodId,
      chargeId,
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
      nextAction: chargeData.next_action,
      fees: chargeData.fees,
      metadata: {
        packageName: packageDoc.name,
        packageDuration: packageDoc.duration
      }
    });

    await flutterwaveTransaction.save();
    console.log(`[Flutterwave-12] Transaction sauvegardée`);

    // ============================================================
    // ÉTAPE 5 : Populer et retourner
    // ============================================================
    await flutterwaveTransaction.populate(['package', 'user']);
    console.log(`[Flutterwave-END] Transaction complétée avec succès`);

    return {
      transaction: flutterwaveTransaction,
      nextAction: chargeData.next_action
    };

  } catch (error) {
    console.error(`[Flutterwave-ERROR] Erreur:`, {
      message: error.message,
      status: error.statusCode || error.response?.status,
      data: error.responseData || error.response?.data
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

/**
 * Vérifier le statut d'une transaction
 * @param {String} appId - ID de l'application
 * @param {Object} app - Document App depuis req.currentApp
 * @param {String} transactionId - ID de la transaction (notre ID ou chargeId)
 */
async function checkTransactionStatus(appId, app, transactionId) {
  try {
    console.log(`[Flutterwave-CHECK] Vérification statut pour: ${transactionId}`);
    
    // 1. Récupérer la config
    const config = getConfig(app);
    validateConfig(config);

    // 2. Trouver la transaction (par notre transactionId OU par chargeId)
    const transaction = await FlutterwaveTransaction.findOne({
      appId,
      $or: [
        { transactionId: transactionId },
        { chargeId: transactionId }
      ]
    }).populate(['package', 'user']);

    if (!transaction) {
      throw new AppError('Transaction non trouvée', 404, ErrorCodes.NOT_FOUND);
    }

    console.log(`[Flutterwave-CHECK] Transaction trouvée: ${transaction.transactionId}`);

    // 3. Appeler l'API Flutterwave pour vérifier
    const axios = require('axios');
    const checkResponse = await axios.get(
      `https://api.flutterwave.com/v3/charges/${transaction.chargeId}`,
      {
        headers: {
          'Authorization': `Bearer ${config.secretKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log(`[Flutterwave-CHECK] Réponse API:`, checkResponse.data);

    if (checkResponse.data.status !== 'success') {
      throw new FlutterwaveError(
        'Échec de vérification du statut',
        400,
        checkResponse.data
      );
    }

    const chargeData = checkResponse.data.data;

    // 4. Mettre à jour la transaction
    transaction.status = mapFlutterwaveStatus(chargeData.status);
    transaction.processorResponse = chargeData.processor_response;
    
    if (chargeData.created_datetime) {
      transaction.paymentDate = new Date(chargeData.created_datetime);
    }

    await transaction.save();
    console.log(`[Flutterwave-CHECK] Transaction mise à jour: ${transaction.status}`);

    return transaction;

  } catch (error) {
    console.error('[Flutterwave-CHECK-ERROR] Erreur:', error.message);
    
    if (error instanceof FlutterwaveError || error instanceof AppError) {
      throw error;
    }

    if (error.response) {
      console.error('Flutterwave status check error:', error.response.data);
      throw new FlutterwaveError(
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
  verifyWebhookSignature,
  mapFlutterwaveStatus,
  extractCountryCode,
  cleanPhoneNumber,
  CURRENCY_TO_COUNTRY,
  CURRENCY_NETWORKS,
  FlutterwaveError
};