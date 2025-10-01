// services/user/CinetpayService.js
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const CinetpayTransaction = require('../../models/user/CinetpayTransaction');
const Package = require('../../models/common/Package');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

// Configuration de base
const API_URL = process.env.CINETPAY_API_URL;

// Configuration multi-devises
const CINETPAY_CONFIGS = {
  XOF: {
    API_KEY: process.env.CINETPAY_XOF_API_KEY,
    SITE_ID: process.env.CINETPAY_XOF_SITE_ID,
    SECRET_KEY: process.env.CINETPAY_XOF_SECRET_KEY
  },
  XAF: {
    API_KEY: process.env.CINETPAY_XAF_API_KEY,
    SITE_ID: process.env.CINETPAY_XAF_SITE_ID,
    SECRET_KEY: process.env.CINETPAY_XAF_SECRET_KEY
  }
};

// Validation des variables d'environnement
if (!API_URL) {
  throw new Error('CINETPAY_API_URL manquante');
}

if (!CINETPAY_CONFIGS.XOF.API_KEY || !CINETPAY_CONFIGS.XOF.SITE_ID || !CINETPAY_CONFIGS.XOF.SECRET_KEY) {
  console.warn('⚠️ Variables CinetPay XOF incomplètes');
}

if (!CINETPAY_CONFIGS.XAF.API_KEY || !CINETPAY_CONFIGS.XAF.SITE_ID || !CINETPAY_CONFIGS.XAF.SECRET_KEY) {
  console.warn('⚠️ Variables CinetPay XAF incomplètes');
}

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
 * Obtenir la configuration selon la devise
 */
function getConfigForCurrency(currency) {
  const config = CINETPAY_CONFIGS[currency];
  if (!config) {
    throw new AppError(`Devise non supportée: ${currency}`, 400, ErrorCodes.VALIDATION_ERROR);
  }
  return config;
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
 */
function verifyHmacToken(receivedToken, data, currency) {
  try {
    const config = getConfigForCurrency(currency);
    
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
      .createHmac('sha256', config.SECRET_KEY)
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
 */
/**
 * Initier un paiement CinetPay
 */
async function initiatePayment(userId, packageId, phoneNumber, customerName, email) {
  try {
    console.log('========== INITIATE PAYMENT START ==========');
    console.log('UserId:', userId);
    console.log('PackageId:', packageId);
    console.log('PhoneNumber:', phoneNumber);
    
    // 1. Récupérer le package
    const packageDoc = await Package.findById(packageId);
    if (!packageDoc) {
      throw new AppError('Package non trouvé', 404, ErrorCodes.NOT_FOUND);
    }
    console.log('Package found:', packageDoc.name.fr);

    // 2. Détecter automatiquement la devise selon le numéro
    const currency = detectCurrencyFromPhone(phoneNumber);
    console.log('Currency detected:', currency, 'for phone:', phoneNumber);

    // 3. Récupérer le prix dans la devise détectée
    const amount = packageDoc.pricing.get(currency);
    if (!amount || amount <= 0) {
      throw new AppError(`Prix ${currency} non disponible pour ce package`, 400, ErrorCodes.VALIDATION_ERROR);
    }
    console.log('Amount:', amount, currency);

    // 4. Obtenir la configuration pour cette devise
    const config = getConfigForCurrency(currency);
    console.log('Config selected for', currency);
    console.log('SITE_ID:', config.SITE_ID);
    console.log('API_KEY (first 15 chars):', config.API_KEY.substring(0, 15));
    console.log('SECRET_KEY (first 15 chars):', config.SECRET_KEY.substring(0, 15));

    // 5. Générer un ID de transaction unique
    const transactionId = `TXN_${Date.now()}_${uuidv4().substring(0, 8)}`;
    console.log('Transaction ID generated:', transactionId);

    // 6. Générer les URLs
    const { notify_url, return_url } = generateUrls();
    console.log('notify_url:', notify_url);
    console.log('return_url:', return_url);

    // 7. Créer la transaction en base
    const cinetpayTransaction = new CinetpayTransaction({
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
    console.log('Transaction saved in DB with ID:', cinetpayTransaction._id);

    // 8. Préparer les données pour l'API CinetPay
    const paymentData = {
      apikey: config.API_KEY,
      site_id: parseInt(config.SITE_ID),
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

    console.log('========== CALLING CINETPAY API ==========');
    console.log('API URL:', API_URL);
    console.log('Payment Data:', JSON.stringify(paymentData, null, 2));

    // 9. Appeler l'API CinetPay
    const response = await axios.post(API_URL, paymentData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('========== CINETPAY API RESPONSE ==========');
    console.log('Status:', response.status);
    console.log('Response Code:', response.data.code);
    console.log('Response Message:', response.data.message);
    console.log('Full Response:', JSON.stringify(response.data, null, 2));
    console.log('==========================================');

    // 10. Vérifier la réponse
    if (response.data.code !== '201') {
      console.error('Payment initialization failed with code:', response.data.code);
      // Supprimer la transaction si l'initialisation échoue
      await CinetpayTransaction.findByIdAndDelete(cinetpayTransaction._id);
      
      throw new CinetpayError(
        response.data.message || 'Payment initialization failed',
        response.status || 400,
        response.data
      );
    }

    // 11. Mettre à jour la transaction avec les données CinetPay
    cinetpayTransaction.paymentToken = response.data.data.payment_token;
    cinetpayTransaction.paymentUrl = response.data.data.payment_url;
    cinetpayTransaction.apiResponseId = response.data.api_response_id;
    await cinetpayTransaction.save();
    
    console.log('Transaction updated with payment token');
    console.log('Payment URL:', response.data.data.payment_url);

    // 12. Populer et retourner
    await cinetpayTransaction.populate(['package', 'user']);

    console.log('========== INITIATE PAYMENT SUCCESS ==========');
    console.log('Transaction ID:', transactionId);
    console.log('Currency:', currency);
    console.log('SITE_ID used:', config.SITE_ID);
    console.log('==============================================');

    return {
      transaction: cinetpayTransaction,
      paymentUrl: response.data.data.payment_url
    };

  } catch (error) {
    console.error('========== INITIATE PAYMENT ERROR ==========');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    
    if (error instanceof CinetpayError || error instanceof AppError) {
      console.error('Error type:', error.name);
      console.error('Error status:', error.statusCode);
      throw error;
    }

    if (error.response) {
      console.error('API Error Response:', JSON.stringify(error.response.data, null, 2));
      throw new CinetpayError(
        error.response.data.message || error.response.data.description || error.message,
        error.response.status,
        error.response.data
      );
    }

    console.error('Error stack:', error.stack);
    console.error('===========================================');
    throw error;
  }
}

/**
 * Vérifier le statut d'une transaction
 */
async function checkTransactionStatus(transactionId) {
  try {
    // 1. Trouver la transaction
    const transaction = await CinetpayTransaction.findOne({ transactionId })
      .populate(['package', 'user']);

    if (!transaction) {
      throw new AppError('Transaction non trouvée', 404, ErrorCodes.NOT_FOUND);
    }

    // 2. Obtenir la configuration pour cette devise
    const config = getConfigForCurrency(transaction.currency);

    // 3. Appeler l'API CinetPay pour vérifier
    const checkData = {
      apikey: config.API_KEY,
      site_id: parseInt(config.SITE_ID),
      transaction_id: transactionId
    };

    console.log(`Checking ${transaction.currency} transaction ${transactionId} with SITE_ID: ${config.SITE_ID}`);

    const response = await axios.post(`${API_URL}/check`, checkData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log(`Check response for ${transactionId}:`, response.data);

    // 4. Traiter la réponse selon le code
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
    
    if (error instanceof (CinetpayError || AppError)) {
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
  initiatePayment,
  checkTransactionStatus,
  verifyHmacToken,
  getConfigForCurrency,
  detectCurrencyFromPhone,
  CinetpayError
};