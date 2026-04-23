// services/user/AfribaPayService.js
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const AfribaPayTransaction = require('../../models/user/AfribaPayTransaction');
const Package = require('../../models/common/Package');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const logger = require('../../../core/logger');

const SERVICE = 'afribapay';

// Cache pour le token (global car même compte AfribaPay pour toutes les apps)
let cachedToken = null;
let tokenExpiry = null;

// Cache de la liste pays/opérateurs récupérée depuis l'API live AfribaPay.
// TTL 1h : évite de taper leur API à chaque requête du mobile tout en restant
// à jour si AfribaPay ajoute/retire un opérateur.
let cachedCountries = null;
let cachedCountriesExpiry = null;
const COUNTRIES_CACHE_TTL_MS = 60 * 60 * 1000; // 1 heure

// Path vers les données des pays — fallback si l'API live est down ou ratée
const COUNTRIES_DATA_PATH = path.join(__dirname, '../../../../data/payments/afribapayData.json');

// Classe d'erreur personnalisée
class AfribaPayError extends Error {
  constructor(message, statusCode, responseData) {
    super(message);
    this.name = 'AfribaPayError';
    this.statusCode = statusCode;
    this.responseData = responseData;
  }
}

// Codes pays couverts par AfribaPay (francophones + anglophones). Utilisé
// par _sanitizeAfribapayPhone pour détecter et retirer le 0 local qui suit
// parfois le code pays.
const AFRIBAPAY_COUNTRY_CODES = [
  '221', // Sénégal
  '223', // Mali
  '225', // Côte d'Ivoire
  '226', // Burkina Faso
  '227', // Niger
  '228', // Togo
  '229', // Bénin
  '237', // Cameroun
  '241', // Gabon
  '242', // Congo
  '243', // RDC
];

// Pays qui ont migré vers des numéros locaux à 10 digits commençant par 0
// (le 0 fait partie du numéro, pas un parasite à retirer). Bénin a migré en
// 2022 (format 01XXXXXXXX / 41XXXXXXXX), Côte d'Ivoire en 2021 (format
// 0XXXXXXXXX). Stripper le 0 pour ces pays casse tous les paiements.
//
// Congo-Brazzaville (242) : AfribaPay attend aussi le 0 gardé pour le format
// `242 0X XXXXXXXX` (validé empiriquement avec 242055605262 / 242065803305
// qui sont rejetés dès qu'on retire le 0).
const COUNTRIES_WITH_LEADING_ZERO_KEPT = new Set([
  '229', // Bénin (depuis 2022)
  '225', // Côte d'Ivoire (depuis 2021)
  '242', // Congo-Brazzaville
]);

/**
 * Normalise un numéro de téléphone pour l'API AfribaPay.
 *
 * AfribaPay rejette les numéros avec espaces ou avec "+". Il veut le code
 * pays directement suivi du numéro local, sans le "0" intermédiaire.
 *
 * Transformations :
 *   - Retire tous les caractères non-numériques (espaces, "+", tirets, parenthèses)
 *   - Si le résultat commence par un code pays AfribaPay suivi d'un "0", retire ce "0"
 *
 * Exemples :
 *   "229 016829954"   → "22916829954"
 *   "+229 01 68 29 95 4" → "22916829954"
 *   "22916829954"     → "22916829954"  (déjà propre, inchangé)
 *   "016829954"       → "016829954"    (pas de code pays préfixé, on touche pas)
 */
function _sanitizeAfribapayPhone(phone) {
  if (!phone) return phone;
  let cleaned = String(phone).replace(/\D/g, '');
  for (const cc of AFRIBAPAY_COUNTRY_CODES) {
    if (cleaned.startsWith(cc + '0')) {
      // Exception pays ayant migré vers numéros locaux 10 digits (BJ, CI) :
      // le 0 après le code pays fait partie du numéro, on ne strip pas.
      if (COUNTRIES_WITH_LEADING_ZERO_KEPT.has(cc)) break;
      cleaned = cc + cleaned.substring(cc.length + 1);
      break;
    }
  }
  return cleaned;
}

/**
 * Valide qu'un couple opérateur / pays / devise existe dans afribapayData.json.
 *
 * Pourquoi : le mobile peut envoyer un opérateur invalide pour le pays choisi
 * (cache obsolète, liste hardcodée, mapping frontend bugué). Sans validation,
 * on fait un appel API AfribaPay qui renvoie un 404 technique en anglais —
 * mauvaise UX. Avec validation, on refuse tôt avec un message clair.
 *
 * @throws AfribaPayError 400 si combinaison invalide
 */
function _validateOperatorForCountry(operator, country, currency) {
  if (!operator || !country || !currency) return; // on laisse la suite trancher

  let countryData;
  try {
    countryData = getCountriesData(country).country;
  } catch (e) {
    // Pays inconnu : on laisse AfribaPay répondre, pas à nous de trancher
    return;
  }

  const currencyBlock = countryData?.currencies?.[currency.toUpperCase()];
  if (!currencyBlock) {
    throw new AfribaPayError(
      `La devise ${currency} n'est pas supportée pour ce pays.`,
      400,
      { country, currency, code: 'CURRENCY_NOT_SUPPORTED' }
    );
  }

  const operators = currencyBlock.operators || [];
  const found = operators.find(
    op => String(op.operator_code).toLowerCase() === String(operator).toLowerCase()
  );

  if (!found) {
    const validList = operators.map(op => op.operator_name).join(', ');
    throw new AfribaPayError(
      `L'opérateur "${operator}" n'est pas disponible pour ce pays. Opérateurs valides : ${validList}.`,
      400,
      {
        country,
        currency,
        operator,
        validOperators: operators.map(op => op.operator_code),
        code: 'OPERATOR_NOT_AVAILABLE'
      }
    );
  }
}

/**
 * Récupérer la configuration AfribaPay
 * Priorité : Base de données > Variables d'environnement
 * @param {Object} app - Document App depuis req.currentApp
 * @returns {Object} Configuration AfribaPay
 */
function getConfig(app) {
  const dbConfig = app?.payments?.afribapay;
  
  // Si config en base et activée, l'utiliser
  if (dbConfig?.enabled) {
    return {
      apiUrl: dbConfig.apiUrl || process.env.AFRIBAPAY_API_URL,
      apiUser: dbConfig.apiUser || process.env.AFRIBAPAY_API_USER,
      apiKey: dbConfig.apiKey || process.env.AFRIBAPAY_API_KEY,
      merchantKey: dbConfig.merchantKey || process.env.AFRIBAPAY_MERCHANT_KEY,
      enabled: true
    };
  }
  
  // Fallback sur les variables d'environnement
  return {
    apiUrl: process.env.AFRIBAPAY_API_URL,
    apiUser: process.env.AFRIBAPAY_API_USER,
    apiKey: process.env.AFRIBAPAY_API_KEY,
    merchantKey: process.env.AFRIBAPAY_MERCHANT_KEY,
    enabled: !!(process.env.AFRIBAPAY_API_USER && process.env.AFRIBAPAY_API_KEY && process.env.AFRIBAPAY_MERCHANT_KEY)
  };
}

/**
 * Valider la configuration AfribaPay
 * @param {Object} config - Configuration à valider
 * @throws {AfribaPayError} Si configuration invalide
 */
function validateConfig(config) {
  if (!config.enabled) {
    throw new AfribaPayError('AfribaPay n\'est pas configuré pour cette application', 400);
  }
  
  if (!config.apiUrl || !config.apiUser || !config.apiKey || !config.merchantKey) {
    throw new AfribaPayError(
      'Configuration AfribaPay incomplète. Vérifiez apiUrl, apiUser, apiKey et merchantKey',
      500
    );
  }
}

/**
 * Générer les URLs de notification
 */
function generateUrls() {
  const baseUrl = process.env.APP_BASE_URL;
  return {
    notify_url: `${baseUrl}/api/payments/afribapay/webhook`,
    return_url: `${baseUrl}/api/payments/afribapay/success`,
    cancel_url: `${baseUrl}/api/payments/afribapay/cancel`
  };
}

/**
 * Obtenir le token d'accès
 * @param {Object} config - Configuration AfribaPay
 */
async function getAccessToken(config) {
  try {
    // Vérifier le cache
    if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
      return cachedToken;
    }

    const credentials = Buffer.from(`${config.apiUser}:${config.apiKey}`).toString('base64');
    
    const response = await axios.post(`${config.apiUrl}/v1/token`, {}, {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    if (response.data.data && response.data.data.access_token) {
      cachedToken = response.data.data.access_token;
      const expiresIn = response.data.data.expires_in || 86400;
      tokenExpiry = Date.now() + ((expiresIn - 300) * 1000);
      return cachedToken;
    } else {
      throw new AfribaPayError('Failed to get access token', 401, response.data);
    }
  } catch (error) {
    if (error instanceof AfribaPayError) {
      throw error;
    }
    if (error.response) {
      throw new AfribaPayError(
        error.response.data?.message || error.message,
        error.response.status,
        error.response.data
      );
    }
    throw error;
  }
}

/**
 * Récupérer les données des pays — lecture du fichier JSON local.
 * Utilisé comme fallback par getCountriesData() quand l'API live est KO.
 */
function _readCountriesFromFile(countryCode = null) {
  const fileContent = fs.readFileSync(COUNTRIES_DATA_PATH, 'utf8');
  const countriesData = JSON.parse(fileContent);

  if (countryCode) {
    const upperCountryCode = countryCode.toUpperCase();
    const countryData = countriesData[upperCountryCode];
    if (!countryData) {
      throw new AfribaPayError(`Country not found: ${countryCode}`, 404);
    }
    return { country: countryData };
  }
  return { countries: countriesData };
}

/**
 * Fetch la liste pays/opérateurs depuis l'API live AfribaPay.
 * Nécessite un token valide. Renvoie null si échec (laisse le caller fallback).
 *
 * @param {Object} app - Document App (pour récupérer la config)
 * @returns {Promise<Object|null>} Map { countryCode: countryData } ou null
 */
async function _fetchCountriesFromApi(app) {
  try {
    const config = getConfig(app);
    validateConfig(config);
    const accessToken = await getAccessToken(config);

    const response = await axios.get(`${config.apiUrl}/v1/countries`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    if (response.data?.data && typeof response.data.data === 'object') {
      // Normaliser : s'assurer que chaque opérateur a TOUS les champs
      // attendus (wallet, ussd_code, otp_required) même si l'API live
      // d'AfribaPay ne les renvoie pas tous. Sans ça, les anciens mobiles
      // qui font `json['wallet'] as int` crashent.
      return _normalizeCountriesResponse(response.data.data);
    }
    return null;
  } catch (error) {
    logger.warn('countries: API fetch failed, falling back to local JSON', {
      service: SERVICE,
      category: 'countries',
      error: error.message,
    });
    return null;
  }
}

/**
 * Normalise la réponse `/v1/countries` pour garantir la rétro-compatibilité
 * avec les anciens mobiles qui attendent tous les champs présents.
 *
 * Charge le JSON local et l'utilise comme squelette de référence : si
 * l'API live ne renvoie pas `wallet` pour un opérateur, on prend la valeur
 * du JSON local (ou 0 si l'opérateur n'existe pas localement).
 */
function _normalizeCountriesResponse(liveData) {
  // Lecture du JSON local pour reprendre les valeurs manquantes
  let localData = {};
  try {
    const fileContent = fs.readFileSync(COUNTRIES_DATA_PATH, 'utf8');
    localData = JSON.parse(fileContent);
  } catch (_) {
    // Si le fichier local n'est pas lisible, on continue avec les défauts
  }

  const normalized = {};
  for (const [countryCode, countryData] of Object.entries(liveData)) {
    const localCountry = localData[countryCode] || {};
    const normalizedCurrencies = {};

    const currencies = countryData?.currencies || {};
    for (const [currCode, currData] of Object.entries(currencies)) {
      const localCurrency = localCountry.currencies?.[currCode] || {};
      const localOps = localCurrency.operators || [];

      const normalizedOps = (currData.operators || []).map(op => {
        const localOp = localOps.find(lo => lo.operator_code === op.operator_code) || {};
        return {
          operator_code: op.operator_code ?? '',
          operator_name: op.operator_name ?? '',
          otp_required: typeof op.otp_required === 'number'
            ? op.otp_required
            : (typeof localOp.otp_required === 'number' ? localOp.otp_required : 0),
          ussd_code: op.ussd_code ?? localOp.ussd_code ?? '',
          wallet: typeof op.wallet === 'number'
            ? op.wallet
            : (typeof localOp.wallet === 'number' ? localOp.wallet : 0),
        };
      });

      normalizedCurrencies[currCode] = {
        ...currData,
        operators: normalizedOps
      };
    }

    normalized[countryCode] = {
      ...countryData,
      currencies: normalizedCurrencies
    };
  }

  return normalized;
}

/**
 * Pré-charger la liste pays/opérateurs depuis l'API live AfribaPay.
 *
 * À appeler explicitement depuis un job ou au boot si on veut éviter un
 * premier appel lent côté mobile. Sinon le cache se remplit lazy au 1er
 * appel de getCountriesDataAsync.
 */
async function refreshCountriesCache(app) {
  const fresh = await _fetchCountriesFromApi(app);
  if (fresh) {
    cachedCountries = fresh;
    cachedCountriesExpiry = Date.now() + COUNTRIES_CACHE_TTL_MS;
    logger.info('countries: cache refreshed', {
      service: SERVICE,
      category: 'countries',
      countryCount: Object.keys(fresh).length,
    });
    return fresh;
  }
  return null;
}

/**
 * Version async : préfère l'API live AfribaPay avec cache 1h, fallback JSON.
 * Les nouveaux appels doivent utiliser celle-ci. L'ancienne version sync
 * (getCountriesData) reste pour la compat des appels existants.
 *
 * @param {Object} app - Document App
 * @param {String} countryCode - Optionnel : filtrer sur un pays
 */
async function getCountriesDataAsync(app, countryCode = null) {
  // Hit cache si valide
  if (cachedCountries && cachedCountriesExpiry && Date.now() < cachedCountriesExpiry) {
    return _formatCountries(cachedCountries, countryCode);
  }

  // Cache miss ou expiré → tenter l'API live
  const fresh = await _fetchCountriesFromApi(app);
  if (fresh) {
    cachedCountries = fresh;
    cachedCountriesExpiry = Date.now() + COUNTRIES_CACHE_TTL_MS;
    return _formatCountries(fresh, countryCode);
  }

  // Fallback ultime : fichier JSON local
  logger.warn('countries: using JSON fallback (live API unavailable)', {
    service: SERVICE,
    category: 'countries',
  });
  return _readCountriesFromFile(countryCode);
}

function _formatCountries(countriesData, countryCode) {
  if (countryCode) {
    const upperCountryCode = countryCode.toUpperCase();
    const countryData = countriesData[upperCountryCode];
    if (!countryData) {
      throw new AfribaPayError(`Country not found: ${countryCode}`, 404);
    }
    return { country: countryData };
  }
  return { countries: countriesData };
}

/**
 * Version synchrone (legacy) — lit uniquement le fichier JSON.
 * Conservée pour les call sites qui ne peuvent pas être async facilement
 * (validation dans initiatePayment). Privilégier getCountriesDataAsync.
 */
function getCountriesData(countryCode = null) {
  try {
    // Priorité 1 : utiliser le cache API live si disponible
    if (cachedCountries) {
      return _formatCountries(cachedCountries, countryCode);
    }
    // Priorité 2 : fallback JSON local
    return _readCountriesFromFile(countryCode);
  } catch (error) {
    if (error instanceof AfribaPayError) {
      throw error;
    }
    throw new AfribaPayError(`Error loading countries data: ${error.message}`, 500);
  }
}

/**
 * Vérifier si OTP est requis
 */
function isOtpRequired(operator, country) {
  try {
    const { country: countryData } = getCountriesData(country);
    
    for (const currencyData of Object.values(countryData.currencies)) {
      const operatorData = currencyData.operators.find(op => op.operator_code === operator);
      if (operatorData) {
        return Boolean(operatorData.otp_required);
      }
    }
    return false;
  } catch (error) {
    return false;
  }
}

/**
 * Vérifier la signature HMAC
 * @param {String} receivedSignature - Signature reçue
 * @param {String} payload - Payload JSON
 * @param {String} apiKey - Clé API pour HMAC
 */
function verifyHmacToken(receivedSignature, payload, apiKey) {
  try {
    if (!apiKey || !receivedSignature) return false;
    const calculatedSignature = crypto
      .createHmac('sha256', apiKey)
      .update(payload)
      .digest('hex');
    return calculatedSignature === receivedSignature;
  } catch (error) {
    return false;
  }
}

/**
 * Initier un paiement AfribaPay
 * @param {String} appId - ID de l'application
 * @param {Object} app - Document App depuis req.currentApp
 * @param {String} userId - ID de l'utilisateur
 * @param {String} packageId - ID du package
 * @param {String} phoneNumber - Numéro de téléphone
 * @param {String} operator - Code opérateur
 * @param {String} country - Code pays
 * @param {String} currency - Devise
 * @param {String} otpCode - Code OTP (optionnel)
 */
async function initiatePayment(appId, app, userId, packageId, phoneNumber, operator, country, currency, otpCode = null) {
  const ctx = {
    service: SERVICE,
    category: 'initiate',
    appId,
    userId: String(userId),
    packageId,
    operator,
    country,
    currency,
  };

  try {
    logger.info('initiate: start', ctx);

    // 0. Normaliser le numéro avant tout — AfribaPay rejette les espaces et
    //    veut le code pays directement suivi du numéro, sans le 0 local.
    //    Ex. in:  "229 016829954"  out: "22916829954"
    phoneNumber = _sanitizeAfribapayPhone(phoneNumber);

    const config = getConfig(app);
    validateConfig(config);

    const packageDoc = await Package.findOne({ _id: packageId, appId });
    if (!packageDoc) {
      throw new AppError('Package non trouvé', 404, ErrorCodes.NOT_FOUND);
    }

    const amount = packageDoc.pricing.get(currency);
    if (!amount || amount <= 0) {
      throw new AppError(`Prix ${currency} non disponible pour ce package`, 400, ErrorCodes.VALIDATION_ERROR);
    }

    // Valide l'opérateur pour ce pays+devise dans le JSON avant de taper l'API.
    _validateOperatorForCountry(operator, country, currency);

    const otpRequiredCheck = isOtpRequired(operator, country);
    if (otpRequiredCheck && !otpCode) {
      throw new AfribaPayError(
        `Code OTP requis pour ${operator} dans ce pays`,
        400,
        {
          code: 'OTP_REQUIRED',
          operator,
          country,
          currency,
          message: 'Veuillez fournir le code OTP pour cet opérateur'
        }
      );
    }

    const orderId = `order-${Date.now()}`;
    const { notify_url, return_url, cancel_url } = generateUrls();
    const accessToken = await getAccessToken(config);

    const paymentData = {
      operator,
      country,
      phone_number: phoneNumber,
      amount,
      currency,
      order_id: orderId,
      merchant_key: config.merchantKey,
      reference_id: `${packageDoc.name.fr} - ${packageDoc.duration} jours`,
      lang: 'fr',
      notify_url,
      return_url,
      cancel_url
    };

    if (otpRequiredCheck && otpCode) {
      paymentData.otp_code = otpCode;
    }

    // Appel API AfribaPay avec retry auto sur 401 (token expiré par race condition).
    let response;
    try {
      response = await axios.post(`${config.apiUrl}/v1/pay/payin`, paymentData, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });
    } catch (err) {
      if (err.response?.status === 401) {
        logger.warn('initiate: token expired, retrying with fresh token', { ...ctx, orderId });
        cachedToken = null;
        tokenExpiry = null;
        const freshToken = await getAccessToken(config);
        response = await axios.post(`${config.apiUrl}/v1/pay/payin`, paymentData, {
          headers: {
            'Authorization': `Bearer ${freshToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        });
      } else {
        throw err;
      }
    }

    if (!response.data.data) {
      logger.error('initiate: empty data in response', {
        ...ctx,
        orderId,
        response: response.data,
      });
      throw new AfribaPayError(
        response.data.error?.message || 'Payment initialization failed',
        response.status || 400,
        response.data
      );
    }

    const responseData = response.data.data;
    
    const afribaPayTransaction = new AfribaPayTransaction({
      appId, 
      transactionId: responseData.transaction_id,
      orderId,
      user: userId,
      package: packageId,
      operator,
      country,
      phoneNumber,
      otpCode,
      amount: responseData.amount || amount,
      currency,
      merchantKey: config.merchantKey,
      referenceId: `${packageDoc.name.fr} - ${packageDoc.duration} jours`,
      notifyUrl: notify_url,
      returnUrl: return_url,
      cancelUrl: cancel_url,
      lang: 'fr',
      status: 'PENDING',
      providerId: responseData.provider_id,
      providerLink: responseData.provider_link,
      taxes: responseData.taxes,
      fees: responseData.fees,
      feesTaxesTtc: responseData.fees_taxes_ttc,
      amountTotal: responseData.amount_total,
      dateCreated: responseData.date_created ? new Date(responseData.date_created) : new Date(),
      apiRequestId: response.data.request_id,
      apiRequestTime: response.data.request_time,
      apiRequestIp: response.data.request_ip
    });

    await afribaPayTransaction.save();
    await afribaPayTransaction.populate(['package', 'user']);

    logger.info('initiate: success', {
      ...ctx,
      orderId,
      transactionId: responseData.transaction_id,
      amount,
    });

    return {
      transaction: afribaPayTransaction
    };

  } catch (error) {
    logger.error('initiate: failed', {
      ...ctx,
      message: error.message,
      httpStatus: error.response?.status,
      responseData: error.response?.data,
      stack: error.stack,
    });

    if (error.response) {
      if (error.response.status === 401) {
        cachedToken = null;
        tokenExpiry = null;
      }

      // Message d'erreur brut renvoyé par AfribaPay
      const raw = error.response.data?.error?.message
        || error.response.data?.message
        || error.message;

      // Traduire les messages techniques anglais en messages UX lisibles côté
      // mobile. Tout nouveau cas rencontré en prod peut être ajouté ici.
      let friendly = raw;
      if (/operator configuration missing/i.test(raw)) {
        friendly = 'Cet opérateur n\'est pas disponible pour ce pays. Merci de choisir un autre opérateur.';
      } else if (/invalid phone number/i.test(raw)) {
        friendly = 'Numéro de téléphone invalide. Vérifie le format (sans espaces, avec l\'indicatif pays).';
      } else if (/insufficient.*fund/i.test(raw)) {
        friendly = 'Solde insuffisant sur ce numéro mobile money.';
      }

      throw new AfribaPayError(
        friendly,
        error.response.status,
        error.response.data
      );
    }

    if (error instanceof AfribaPayError || error instanceof AppError) {
      throw error;
    }

    throw error;
  }
}

/**
 * Vérifier le statut d'une transaction
 * @param {String} appId - ID de l'application
 * @param {Object} app - Document App depuis req.currentApp
 * @param {String} orderId - ID de la commande ou transaction
 */
async function checkTransactionStatus(appId, app, orderId) {
  try {
    // 1. Récupérer et valider la config
    const config = getConfig(app);
    validateConfig(config);

    // 2. Trouver la transaction
    const transaction = await AfribaPayTransaction.findOne({ 
      appId, 
      $or: [{ orderId }, { transactionId: orderId }] 
    }).populate(['package', 'user']);

    if (!transaction) {
      throw new AppError('Transaction non trouvée', 404, ErrorCodes.NOT_FOUND);
    }

    // 3. Obtenir le token et vérifier le statut (avec retry auto sur 401)
    const accessToken = await getAccessToken(config);
    let response;
    try {
      response = await axios.get(
        `${config.apiUrl}/v1/status?order_id=${transaction.orderId}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (err) {
      if (err.response?.status === 401) {
        cachedToken = null;
        tokenExpiry = null;
        const freshToken = await getAccessToken(config);
        response = await axios.get(
          `${config.apiUrl}/v1/status?order_id=${transaction.orderId}`,
          {
            headers: {
              'Authorization': `Bearer ${freshToken}`,
              'Content-Type': 'application/json'
            }
          }
        );
      } else {
        throw err;
      }
    }

    // 4. Mettre à jour la transaction
    if (response.data.data) {
      const paymentData = response.data.data;

      transaction.status = paymentData.status;
      transaction.operatorId = paymentData.operator_id;
      transaction.statusDate = paymentData.status_date ? new Date(paymentData.status_date) : new Date();
      transaction.apiRequestId = response.data.request_id;
      transaction.apiRequestTime = response.data.request_time;

      await transaction.save();
    }

    return transaction;

  } catch (error) {
    if (error.response) {
      throw new AfribaPayError(
        error.response.data?.error?.message || error.response.data?.message || error.message,
        error.response.status,
        error.response.data
      );
    }

    if (error instanceof AfribaPayError || error instanceof AppError) {
      throw error;
    }

    throw error;
  }
}

/**
 * Déclencher l'envoi d'un OTP pour un wallet AfribaPay (Coris, LigdiCash, etc.).
 *
 * Pour les wallets (opérateurs avec `wallet: 1`), AfribaPay exige un flow 2 étapes :
 *   1. POST /v1/pay/otp → le user reçoit un code OTP par SMS
 *   2. POST /v1/pay/payin avec otp_code → paiement validé
 *
 * Cette fonction gère uniquement l'étape 1. L'étape 2 passe par initiatePayment
 * normal avec le otpCode récupéré.
 *
 * @param {String} appId - ID de l'application
 * @param {Object} app - Document App
 * @param {String} packageId - ID du package (pour calculer l'amount)
 * @param {String} phoneNumber - Numéro du user
 * @param {String} operator - wligdicash, coris, etc.
 * @param {String} country - BF, BJ, etc.
 * @param {String} currency - XOF, XAF, etc.
 * @returns {Promise<Object>} { message, status } d'AfribaPay
 */
async function requestWalletOtp(appId, app, packageId, phoneNumber, operator, country, currency) {
  try {
    // Normaliser le numéro comme dans initiatePayment
    phoneNumber = _sanitizeAfribapayPhone(phoneNumber);

    const config = getConfig(app);
    validateConfig(config);

    // Valider la combinaison operator/country/currency
    _validateOperatorForCountry(operator, country, currency);

    // Récupérer le prix du package
    const packageDoc = await Package.findOne({ _id: packageId, appId });
    if (!packageDoc) {
      throw new AppError('Package non trouvé', 404, ErrorCodes.NOT_FOUND);
    }
    const amount = packageDoc.pricing.get(currency);
    if (!amount || amount <= 0) {
      throw new AppError(`Prix ${currency} non disponible pour ce package`, 400, ErrorCodes.VALIDATION_ERROR);
    }

    const otpData = {
      operator,
      country,
      phone_number: phoneNumber,
      amount,
      currency,
      merchant_key: config.merchantKey
    };

    const accessToken = await getAccessToken(config);

    // Retry sur 401 comme dans initiatePayment
    let response;
    try {
      response = await axios.post(`${config.apiUrl}/v1/pay/otp`, otpData, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });
    } catch (err) {
      if (err.response?.status === 401) {
        cachedToken = null;
        tokenExpiry = null;
        const freshToken = await getAccessToken(config);
        response = await axios.post(`${config.apiUrl}/v1/pay/otp`, otpData, {
          headers: {
            'Authorization': `Bearer ${freshToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        });
      } else {
        throw err;
      }
    }

    if (!response.data?.data) {
      throw new AfribaPayError(
        response.data?.error?.message || 'Échec de l\'envoi du code OTP',
        response.status || 400,
        response.data
      );
    }

    return {
      message: response.data.data.message || 'Code OTP envoyé. Vérifiez votre téléphone.',
      status: response.data.data.status || 'SUCCESS'
    };
  } catch (error) {
    // Laisser passer les AppError et AfribaPayError déjà typées
    if (error instanceof AfribaPayError || error instanceof AppError) {
      throw error;
    }

    // Wrapper les AxiosError avec message FR lisible (même pattern que initiatePayment)
    if (error.response) {
      const raw = error.response.data?.error?.message
        || error.response.data?.message
        || error.message;

      let friendly = raw;
      if (/operator configuration missing/i.test(raw)) {
        friendly = 'Cet opérateur n\'est pas disponible pour ce pays. Merci de choisir un autre opérateur.';
      } else if (/invalid phone number/i.test(raw)) {
        friendly = 'Numéro de téléphone invalide. Vérifie le format (sans espaces, avec l\'indicatif pays).';
      } else if (/insufficient.*fund/i.test(raw)) {
        friendly = 'Solde insuffisant sur ce numéro mobile money.';
      }

      throw new AfribaPayError(
        friendly,
        error.response.status,
        error.response.data
      );
    }

    // Autre erreur (réseau, timeout…)
    throw new AfribaPayError(
      error.message || 'Erreur lors de l\'envoi du code OTP',
      500
    );
  }
}

module.exports = {
  getConfig,
  initiatePayment,
  checkTransactionStatus,
  requestWalletOtp,        // nouveau : flow 2-step pour wallets
  getCountriesData,        // legacy sync (cache + fallback JSON)
  getCountriesDataAsync,   // preferred : API live + cache 1h + fallback JSON
  refreshCountriesCache,
  verifyHmacToken,
  getAccessToken,
  isOtpRequired,
  AfribaPayError
};