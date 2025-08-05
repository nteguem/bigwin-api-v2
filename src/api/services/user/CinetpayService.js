// services/user/CinetpayService.js
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const CinetpayTransaction = require('../../models/user/CinetpayTransaction');
const Package = require('../../models/common/Package');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

// Configuration
const API_URL = process.env.CINETPAY_API_URL;
const API_KEY = process.env.CINETPAY_API_KEY;
const SITE_ID = process.env.CINETPAY_SITE_ID;
const SECRET_KEY = process.env.CINETPAY_SECRET_KEY;

// Validation des variables d'environnement
if (!API_URL || !API_KEY || !SITE_ID || !SECRET_KEY) {
  throw new Error('Variables d\'environnement CinetPay manquantes: CINETPAY_API_URL, CINETPAY_API_KEY, CINETPAY_SITE_ID, CINETPAY_SECRET_KEY');
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
function verifyHmacToken(receivedToken, data) {
  try {
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
      .createHmac('sha256', SECRET_KEY)
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
async function initiatePayment(userId, packageId, phoneNumber, customerName, email) {
  try {
    // 1. Récupérer le package
    const packageDoc = await Package.findById(packageId);
    if (!packageDoc) {
      throw new AppError('Package non trouvé', 404, ErrorCodes.NOT_FOUND);
    }

    // 2. Récupérer le prix en XOF
    const amount = packageDoc.pricing.get('XOF');
    if (!amount || amount <= 0) {
      throw new AppError('Prix XOF non disponible pour ce package', 400, ErrorCodes.VALIDATION_ERROR);
    }

    // 3. Générer un ID de transaction unique
    const transactionId = `TXN_${Date.now()}_${uuidv4().substring(0, 8)}`;

    // 4. Générer les URLs
    const { notify_url, return_url } = generateUrls();

    // 5. Créer la transaction en base
    const cinetpayTransaction = new CinetpayTransaction({
      transactionId,
      user: userId,
      package: packageId,
      amount,
      currency: 'XOF',
      phoneNumber,
      customerName,
      description: `${packageDoc.name} - ${packageDoc.duration} jours`,
      notifyUrl: notify_url,
      returnUrl: return_url,
      status: 'PENDING'
    });

    await cinetpayTransaction.save();

    // 6. Préparer les données pour l'API CinetPay
    const paymentData = {
      apikey: API_KEY,
      site_id: parseInt(SITE_ID),
      transaction_id: transactionId,
      amount,
      description: `${packageDoc.name} - ${packageDoc.duration} jours`,
      customer_id: userId.toString(),
      customer_name: customerName,
      currency: 'XOF',
      notify_url,
      return_url,
      channels: 'ALL',
      lang: 'FR'
    };

    // 7. Appeler l'API CinetPay
    const response = await axios.post(API_URL, paymentData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('CinetPay payment initialization response:', response.data);

    // 8. Vérifier la réponse
    if (response.data.code !== '201') {
      throw new CinetpayError(
        response.data.message || 'Payment initialization failed',
        response.status || 400,
        response.data
      );
    }

    // 9. Mettre à jour la transaction avec les données CinetPay
    cinetpayTransaction.paymentToken = response.data.data.payment_token;
    cinetpayTransaction.paymentUrl = response.data.data.payment_url;
    cinetpayTransaction.apiResponseId = response.data.api_response_id;
    await cinetpayTransaction.save();

    // 10. Populer et retourner
    await cinetpayTransaction.populate(['package', 'user']);

    return {
      transaction: cinetpayTransaction,
      paymentUrl: response.data.data.payment_url
    };

  } catch (error) {
    if (error instanceof CinetpayError) {
      throw error;
    }

    if (error.response) {
      console.error('CinetPay API error:', error.response.data);
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
 */
async function checkTransactionStatus(transactionId) {
  try {
    // 1. Trouver la transaction
    const transaction = await CinetpayTransaction.findOne({ transactionId })
      .populate(['package', 'user']);

    if (!transaction) {
      throw new AppError('Transaction non trouvée', 404, ErrorCodes.NOT_FOUND);
    }

    // 2. Appeler l'API CinetPay pour vérifier
    const checkData = {
      apikey: API_KEY,
      site_id: parseInt(SITE_ID),
      transaction_id: transactionId
    };

    const response = await axios.post(`${API_URL}/check`, checkData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // 3. Traiter la réponse selon le code
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
  CinetpayError
};