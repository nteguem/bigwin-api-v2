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

function getConfig(app) {
  const dbConfig = app?.payments?.fedapay;
  
  if (!dbConfig?.enabled) {
    throw new FedapayError('FedaPay non configuré', 400);
  }
  
  return {
    apiUrl: dbConfig.environment === 'live' 
      ? (dbConfig.apiUrl || 'https://api.fedapay.com/v1')
      : (dbConfig.sandboxApiUrl || 'https://sandbox-api.fedapay.com/v1'),
    secretKey: dbConfig.secretKey
  };
}

async function initiatePayment(appId, app, userId, packageId, user) {
  try {
    const config = getConfig(app);
    
    const packageDoc = await Package.findOne({ _id: packageId, appId });
    if (!packageDoc) {
      throw new AppError('Package non trouvé', 404, ErrorCodes.NOT_FOUND);
    }

    const currency = 'XOF';
    const amount = packageDoc.pricing.get(currency);
    
    if (!amount || amount <= 0) {
      throw new AppError('Prix non disponible', 400, ErrorCodes.VALIDATION_ERROR);
    }

    const transactionId = `FEDA_${Date.now()}_${uuidv4().substring(0, 8)}`;

    // Récupération des informations du user
    const firstName = user.firstName || user.pseudo || 'Client';
    const lastName = user.lastName || 'BigWin';
    const email = user.email || `user_${userId}@bigwin.app`;
    const customerName = `${firstName} ${lastName}`;

    const fedapayTransaction = new FedapayTransaction({
      appId,
      transactionId,
      user: userId,
      package: packageId,
      amount,
      currency,
      customerName,
      customerEmail: email,
      description: `${packageDoc.name.fr} - ${packageDoc.duration} jours`,
      status: 'pending'
    });

    await fedapayTransaction.save();

    const paymentData = {
      description: fedapayTransaction.description,
      amount,
      currency: { iso: currency },
      customer: {
        firstname: firstName,
        lastname: lastName,
        email: email
      }
    };

    console.log('=== PAYLOAD ENVOYÉ À FEDAPAY ===');
    console.log(JSON.stringify(paymentData, null, 2));

    const createResponse = await axios.post(`${config.apiUrl}/transactions`, paymentData, {
      headers: {
        'Authorization': `Bearer ${config.secretKey}`,
        'Content-Type': 'application/json'
      }
    });

    const fedapayTxId = createResponse.data?.['v1/transaction']?.id;
    if (!fedapayTxId) {
      throw new FedapayError('Création transaction échouée', 400, createResponse.data);
    }

    fedapayTransaction.operatorTransactionId = fedapayTxId;

    const tokenResponse = await axios.post(
      `${config.apiUrl}/transactions/${fedapayTxId}/token`,
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
    await fedapayTransaction.save();
    
    await fedapayTransaction.populate(['package', 'user']);

    return {
      transaction: fedapayTransaction,
      paymentUrl: tokenResponse.data.url
    };

  } catch (error) {
    console.error('[FedaPay]:', error.message);

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

async function checkTransactionStatus(appId, app, transactionId) {
  try {
    const config = getConfig(app);

    const transaction = await FedapayTransaction.findOne({ appId, transactionId })
      .populate(['package', 'user']);

    if (!transaction) {
      throw new AppError('Transaction non trouvée', 404, ErrorCodes.NOT_FOUND);
    }

    if (!transaction.operatorTransactionId) {
      return transaction;
    }

    const response = await axios.get(
      `${config.apiUrl}/transactions/${transaction.operatorTransactionId}`,
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
    console.error('[FedaPay]:', error.message);
    
    if (error instanceof FedapayError || error instanceof AppError) {
      throw error;
    }

    throw error;
  }
}

module.exports = {
  initiatePayment,
  checkTransactionStatus,
  FedapayError
};