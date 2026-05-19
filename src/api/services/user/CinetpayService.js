// services/user/CinetpayService.js
//
// Intégration de la nouvelle API CinetPay (api.cinetpay.co/v1) :
//   - POST /v1/oauth/login  → token JWT (24h)
//   - POST /v1/payment      → init paiement, renvoie payment_url
//   - GET  /v1/payment/:id  → statut de la transaction
//
// La config (api_key / api_password) est stockée par devise dans
// `app.payments.cinetpay.{xof|xaf|gnf|cdf}`.
// Le token JWT est mis en cache in-memory par (appId + currency), avec
// un TTL de 23h (safety -1h sur les 24h annoncées par CinetPay).

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const CinetpayTransaction = require('../../models/user/CinetpayTransaction');
const Package = require('../../models/common/Package');
const { getBookById } = require('../integrations/proxidreamBooks');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const logger = require('../../../core/logger');

const SERVICE = 'cinetpay';
const TOKEN_TTL_MS = 23 * 60 * 60 * 1000;
const DEFAULT_API_URL = 'https://api.cinetpay.co';

class CinetpayError extends Error {
  constructor(message, statusCode, responseData) {
    super(message);
    this.name = 'CinetpayError';
    this.statusCode = statusCode;
    this.responseData = responseData;
  }
}

// Cache JWT : Map<`${appId}::${currency}`, { token, expiresAt }>
const tokenCache = new Map();

function cacheKey(appId, currency) {
  return `${appId}::${currency}`;
}

function getConfig(app) {
  const dbConfig = app?.payments?.cinetpay;
  if (!dbConfig?.enabled) {
    return { enabled: false };
  }
  return {
    apiUrl: dbConfig.apiUrl || DEFAULT_API_URL,
    xof: { apiKey: dbConfig.xof?.apiKey, apiPassword: dbConfig.xof?.apiPassword },
    xaf: { apiKey: dbConfig.xaf?.apiKey, apiPassword: dbConfig.xaf?.apiPassword },
    gnf: { apiKey: dbConfig.gnf?.apiKey, apiPassword: dbConfig.gnf?.apiPassword },
    cdf: { apiKey: dbConfig.cdf?.apiKey, apiPassword: dbConfig.cdf?.apiPassword },
    enabled: true
  };
}

function getCredentialsForCurrency(config, currency) {
  const key = currency.toLowerCase();
  const creds = config[key];
  if (!creds || !creds.apiKey || !creds.apiPassword) {
    throw new CinetpayError(
      `Credentials CinetPay ${currency} manquants. Configurez apiKey et apiPassword dans App.payments.cinetpay.${key}`,
      500
    );
  }
  return creds;
}

function validateConfig(config, currency) {
  if (!config.enabled) {
    throw new CinetpayError("CinetPay n'est pas activé pour cette application", 400);
  }
  if (!config.apiUrl) {
    throw new CinetpayError('URL API CinetPay non configurée', 500);
  }
  getCredentialsForCurrency(config, currency);
}

function detectCurrencyFromPhone(phoneNumber) {
  const cleanPhone = String(phoneNumber || '').replace(/[\s\-()]/g, '');

  // XAF (CEMAC) : Cameroun, Gabon, RCA, Congo, Tchad, Guinée Équatoriale
  const xafPrefixes = ['+237', '237', '+241', '241', '+236', '236', '+242', '242', '+235', '235', '+240', '240'];
  if (xafPrefixes.some(p => cleanPhone.startsWith(p))) return 'XAF';

  // GNF : Guinée
  if (cleanPhone.startsWith('+224') || cleanPhone.startsWith('224')) return 'GNF';

  // CDF : RDC
  if (cleanPhone.startsWith('+243') || cleanPhone.startsWith('243')) return 'CDF';

  // Par défaut XOF (UEMOA : CI, SN, BJ, BF, ML, NE, TG)
  return 'XOF';
}

/**
 * merchant_transaction_id <= 30 chars.
 * Pattern : `BW-<BASE36-UPPER>-<6HEX-UPPER>` ≈ 18 chars.
 *
 * CinetPay applique une regex non documentée sur ce champ : les
 * underscores et les minuscules sont rejetés avec 1004 INVALID_PARAMS
 * (« format du champ merchant transaction id est invalide »). Format
 * sûr : uppercase + hyphens + alphanumérique uniquement.
 */
function generateMerchantTransactionId() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = uuidv4().replace(/-/g, '').substring(0, 6).toUpperCase();
  return `BW-${ts}-${rand}`;
}

function generateUrls() {
  const baseUrl = process.env.APP_BASE_URL;
  return {
    notify_url: `${baseUrl}/api/payments/cinetpay/notify`,
    success_url: `${baseUrl}/api/payments/cinetpay/return?status=success`,
    failed_url: `${baseUrl}/api/payments/cinetpay/return?status=failed`
  };
}

async function getAccessToken(appId, app, currency) {
  const ctx = { service: SERVICE, category: 'oauth', appId, currency };
  const config = getConfig(app);
  validateConfig(config, currency);

  const creds = getCredentialsForCurrency(config, currency);
  const key = cacheKey(appId, currency);
  const cached = tokenCache.get(key);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  try {
    const response = await axios.post(
      `${config.apiUrl}/v1/oauth/login`,
      { api_key: creds.apiKey, api_password: creds.apiPassword },
      { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
    );

    if (response.data?.code !== 200 || !response.data.access_token) {
      throw new CinetpayError(
        response.data?.description || 'Authentification CinetPay échouée',
        response.status || 401,
        response.data
      );
    }

    const token = response.data.access_token;
    tokenCache.set(key, { token, expiresAt: Date.now() + TOKEN_TTL_MS });
    logger.info('oauth: token obtained', ctx);
    return token;
  } catch (error) {
    logger.error('oauth: failed', {
      ...ctx,
      message: error.message,
      httpStatus: error.response?.status,
      responseData: error.response?.data
    });
    if (error instanceof CinetpayError) throw error;
    throw new CinetpayError(
      error.response?.data?.description || error.message,
      error.response?.status || 500,
      error.response?.data
    );
  }
}

function invalidateToken(appId, currency) {
  tokenCache.delete(cacheKey(appId, currency));
}

function isInvalidTokenError(error) {
  // CinetPay renvoie 401 ET aussi 422 avec status=INVALID_TOKEN dans le
  // body. Si on traite seulement le 401, les requêtes /v1/payment qui
  // renvoient 422+INVALID_TOKEN font échouer la transaction sans retry.
  if (error.response?.status === 401) return true;
  const data = error.response?.data;
  if (data?.status === 'INVALID_TOKEN' || data?.code === 1002) return true;
  // Cas où c'est dans details (renvoyé par /v1/payment quand le token
  // est invalide au moment du init de transaction)
  if (data?.details?.status === 'INVALID_TOKEN' || data?.details?.code === 1002) return true;
  return false;
}

async function callWithToken(appId, app, currency, requestFn) {
  let token = await getAccessToken(appId, app, currency);
  try {
    return await requestFn(token);
  } catch (error) {
    if (isInvalidTokenError(error)) {
      logger.warn('callWithToken: invalid token detected, refreshing', {
        service: SERVICE, category: 'oauth', appId, currency,
        httpStatus: error.response?.status,
        cinetpayStatus: error.response?.data?.status || error.response?.data?.details?.status
      });
      invalidateToken(appId, currency);
      token = await getAccessToken(appId, app, currency);
      return await requestFn(token);
    }
    throw error;
  }
}

function mapStatus(rawStatus) {
  switch ((rawStatus || '').toUpperCase()) {
    case 'SUCCESS':
    case 'ACCEPTED':
      return 'ACCEPTED';
    case 'FAILED':
    case 'REFUSED':
      return 'REFUSED';
    case 'CANCELED':
    case 'CANCELLED':
      return 'CANCELED';
    case 'PENDING':
    case 'WAITING':
    case 'WAITING_FOR_CUSTOMER':
      return 'WAITING_FOR_CUSTOMER';
    case 'INITIATED':
      return 'INITIATED';
    default:
      return 'PENDING';
  }
}

/**
 * Choisit la devise à utiliser :
 *   1. `requestedCurrency` explicite (passé par le mobile depuis geo_config)
 *   2. sinon détection via préfixe `phoneNumber`
 *   3. sinon première devise avec credentials dans la config app
 */
function resolveCurrency(config, requestedCurrency, phoneNumber) {
  if (requestedCurrency) {
    return String(requestedCurrency).toUpperCase();
  }
  if (phoneNumber) {
    return detectCurrencyFromPhone(phoneNumber);
  }
  for (const ccy of ['xof', 'xaf', 'gnf', 'cdf']) {
    if (config[ccy]?.apiKey && config[ccy]?.apiPassword) {
      return ccy.toUpperCase();
    }
  }
  return 'XOF';
}

async function initiatePayment(appId, app, userId, packageId, phoneNumber, customerName, email, requestedCurrency) {
  const ctx = { service: SERVICE, category: 'initiate', appId, userId: String(userId), packageId };
  logger.info('initiate: start', ctx);

  const config = getConfig(app);

  const packageDoc = await Package.findOne({ _id: packageId, appId });
  if (!packageDoc) {
    throw new AppError('Package non trouvé', 404, ErrorCodes.NOT_FOUND);
  }

  const currency = resolveCurrency(config, requestedCurrency, phoneNumber);
  validateConfig(config, currency);

  const amount = packageDoc.pricing.get(currency);
  if (!amount || amount <= 0) {
    throw new AppError(`Prix ${currency} non disponible pour ce package`, 400, ErrorCodes.VALIDATION_ERROR);
  }

  const merchantTransactionId = generateMerchantTransactionId();
  const { notify_url, success_url, failed_url } = generateUrls();

  // Libellé "vrai" — utilisé en interne (DB, logs, reporting).
  const realDesignation = `${packageDoc.name?.fr || packageDoc.name?.en || 'Package'} - ${packageDoc.duration} jours`;

  // Libellé envoyé au PSP. Si le package a un `aliasBookId`, on swap pour
  // le titre du livre (alias commercial). Sinon fallback sur le vrai nom.
  let designation = realDesignation;
  let linkedBookId = null;
  if (packageDoc.aliasBookId) {
    const book = await getBookById(packageDoc.aliasBookId);
    if (book?.title) {
      designation = book.title;
      // book._id est un ObjectId — cast en string pour matcher le type
      // String du champ linkedBookId (et logger proprement).
      linkedBookId = String(book._id);
      logger.info('initiate: alias applied', {
        service: SERVICE, category: 'initiate', appId,
        realDesignation, aliasDesignation: designation, linkedBookId
      });
    }
  }

  const transaction = new CinetpayTransaction({
    appId,
    transactionId: merchantTransactionId,
    user: userId,
    package: packageId,
    amount,
    currency,
    phoneNumber: phoneNumber || undefined,
    customerName,
    description: realDesignation,
    aliasDesignation: linkedBookId ? designation : null,
    linkedBookId: linkedBookId,
    notifyUrl: notify_url,
    successUrl: success_url,
    failedUrl: failed_url,
    status: 'PENDING'
  });
  await transaction.save();

  // CinetPay impose client_first_name ET client_last_name requis,
  // chacun min 2 chars NON-blancs (espaces trimmés avant validation).
  //   - Si le pseudo a 2+ mots (ex: "Roland Nteguem") : split classique
  //     → display "Roland Nteguem".
  //   - Si le pseudo est en 1 mot (ex: "adekunle1") : on duplique le
  //     pseudo dans les 2 champs. Le backoffice affichera "adekunle1
  //     adekunle1" — c'est UNIQUEMENT le nom du client, aucune marque
  //     ou texte foreign concaténé.
  const fullName = String(customerName || 'Utilisateur').trim();
  const nameParts = fullName.split(/\s+/);
  let firstName, lastName;
  if (nameParts.length >= 2) {
    firstName = nameParts[0];
    lastName = nameParts.slice(1).join(' ');
  } else {
    firstName = fullName;
    lastName = fullName;
  }
  firstName = firstName.length < 2 ? firstName.padEnd(2, '_') : firstName.slice(0, 255);
  lastName = lastName.length < 2 ? lastName.padEnd(2, '_') : lastName.slice(0, 255);

  const payload = {
    currency,
    merchant_transaction_id: merchantTransactionId,
    amount,
    lang: 'fr',
    designation,
    client_first_name: firstName,
    client_last_name: lastName,
    client_email: email || 'no-reply@bigwinpronos.com',
    success_url,
    failed_url,
    notify_url,
    direct_pay: false
  };
  // client_phone_number est optionnel pour la nouvelle API CinetPay quand
  // direct_pay=false. On l'omet → le client le saisit sur la page hostée
  // (évite la double saisie côté mobile).
  if (phoneNumber) {
    payload.client_phone_number = phoneNumber;
  }

  try {
    const response = await callWithToken(appId, app, currency, (token) =>
      axios.post(`${config.apiUrl}/v1/payment`, payload, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        timeout: 20000
      })
    );

    const body = response.data;
    if (body?.code !== 200 || !body.payment_url) {
      logger.error('initiate: API rejected', { ...ctx, body });
      await CinetpayTransaction.findByIdAndDelete(transaction._id);
      throw new CinetpayError(
        body?.description || body?.details?.message || 'Initialisation du paiement échouée',
        response.status || 400,
        body
      );
    }

    transaction.cinetpayTransactionId = body.transaction_id;
    transaction.paymentToken = body.payment_token;
    transaction.notifyToken = body.notify_token;
    transaction.paymentUrl = body.payment_url;
    transaction.status = mapStatus(body.details?.status || 'INITIATED');
    transaction.detailsCode = body.details?.code;
    transaction.detailsStatus = body.details?.status;
    transaction.detailsMessage = body.details?.message;
    transaction.mustBeRedirected = body.details?.must_be_redirected;
    await transaction.save();

    await transaction.populate(['package', 'user']);
    logger.info('initiate: success', { ...ctx, merchantTransactionId, amount, currency });

    return { transaction, paymentUrl: body.payment_url };
  } catch (error) {
    logger.error('initiate: failed', {
      ...ctx,
      message: error.message,
      httpStatus: error.response?.status,
      responseData: error.response?.data
    });
    await CinetpayTransaction.findByIdAndDelete(transaction._id).catch(() => {});
    if (error instanceof CinetpayError || error instanceof AppError) throw error;
    if (error.response) {
      throw new CinetpayError(
        error.response.data?.description || error.response.data?.message || error.message,
        error.response.status,
        error.response.data
      );
    }
    throw error;
  }
}

async function checkTransactionStatus(appId, app, merchantTransactionId) {
  const ctx = { service: SERVICE, category: 'checkStatus', appId, merchantTransactionId };
  const config = getConfig(app);

  const transaction = await CinetpayTransaction.findOne({ appId, transactionId: merchantTransactionId })
    .populate(['package', 'user']);
  if (!transaction) {
    throw new AppError('Transaction non trouvée', 404, ErrorCodes.NOT_FOUND);
  }

  validateConfig(config, transaction.currency);

  try {
    const response = await callWithToken(appId, app, transaction.currency, (token) =>
      axios.get(`${config.apiUrl}/v1/payment/${encodeURIComponent(merchantTransactionId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000
      })
    );

    const body = response.data;
    logger.info('checkStatus: response', { ...ctx, code: body?.code, status: body?.status });

    const apiStatus = body?.status;
    transaction.status = mapStatus(apiStatus);
    transaction.detailsCode = body?.code;
    transaction.detailsStatus = apiStatus;
    transaction.detailsMessage = body?.message;
    if (body?.transaction_id) transaction.cinetpayTransactionId = body.transaction_id;
    if (body?.code && body.code !== 100 && body.code !== 200) {
      transaction.errorCode = String(body.code);
      transaction.errorMessage = body?.message;
    }

    await transaction.save();
    return transaction;
  } catch (error) {
    logger.error('checkStatus: failed', {
      ...ctx,
      message: error.message,
      httpStatus: error.response?.status,
      responseData: error.response?.data
    });
    if (error instanceof CinetpayError || error instanceof AppError) throw error;
    if (error.response) {
      throw new CinetpayError(
        error.response.data?.description || error.response.data?.message || error.message,
        error.response.status,
        error.response.data
      );
    }
    throw error;
  }
}

module.exports = {
  getConfig,
  detectCurrencyFromPhone,
  getAccessToken,
  initiatePayment,
  checkTransactionStatus,
  CinetpayError
};
