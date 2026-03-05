// services/user/CinetpayService.js
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const CinetpayTransaction = require('../../models/user/CinetpayTransaction');
const Package = require('../../models/common/Package');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

// ---------------------------------------------
//  Erreur personnalisee
// ---------------------------------------------
class CinetpayError extends Error {
  constructor(message, statusCode, responseData) {
    super(message);
    this.name = 'CinetpayError';
    this.statusCode = statusCode;
    this.responseData = responseData;
  }
}

// ---------------------------------------------
//  Cache JWT  { [apiKey]: { token, expiresAt } }
// ---------------------------------------------
const tokenCache = {};

async function getAccessToken(apiKey, apiPassword, baseUrl) {
  const cached = tokenCache[apiKey];
  const now = Date.now();

  if (cached && cached.expiresAt > now + 5 * 60 * 1000) {
    return cached.token;
  }

  const response = await axios.post(
    `${baseUrl}/v1/oauth/login`,
    { api_key: apiKey, api_password: apiPassword },
    { headers: { 'Content-Type': 'application/json' } }
  );

  const data = response.data;
  if (data.code !== 200 || !data.access_token) {
    throw new CinetpayError('Echec authentification CinetPay', 401, data);
  }

  tokenCache[apiKey] = {
    token:     data.access_token,
    expiresAt: now + data.expires_in * 1000
  };

  console.log('[CinetPay] Nouveau token JWT obtenu');
  return data.access_token;
}

// ---------------------------------------------
//  Lire la config depuis app (base de donnees)
// ---------------------------------------------
function getConfig(app) {
  const c = app?.payments?.cinetpay;

  if (!c?.enabled) {
    throw new CinetpayError('CinetPay non active pour cette application', 400);
  }
  if (!c?.apiKey || !c?.apiPassword) {
    throw new CinetpayError('Configuration CinetPay incomplete (apiKey / apiPassword)', 500);
  }

  return {
    baseUrl:     c.baseUrl     || 'https://api.cinetpay.net',
    apiKey:      c.apiKey,
    apiPassword: c.apiPassword
  };
}

// ---------------------------------------------
//  Detecter la devise selon le numero de tel
// ---------------------------------------------
function detectCurrencyFromPhone(phoneNumber) {
  const clean = phoneNumber.replace(/[\s\-\(\)]/g, '');
  const xafPrefixes = [
    '+237', '237',
    '+241', '241',
    '+236', '236',
    '+242', '242',
    '+235', '235',
    '+240', '240'
  ];
  return xafPrefixes.some(p => clean.startsWith(p)) ? 'XAF' : 'XOF';
}

// ---------------------------------------------
//  Generer les URLs callbacks
// ---------------------------------------------
function generateUrls() {
  const base = process.env.APP_BASE_URL;
  return {
    notify_url:  `${base}/api/payments/cinetpay/webhook`,
    success_url: `${base}/api/payments/cinetpay/success`,
    failed_url:  `${base}/api/payments/cinetpay/failed`
  };
}

// ---------------------------------------------
//  INITIER UN PAIEMENT
// ---------------------------------------------
async function initiatePayment(appId, app, user, packageId, phoneNumber) {
  let payload = {};

  try {
    console.log(`[CinetPay] Init — user=${user._id}, package=${packageId}, phone=${phoneNumber}`);

    // 1. Config
    const config = getConfig(app);

    // 2. Package
    const packageDoc = await Package.findOne({ _id: packageId, appId });
    if (!packageDoc) throw new AppError('Package non trouve', 404, ErrorCodes.NOT_FOUND);

    // 3. Devise
    const currency = detectCurrencyFromPhone(phoneNumber);
    console.log(`[CinetPay] Devise: ${currency}`);

    // 4. Montant
    const amount = packageDoc.pricing?.get
      ? packageDoc.pricing.get(currency)
      : packageDoc.pricing?.[currency];
    if (!amount || amount <= 0) {
      throw new AppError(`Prix ${currency} non disponible pour ce package`, 400, ErrorCodes.VALIDATION_ERROR);
    }

    // 5. Token JWT
    const accessToken = await getAccessToken(config.apiKey, config.apiPassword, config.baseUrl);

    // 6. merchant_transaction_id unique (max 30 chars)
    const merchantTransactionId = `BW_${Date.now()}_${uuidv4().substring(0, 6)}`.substring(0, 30);

    // 7. URLs
    const { notify_url, success_url, failed_url } = generateUrls();

    // 8. Noms client
    const nameParts   = (user.pseudo || user.name || user.username || 'Utilisateur').split(' ');
    const firstName   = nameParts[0] || 'Utilisateur';
    const lastName    = nameParts.slice(1).join(' ') || firstName;
    const email       = user.email || `user_${user._id}@bigwin.app`;
    const designation = `${packageDoc.name?.fr || packageDoc.name} - ${packageDoc.duration}j`;

    // 9. Sauvegarder en base avant l'appel API
    const transaction = new CinetpayTransaction({
      appId,
      transactionId:     merchantTransactionId,
      user:              user._id,
      package:           packageId,
      amount,
      currency,
      status:            'PENDING',
      phoneNumber,
      customerFirstName: firstName,
      customerLastName:  lastName,
      customerEmail:     email,
      designation,
      notifyUrl:         notify_url,
      successUrl:        success_url,
      failedUrl:         failed_url
    });
    await transaction.save();
    console.log(`[CinetPay] Transaction sauvegardee: ${merchantTransactionId}`);

    // 10. Payload pour CinetPay
    payload = {
      currency,
      merchant_transaction_id: merchantTransactionId,
      amount,
      lang:                'fr',
      designation,
      client_email:        email,
      client_phone_number: phoneNumber,
      client_first_name:   firstName,
      client_last_name:    lastName,
      success_url,
      failed_url,
      notify_url
    };

    console.log(`[CinetPay] Payload:`, JSON.stringify(payload));

    // 11. Appel API CinetPay — POST /v1/payment
    const response = await axios.post(
      `${config.baseUrl}/v1/payment`,
      payload,
      {
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );

    console.log(`[CinetPay] Reponse init:`, JSON.stringify(response.data));
    const data = response.data;

    if (data.code !== 200) {
      await CinetpayTransaction.findByIdAndDelete(transaction._id);
      throw new CinetpayError(
        data.description || data.message || 'Echec initialisation paiement',
        400,
        data
      );
    }

    // 12. Mettre a jour la transaction avec les tokens CinetPay
    transaction.paymentToken          = data.payment_token;
    transaction.cinetpayTransactionId = data.transaction_id;
    transaction.notifyToken           = data.notify_token;
    transaction.paymentUrl            = data.payment_url;
    transaction.status                = 'INITIATED';
    await transaction.save();

    await transaction.populate(['package', 'user']);
    console.log(`[CinetPay] Init OK — paymentUrl: ${data.payment_url}`);

    return {
      transaction,
      paymentUrl: data.payment_url
    };

  } catch (error) {
    console.error('[CinetPay] Erreur init:', error.message);
    if (error instanceof CinetpayError || error instanceof AppError) throw error;
    if (error.response) {
      const cinetpayMessage =
        error.response.data?.description ||
        error.response.data?.message     ||
        error.message;
      console.error('[CinetPay] Reponse erreur CinetPay:', JSON.stringify(error.response.data));
      throw new CinetpayError(cinetpayMessage, error.response.status, error.response.data);
    }
    throw error;
  }
}

// ---------------------------------------------
//  VERIFIER LE STATUT D'UNE TRANSACTION
// ---------------------------------------------
async function checkTransactionStatus(appId, app, transactionId) {
  try {
    // 1. Trouver la transaction en base
    const transaction = await CinetpayTransaction.findOne({ appId, transactionId })
      .populate(['package', 'user']);
    if (!transaction) throw new AppError('Transaction non trouvee', 404, ErrorCodes.NOT_FOUND);

    // 2. Config + token JWT
    const config      = getConfig(app);
    const accessToken = await getAccessToken(config.apiKey, config.apiPassword, config.baseUrl);

    // 3. GET /v1/payment/{payment_token}
    const identifier = transaction.paymentToken || transactionId;
    const response   = await axios.get(
      `${config.baseUrl}/v1/payment/${identifier}`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );

    console.log(`[CinetPay] Statut pour ${transactionId}:`, JSON.stringify(response.data));
    const data = response.data;

    // 4. Mapper le statut
    const validStatuses = ['PENDING', 'INITIATED', 'SUCCESS', 'FAILED', 'EXPIRED'];
    if (validStatuses.includes(data.status)) {
      transaction.status = data.status;
    }

    if (data.user?.phone_number) {
      transaction.phoneNumber = data.user.phone_number;
    }

    await transaction.save();
    return transaction;

  } catch (error) {
    console.error('[CinetPay] Erreur check statut:', error.message);
    if (error instanceof CinetpayError || error instanceof AppError) throw error;
    if (error.response) {
      const cinetpayMessage =
        error.response.data?.description ||
        error.response.data?.message     ||
        error.message;
      console.error('[CinetPay] Reponse erreur CinetPay:', JSON.stringify(error.response.data));
      throw new CinetpayError(cinetpayMessage, error.response.status, error.response.data);
    }
    throw error;
  }
}

module.exports = {
  getConfig,
  initiatePayment,
  checkTransactionStatus,
  detectCurrencyFromPhone,
  CinetpayError
};