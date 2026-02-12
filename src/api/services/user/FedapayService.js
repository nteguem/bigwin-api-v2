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
 * Détecter l'opérateur depuis le numéro de téléphone
 */
function detectOperatorFromPhone(phoneNumber) {
  const cleanPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
  
  // Niger (+227)
  if (cleanPhone.startsWith('227') || cleanPhone.startsWith('+227')) {
    if (cleanPhone.includes('9')) return 'airtel_ne'; // Airtel Niger commence par 9
    if (cleanPhone.includes('8')) return 'moov_ne';   // Moov Niger commence par 8
  }
  
  // Bénin (+229)
  if (cleanPhone.startsWith('229') || cleanPhone.startsWith('+229')) {
    if (cleanPhone.includes('9')) return 'mtn_bj';
    if (cleanPhone.includes('6') || cleanPhone.includes('5')) return 'moov_bj';
  }
  
  // Togo (+228)
  if (cleanPhone.startsWith('228') || cleanPhone.startsWith('+228')) {
    if (cleanPhone.includes('9')) return 'moov_tg';
    if (cleanPhone.includes('7')) return 'togocel';
  }
  
  // Côte d'Ivoire (+225)
  if (cleanPhone.startsWith('225') || cleanPhone.startsWith('+225')) {
    if (cleanPhone.includes('0') || cleanPhone.includes('4') || cleanPhone.includes('5')) return 'mtn_ci';
    if (cleanPhone.includes('0') || cleanPhone.includes('7')) return 'moov_ci';
    if (cleanPhone.includes('0')) return 'orange_ci';
  }
  
  // Sénégal (+221)
  if (cleanPhone.startsWith('221') || cleanPhone.startsWith('+221')) {
    if (cleanPhone.includes('7')) return 'orange_sn';
    if (cleanPhone.includes('7')) return 'free_sn';
  }
  
  // Guinée (+224)
  if (cleanPhone.startsWith('224') || cleanPhone.startsWith('+224')) {
    return 'mtn_gn';
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

    const paymentData = {
      description: fedapayTransaction.description,
      amount,
      currency: { iso: currency },
      callback_url: return_url,
      mode: detectOperatorFromPhone(phoneNumber),
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
  FedapayError
};