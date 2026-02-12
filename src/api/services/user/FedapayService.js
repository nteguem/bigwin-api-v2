// src/api/services/user/FedapayService.js

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const FedapayTransaction = require('../../models/user/FedapayTransaction');
const Package = require('../../models/common/Package');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

class FedapayError extends Error {
  constructor(message, statusCode, responseData) {
    super(message);
    this.name = 'FedapayError';
    this.statusCode = statusCode;
    this.responseData = responseData;
  }
}

/**
 * Récupérer la configuration FedaPay depuis la base de données
 */
function getConfig(app) {
  const dbConfig = app?.payments?.fedapay;
  
  if (!dbConfig?.enabled) {
    throw new FedapayError('FedaPay n\'est pas configuré pour cette application', 400);
  }
  
  return {
    apiUrl: dbConfig.apiUrl || 'https://api.fedapay.com/v1',
    sandboxApiUrl: dbConfig.sandboxApiUrl || 'https://sandbox-api.fedapay.com/v1',
    publicKey: dbConfig.publicKey,
    secretKey: dbConfig.secretKey,
    environment: dbConfig.environment || 'sandbox',
    enabled: true
  };
}

/**
 * Valider la configuration FedaPay
 */
function validateConfig(config) {
  if (!config.enabled) {
    throw new FedapayError('FedaPay n\'est pas configuré', 400);
  }
  
  if (!config.secretKey) {
    throw new FedapayError('Clé secrète FedaPay manquante', 500);
  }
}

/**
 * Obtenir l'URL API selon l'environnement
 */
function getApiUrl(config) {
  return config.environment === 'live' ? config.apiUrl : config.sandboxApiUrl;
}

/**
 * Détecter le pays depuis le numéro de téléphone
 */
function detectCountryFromPhone(phoneNumber) {
  const cleanPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
  
  // Bénin
  if (cleanPhone.startsWith('229') || cleanPhone.startsWith('+229')) return 'bj';
  
  // Togo
  if (cleanPhone.startsWith('228') || cleanPhone.startsWith('+228')) return 'tg';
  
  // Côte d'Ivoire
  if (cleanPhone.startsWith('225') || cleanPhone.startsWith('+225')) return 'ci';
  
  // Sénégal
  if (cleanPhone.startsWith('221') || cleanPhone.startsWith('+221')) return 'sn';
  
  // Mali
  if (cleanPhone.startsWith('223') || cleanPhone.startsWith('+223')) return 'ml';
  
  // Burkina Faso
  if (cleanPhone.startsWith('226') || cleanPhone.startsWith('+226')) return 'bf';
  
  // Niger
  if (cleanPhone.startsWith('227') || cleanPhone.startsWith('+227')) return 'ne';
  
  // Guinée
  if (cleanPhone.startsWith('224') || cleanPhone.startsWith('+224')) return 'gn';
  
  // Guinée-Bissau
  if (cleanPhone.startsWith('245') || cleanPhone.startsWith('+245')) return 'gw';
  
  // Défaut: Bénin
  return 'bj';
}

/**
 * Détecter l'opérateur depuis le numéro de téléphone
 */
function detectOperatorFromPhone(phoneNumber) {
  const cleanPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
  
  // Extraire les chiffres après l'indicatif pays
  let localNumber = cleanPhone;
  
  // Niger (+227)
  if (cleanPhone.startsWith('227') || cleanPhone.startsWith('+227')) {
    localNumber = cleanPhone.replace(/^\+?227/, '');
    if (localNumber.startsWith('9')) return 'airtel_ne';
    if (localNumber.startsWith('8')) return 'moov_ne';
  }
  
  // Bénin (+229)
  if (cleanPhone.startsWith('229') || cleanPhone.startsWith('+229')) {
    localNumber = cleanPhone.replace(/^\+?229/, '');
    if (localNumber.startsWith('9') || localNumber.startsWith('6')) return 'mtn_bj';
    if (localNumber.startsWith('5') || localNumber.startsWith('4')) return 'moov_bj';
  }
  
  // Togo (+228)
  if (cleanPhone.startsWith('228') || cleanPhone.startsWith('+228')) {
    localNumber = cleanPhone.replace(/^\+?228/, '');
    if (localNumber.startsWith('9')) return 'moov_tg';
    if (localNumber.startsWith('7')) return 'togocel';
  }
  
  // Côte d'Ivoire (+225)
  if (cleanPhone.startsWith('225') || cleanPhone.startsWith('+225')) {
    localNumber = cleanPhone.replace(/^\+?225/, '');
    if (localNumber.startsWith('05') || localNumber.startsWith('07')) return 'mtn_ci';
    if (localNumber.startsWith('01') || localNumber.startsWith('02')) return 'moov_ci';
    if (localNumber.startsWith('07') || localNumber.startsWith('08') || localNumber.startsWith('09')) return 'orange_ci';
  }
  
  // Sénégal (+221)
  if (cleanPhone.startsWith('221') || cleanPhone.startsWith('+221')) {
    localNumber = cleanPhone.replace(/^\+?221/, '');
    if (localNumber.startsWith('77') || localNumber.startsWith('78')) return 'orange_sn';
    if (localNumber.startsWith('76')) return 'free_sn';
  }
  
  // Guinée (+224)
  if (cleanPhone.startsWith('224') || cleanPhone.startsWith('+224')) {
    return 'mtn_gn';
  }
  
  // Mali (+223)
  if (cleanPhone.startsWith('223') || cleanPhone.startsWith('+223')) {
    localNumber = cleanPhone.replace(/^\+?223/, '');
    if (localNumber.startsWith('7') || localNumber.startsWith('9')) return 'orange_ml';
  }
  
  return null; // Pas de détection = laisse l'utilisateur choisir
}

/**
 * Générer les URLs de notification et de retour
 */
function generateUrls() {
  const baseUrl = process.env.APP_BASE_URL;
  return {
    notify_url: `${baseUrl}/api/payments/fedapay/webhook`,
    return_url: `${baseUrl}/api/payments/fedapay/success`
  };
}

/**
 * Initier un paiement FedaPay
 */
async function initiatePayment(appId, app, userId, packageId, phoneNumber, customerName, email) {
  try {
    console.log(`[FedaPay-START] userId=${userId}, package=${packageId}`);

    const config = getConfig(app);
    validateConfig(config);
    
    const packageDoc = await Package.findOne({ _id: packageId, appId });
    if (!packageDoc) {
      throw new AppError('Package non trouvé', 404, ErrorCodes.NOT_FOUND);
    }

    // Utiliser XOF par défaut ou la devise du package
    const currency = 'XOF';
    const amount = packageDoc.pricing.get(currency);
    
    if (!amount || amount <= 0) {
      throw new AppError(`Prix ${currency} non disponible`, 400, ErrorCodes.VALIDATION_ERROR);
    }

    const transactionId = `FEDA_${Date.now()}_${uuidv4().substring(0, 8)}`;
    const { notify_url, return_url } = generateUrls();

    const fedapayTransaction = new FedapayTransaction({
      appId,
      transactionId,
      user: userId,
      package: packageId,
      amount,
      currency,
      phoneNumber,
      customerName,
      customerEmail: email,
      description: `${packageDoc.name.fr} - ${packageDoc.duration} jours`,
      notifyUrl: notify_url,
      returnUrl: return_url,
      status: 'pending'
    });

    await fedapayTransaction.save();

    const detectedOperator = detectOperatorFromPhone(phoneNumber);
    console.log(`[FedaPay] Opérateur détecté: ${detectedOperator || 'aucun'}`);

    const paymentData = {
      description: fedapayTransaction.description,
      amount,
      currency: { iso: currency },
      callback_url: return_url,
      customer: {
        firstname: customerName.split(' ')[0] || customerName,
        lastname: customerName.split(' ').slice(1).join(' ') || customerName,
        email: email || `user_${userId}@temp.com`,
        phone_number: {
          number: phoneNumber.replace(/[\s\-\(\)\+]/g, ''),
          country: detectCountryFromPhone(phoneNumber)
        }
      },
      custom_metadata: {
        app_id: appId,
        user_id: userId.toString(),
        package_id: packageId.toString(),
        transaction_id: transactionId
      }
    };

    // Ajouter le mode uniquement si détecté
    if (detectedOperator) {
      paymentData.mode = detectedOperator;
    }

    const apiUrl = getApiUrl(config);
    const response = await axios.post(`${apiUrl}/transactions`, paymentData, {
      headers: {
        'Authorization': `Bearer ${config.secretKey}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('[FedaPay] API Response:', response.data);

    if (!response.data?.['v1/transaction']?.id) {
      throw new FedapayError('Réponse API invalide', 400, response.data);
    }

    const fedapayTransactionId = response.data['v1/transaction'].id;

    // Générer le token de paiement
    const tokenResponse = await axios.post(
      `${apiUrl}/transactions/${fedapayTransactionId}/token`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${config.secretKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    fedapayTransaction.paymentToken = tokenResponse.data.token;
    fedapayTransaction.paymentUrl = tokenResponse.data.url;
    fedapayTransaction.operatorTransactionId = fedapayTransactionId;
    await fedapayTransaction.save();
    
    await fedapayTransaction.populate(['package', 'user']);

    return {
      transaction: fedapayTransaction,
      paymentUrl: tokenResponse.data.url
    };

  } catch (error) {
    console.error('[FedaPay-ERROR]:', error.message);

    if (error instanceof FedapayError || error instanceof AppError) {
      throw error;
    }

    if (error.response) {
      throw new FedapayError(
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
 */
async function checkTransactionStatus(appId, app, transactionId) {
  try {
    const config = getConfig(app);
    validateConfig(config);

    const transaction = await FedapayTransaction.findOne({ appId, transactionId })
      .populate(['package', 'user']);

    if (!transaction) {
      throw new AppError('Transaction non trouvée', 404, ErrorCodes.NOT_FOUND);
    }

    if (!transaction.operatorTransactionId) {
      return transaction;
    }

    const apiUrl = getApiUrl(config);
    const response = await axios.get(
      `${apiUrl}/transactions/${transaction.operatorTransactionId}`,
      {
        headers: {
          'Authorization': `Bearer ${config.secretKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const fedapayData = response.data['v1/transaction'];
    
    transaction.status = fedapayData.status;
    transaction.paymentMethod = fedapayData.mode;
    
    if (fedapayData.approved_at) {
      transaction.paymentDate = new Date(fedapayData.approved_at);
    }

    await transaction.save();

    return transaction;

  } catch (error) {
    console.error('[FedaPay] Check status error:', error.message);
    
    if (error instanceof FedapayError || error instanceof AppError) {
      throw error;
    }

    if (error.response) {
      throw new FedapayError(
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
  initiatePayment,
  checkTransactionStatus,
  detectCountryFromPhone,
  detectOperatorFromPhone,
  FedapayError
};