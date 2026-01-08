// services/user/FlutterwaveService.js
const Flutterwave = require('flutterwave-node-v3');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
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

    // 4. Vérifier que cette devise a un charge type
    const chargeType = CURRENCY_CHARGE_TYPES[currencyUpper];
    if (!chargeType) {
      throw new AppError(`Type de paiement non disponible pour ${currencyUpper}`, 400, ErrorCodes.VALIDATION_ERROR);
    }

    // 5. Récupérer le prix dans la devise
    const amount = packageDoc.pricing.get(currencyUpper);
    if (!amount || amount <= 0) {
      throw new AppError(`Prix ${currencyUpper} non disponible pour ce package`, 400, ErrorCodes.VALIDATION_ERROR);
    }
    console.log(`[Flutterwave-5] Prix: ${amount} ${currencyUpper}`);

    // 6. Valider le réseau pour cette devise
    const networkUpper = network.toUpperCase();
    const availableNetworks = CURRENCY_NETWORKS[currencyUpper];
    if (availableNetworks && availableNetworks.length > 0 && !availableNetworks.includes(networkUpper)) {
      throw new AppError(
        `Réseau ${network} non supporté pour ${currencyUpper}. Réseaux disponibles: ${availableNetworks.join(', ')}`,
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    // 7. Extraire et nettoyer le numéro
    const countryCode = CURRENCY_TO_COUNTRY[currencyUpper];
    const cleanPhone = cleanPhoneNumber(phoneNumber, countryCode);
    console.log(`[Flutterwave-6] Country code: ${countryCode}, Clean phone: ${cleanPhone}`);

    // 8. Générer un ID de transaction unique
    const transactionId = `FLW_${Date.now()}_${uuidv4().substring(0, 8)}`;
    console.log(`[Flutterwave-7] TransactionId généré: ${transactionId}`);

    // ============================================================
    // APPEL API V3 : CRÉER LE CHARGE (1 seul appel)
    // ============================================================
    console.log(`[Flutterwave-8] Appel API v3 charge...`);
    console.log(`[Flutterwave-8] Charge type: ${chargeType}`);
    
    const chargePayload = {
      tx_ref: transactionId,
      amount: amount,
      currency: currencyUpper,
      network: networkUpper,
      email: email || `user${userId}@temp.com`,
      phone_number: cleanPhone,
      fullname: customerName
    };
    
    console.log(`[Flutterwave-8] Payload:`, JSON.stringify(chargePayload, null, 2));

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
      
      console.log(`[Flutterwave-8] Réponse reçue, status: ${chargeResponse.status}`);
      console.log(`[Flutterwave-8] Réponse data:`, JSON.stringify(chargeResponse.data, null, 2));
      
      if (!chargeResponse.data || chargeResponse.data.status !== 'success') {
        const errorMsg = chargeResponse.data?.message || 'Échec de création du charge';
        console.error('[Flutterwave-8-ERROR] API returned non-success:', chargeResponse.data);
        throw new FlutterwaveError(errorMsg, 400, chargeResponse.data);
      }
    } catch (error) {
      console.error('[Flutterwave-8-ERROR] Erreur création charge:');
      console.error('  Status:', error.response?.status);
      console.error('  Data:', JSON.stringify(error.response?.data, null, 2));
      console.error('  Message:', error.message);
      
      if (error instanceof FlutterwaveError) throw error;
      
      throw new FlutterwaveError(
        error.response?.data?.message || error.message || 'Erreur lors de la création du charge',
        error.response?.status || 500,
        error.response?.data
      );
    }

    const chargeData = chargeResponse.data.data;
    const chargeId = chargeData.id;
    const flwRef = chargeData.flw_ref;
    
    console.log(`[Flutterwave-8] Charge créé avec succès`);
    console.log(`[Flutterwave-8] ID: ${chargeId}, Ref: ${flwRef}`);
    console.log(`[Flutterwave-8] Status: ${chargeData.status}`);

    // ============================================================
    // SAUVEGARDER LA TRANSACTION EN DB
    // ============================================================
    console.log(`[Flutterwave-9] Sauvegarde transaction en DB...`);
    
    const flutterwaveTransaction = new FlutterwaveTransaction({
      appId,
      transactionId,
      customerId: 'v3_api', // v3 ne crée pas de customer séparé
      paymentMethodId: 'v3_api', // v3 ne crée pas de payment method séparé
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
    console.log(`[Flutterwave-9] Transaction sauvegardée`);

    // ============================================================
    // POPULER ET RETOURNER
    // ============================================================
    await flutterwaveTransaction.populate(['package', 'user']);
    console.log(`[Flutterwave-END] Transaction complétée avec succès`);

    return {
      transaction: flutterwaveTransaction,
      nextAction: chargeData.meta?.authorization
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
  try {
    console.log(`[Flutterwave-Status] Vérification transaction: ${transactionId}`);

    // 1. Récupérer la config
    const config = getConfig(app);
    validateConfig(config);

    // 2. Trouver la transaction en DB
    let transaction = await FlutterwaveTransaction.findOne({
      $or: [
        { transactionId, appId },
        { chargeId: transactionId, appId }
      ]
    }).populate(['package', 'user']);

    if (!transaction) {
      throw new AppError('Transaction non trouvée', 404, ErrorCodes.NOT_FOUND);
    }

    console.log(`[Flutterwave-Status] Transaction trouvée: ${transaction.transactionId}, status: ${transaction.status}`);

    // 3. Appeler l'API Flutterwave pour vérifier
    const checkResponse = await axios.get(
      `https://api.flutterwave.com/v3/transactions/${transaction.chargeId}/verify`,
      {
        headers: {
          'Authorization': `Bearer ${config.secretKey}`
        }
      }
    );

    console.log(`[Flutterwave-Status] Réponse API:`, JSON.stringify(checkResponse.data, null, 2));

    if (checkResponse.data.status === 'success' && checkResponse.data.data) {
      const verifyData = checkResponse.data.data;
      const newStatus = mapFlutterwaveStatus(verifyData.status);

      // 4. Mettre à jour si le status a changé
      if (transaction.status !== newStatus) {
        console.log(`[Flutterwave-Status] Changement de status: ${transaction.status} → ${newStatus}`);
        
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
    console.error('[Flutterwave-Status-ERROR]', error.message);
    
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