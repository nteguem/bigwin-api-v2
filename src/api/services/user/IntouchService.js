// services/user/IntouchService.js
//
// Integration InTouch / TouchPay — Paiement Marchand (C2B) via API directe.
//   - PUT /apidist/sec/touchpayapi/{Agence}/transaction  → init paiement (Digest auth)
//   - POST /apidist/sec/{Agence}/check_status            → verifier statut (Basic auth)
//
// Particularites :
//   - 2 niveaux d'auth : HTTP (Basic/Digest avec basicUser+basicPassword)
//     ET applicatif (partner_id + login_api + password_api dans le body).
//   - Le webhook InTouch n'est PAS signe — on rappelle systematiquement
//     check_status pour confirmer (cf. controller).

const axios = require('axios');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const IntouchTransaction = require('../../models/user/IntouchTransaction');
const Package = require('../../models/common/Package');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

// ---------------------------------------------
//  Erreur personnalisee
// ---------------------------------------------
class IntouchError extends Error {
  constructor(message, statusCode, responseData) {
    super(message);
    this.name = 'IntouchError';
    this.statusCode = statusCode;
    this.responseData = responseData;
  }
}

// ---------------------------------------------
//  Mapping pays/operateur → serviceCode InTouch
// ---------------------------------------------
const SERVICE_CODES = {
  'CM:mtn': 'PAIEMENTMARCHAND_MTN_CM',
  'CM:om':  'CM_PAIEMENTMARCHAND_OM_TP'
  // À etendre quand on activera d'autres pays (CI, SN, BJ, ...)
};

function getServiceCode(countryCode, operator) {
  const code = SERVICE_CODES[`${countryCode}:${operator}`];
  if (!code) {
    throw new IntouchError(
      `Combinaison pays/operateur non supportee: ${countryCode}/${operator}`,
      400
    );
  }
  return code;
}

// ---------------------------------------------
//  Devise par defaut selon le pays
// ---------------------------------------------
function currencyForCountry(countryCode) {
  switch ((countryCode || '').toUpperCase()) {
    case 'CM': case 'CG': case 'CF': case 'GA': case 'TD': case 'GQ': return 'XAF';
    case 'CI': case 'SN': case 'BJ': case 'BF': case 'TG': case 'NE': case 'ML': return 'XOF';
    case 'CD': return 'CDF';
    case 'GN': return 'GNF';
    default:   return 'XAF';
  }
}

// ---------------------------------------------
//  Detecter le pays depuis le numero de telephone
//  (prefixe ITU + couverture Afrique francophone). Retourne null si inconnu.
// ---------------------------------------------
const PHONE_PREFIX_TO_COUNTRY = {
  '237': 'CM', '225': 'CI', '221': 'SN', '229': 'BJ',
  '243': 'CD', '226': 'BF', '227': 'NE', '228': 'TG',
  '223': 'ML', '224': 'GN', '241': 'GA', '242': 'CG',
  '236': 'CF', '235': 'TD', '240': 'GQ'
};

function detectCountryFromPhone(phone) {
  const cleaned = String(phone || '').replace(/\D/g, '');
  // Iterer dans l'ordre des prefixes les plus longs d'abord (par securite,
  // tous les prefixes ITU africains font 3 chiffres ici donc l'ordre n'importe pas).
  for (const [prefix, code] of Object.entries(PHONE_PREFIX_TO_COUNTRY)) {
    if (cleaned.startsWith(prefix)) return code;
  }
  return null;
}

// ---------------------------------------------
//  Normaliser le numero de telephone
//  InTouch attend le numero LOCAL sans prefixe pays (ex: "679711656" pour le CM).
// ---------------------------------------------
function normalizePhone(phone, countryCode) {
  let cleaned = String(phone || '').replace(/\D/g, '');
  const cc = (countryCode || '').toUpperCase();
  if (cc === 'CM') {
    // +237679711656 / 237679711656 → 679711656
    if (cleaned.startsWith('237') && cleaned.length === 12) cleaned = cleaned.slice(3);
    // 0679711656 → 679711656 (rare au CM mais on couvre)
    if (cleaned.startsWith('0') && cleaned.length === 10) cleaned = cleaned.slice(1);
  }
  // Pour les autres pays : on retirera le prefixe pays mais on garde le format
  // local tel que retourne par InTouch dans ses exemples. Les regles exactes
  // seront ajoutees au fur et a mesure que chaque pays sera active.
  return cleaned;
}

// ---------------------------------------------
//  Lire la config depuis app (base de donnees) — multi-pays
//  Chaque pays a sa propre config dans `payments.intouch.configs[]`.
//  Le master switch `enabled` doit aussi etre actif.
// ---------------------------------------------
function getConfig(app, countryCode) {
  const root = app?.payments?.intouch;
  if (!root?.enabled) {
    throw new IntouchError('InTouch non actif pour cette application', 400);
  }
  const cc = String(countryCode || '').toUpperCase();
  if (!cc) {
    throw new IntouchError('countryCode requis pour resoudre la config InTouch', 400);
  }
  const found = (root.configs || []).find(c => c.countryCode === cc && c.enabled);
  if (!found) {
    throw new IntouchError(`Aucune config InTouch active pour le pays ${cc}`, 400);
  }
  const required = ['agence', 'partnerId', 'loginApi', 'passwordApi', 'basicUser', 'basicPassword'];
  for (const f of required) {
    if (!found[f]) {
      throw new IntouchError(`Configuration InTouch ${cc} incomplete (champ manquant: ${f})`, 500);
    }
  }
  return {
    apiUrl:        root.apiUrl || 'https://apidist.gutouch.net/apidist/sec',
    countryCode:   cc,
    agence:        found.agence,
    partnerId:     found.partnerId,
    loginApi:      found.loginApi,
    passwordApi:   found.passwordApi,
    basicUser:     found.basicUser,
    basicPassword: found.basicPassword
  };
}

// ---------------------------------------------
//  Mapping statut InTouch → statut interne
//  InTouch renvoie soit une string ("SUCCESS", "FAILED", "PENDING") soit
//  un code numerique (200, 202, 300, 400, ...). Les codes < 300 = success,
//  202/204/206 = pending, le reste = failed. Cf. screenshot table dans la
//  conversation d'integration.
// ---------------------------------------------
function mapApiStatus(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).toUpperCase();
  // Strings webhook
  if (s === 'SUCCESS' || s === 'SUCCESSFUL' || s === 'OK')       return 'SUCCESS';
  if (s === 'FAILED' || s === 'ERROR' || s === 'CANCELED' || s === 'CANCELLED') return 'FAILED';
  if (s === 'PENDING')                                            return 'PENDING';
  if (s === 'INITIATED' || s === 'IN_PROGRESS')                   return 'INITIATED';
  // Codes numeriques
  if (s === '200')                                                return 'SUCCESS';
  if (['202', '204', '206'].includes(s))                          return 'PENDING';
  if (s === '203')                                                return 'INITIATED'; // duplicate recent
  if (['207', '300', '400', '401', '402', '404'].includes(s))     return 'FAILED';
  return null;
}

// ---------------------------------------------
//  HTTP Digest auth — implementation manuelle (axios ne le gere pas)
// ---------------------------------------------
function parseDigestChallenge(header) {
  const out = {};
  const params = String(header).replace(/^Digest\s+/i, '');
  const regex = /(\w+)\s*=\s*(?:"([^"]*)"|([^,\s]+))/g;
  let m;
  while ((m = regex.exec(params)) !== null) {
    out[m[1]] = m[2] !== undefined ? m[2] : m[3];
  }
  return out;
}

function buildDigestHeader({ method, uri, username, password, realm, nonce, qop, opaque, algorithm }) {
  const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const nc = '00000001';
  const cnonce = crypto.randomBytes(8).toString('hex');
  const response = qop
    ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`);

  const parts = [
    `Digest username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `algorithm=${algorithm || 'MD5'}`,
    `response="${response}"`
  ];
  if (qop)    parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  if (opaque) parts.push(`opaque="${opaque}"`);
  return parts.join(', ');
}

/**
 * Effectue une requete HTTP avec Digest auth (challenge-response).
 *   1. Premier appel sans auth → 401 + WWW-Authenticate: Digest ...
 *   2. Replay avec Authorization: Digest ... calcule.
 */
async function digestRequest(method, url, payload, username, password) {
  let challenge;
  try {
    const resp = await axios.request({
      method, url, data: payload,
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });
    return resp;
  } catch (err) {
    if (err.response?.status !== 401) throw err;
    const wwwAuth = err.response.headers['www-authenticate'];
    if (!wwwAuth || !/^digest/i.test(wwwAuth)) {
      throw new IntouchError('Pas de challenge Digest dans la 401', 401, err.response.data);
    }
    challenge = parseDigestChallenge(wwwAuth);
  }

  const u = new URL(url);
  const uri = u.pathname + u.search;
  const authHeader = buildDigestHeader({
    method:    method.toUpperCase(),
    uri,
    username,
    password,
    realm:     challenge.realm,
    nonce:     challenge.nonce,
    qop:       challenge.qop,
    opaque:    challenge.opaque,
    algorithm: challenge.algorithm
  });

  return axios.request({
    method, url, data: payload,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': authHeader
    },
    timeout: 30000
  });
}

// ---------------------------------------------
//  Generer les URLs callback
// ---------------------------------------------
function generateUrls() {
  const base = process.env.APP_BASE_URL;
  return {
    callback_url: `${base}/api/payments/intouch/webhook`
  };
}

// ---------------------------------------------
//  INITIER UN PAIEMENT
//  PUT /touchpayapi/{Agence}/transaction (Digest auth)
//  → push USSD au client, statut final via webhook + check_status
// ---------------------------------------------
async function initiatePayment(appId, app, user, packageId, phoneNumber, operator, requestedCountry) {
  let transaction;
  let payload;
  try {
    console.log(`[InTouch] Init — user=${user._id}, package=${packageId}, phone=${phoneNumber}, op=${operator}, country=${requestedCountry || 'auto'}`);

    // 1. Resolution du pays : explicite > deduit du phoneNumber
    const country = (requestedCountry && String(requestedCountry).toUpperCase())
      || detectCountryFromPhone(phoneNumber);
    if (!country) {
      throw new AppError(
        'Impossible de detecter le pays depuis le numero. Precisez `country` (ISO-2).',
        400, ErrorCodes.VALIDATION_ERROR
      );
    }

    // 2. Config du pays (lance si pays non configure / disabled)
    const config = getConfig(app, country);

    // 3. Package
    const packageDoc = await Package.findOne({ _id: packageId, appId });
    if (!packageDoc) throw new AppError('Package non trouve', 404, ErrorCodes.NOT_FOUND);

    // 4. Operator + serviceCode
    const op = String(operator || '').toLowerCase();
    if (!['mtn', 'om'].includes(op)) {
      throw new AppError('operator doit etre "mtn" ou "om"', 400, ErrorCodes.VALIDATION_ERROR);
    }
    const serviceCode = getServiceCode(config.countryCode, op);

    // 5. Devise + montant
    const currency = currencyForCountry(config.countryCode);
    const amount = packageDoc.pricing?.get
      ? packageDoc.pricing.get(currency)
      : packageDoc.pricing?.[currency];
    if (!amount || amount <= 0) {
      throw new AppError(`Prix ${currency} non disponible pour ce package`, 400, ErrorCodes.VALIDATION_ERROR);
    }

    // 5. Numero normalise (sans prefixe pays)
    const recipientNumber = normalizePhone(phoneNumber, config.countryCode);
    if (!recipientNumber) {
      throw new AppError('phoneNumber invalide', 400, ErrorCodes.VALIDATION_ERROR);
    }

    // 6. Infos client
    const nameParts = (user.pseudo || user.name || user.username || 'Utilisateur').split(' ');
    const firstName = nameParts[0] || 'Utilisateur';
    const lastName  = nameParts.slice(1).join(' ') || firstName;
    const email     = user.email || `user_${user._id}@bigwin.app`;
    const designation = `${packageDoc.name?.fr || packageDoc.name} - ${packageDoc.duration}j`;

    // 7. ID transaction unique (notre cote — ce sera echoe dans le webhook
    //    en tant que partner_transaction_id).
    const idFromClient = `BW-${Date.now()}-${uuidv4().substring(0, 8)}`;

    // 8. URLs callback
    const { callback_url } = generateUrls();

    // 9. Sauvegarder en base avant l'appel API
    transaction = new IntouchTransaction({
      appId,
      transactionId:      idFromClient,
      user:               user._id,
      package:            packageId,
      countryCode:        config.countryCode,
      amount,
      currency,
      status:             'PENDING',
      operator:           op,
      serviceCode,
      recipientNumber,
      customerEmail:      email,
      customerFirstName:  firstName,
      customerLastName:   lastName,
      callbackUrl:        callback_url,
      designation
    });
    await transaction.save();
    console.log(`[InTouch] Transaction sauvegardee: ${idFromClient}`);

    // 10. Appel API InTouch — PUT /touchpayapi/{Agence}/transaction
    const url = `${config.apiUrl}/touchpayapi/${config.agence}/transaction`
      + `?loginAgent=${encodeURIComponent(config.loginApi)}`
      + `&passwordAgent=${encodeURIComponent(config.passwordApi)}`;

    payload = {
      idFromClient,
      additionnalInfos: {
        recipientEmail:     email,
        recipientFirstName: firstName,
        recipientLastName:  lastName,
        destinataire:       recipientNumber
      },
      amount,
      callback:        callback_url,
      recipientNumber,
      serviceCode
    };

    const response = await digestRequest('PUT', url, payload, config.basicUser, config.basicPassword);
    console.log('[InTouch] Reponse init:', response.data);
    const data = response.data || {};

    // 11. Mapper le statut initial — sans donnee fiable on tombe sur INITIATED
    //     (le statut final viendra via webhook / check_status).
    const mapped = mapApiStatus(data.status ?? data.code);
    transaction.gutouchTransactionId = data.gu_transaction_id || data.numTransaction || data.gutouchTransactionId;
    transaction.status = mapped || 'INITIATED';
    if (data.commission != null) transaction.commission = Number(data.commission) || 0;
    if (data.message) transaction.errorMessage = data.message;
    await transaction.save();

    await transaction.populate(['package', 'user']);
    console.log(`[InTouch] Init OK — idFromClient: ${idFromClient}, status: ${transaction.status}`);

    return { transaction };
  } catch (error) {
    console.error('[InTouch] Erreur init:', error.message, error.responseData || '');
    // Nettoyer la transaction creee si l'appel API a echoue
    if (transaction?._id) {
      await IntouchTransaction.findByIdAndDelete(transaction._id).catch(() => {});
    }
    if (error instanceof IntouchError || error instanceof AppError) throw error;
    if (error.response) {
      console.error('[InTouch] Reponse erreur:', JSON.stringify(error.response.data));
      console.error('[InTouch] Payload envoye:', JSON.stringify(payload || 'payload hors scope'));
      throw new IntouchError(
        error.response.data?.message || error.message,
        error.response.status,
        error.response.data
      );
    }
    throw error;
  }
}

// ---------------------------------------------
//  VERIFIER LE STATUT D'UNE TRANSACTION
//  POST /{Agence}/check_status (Basic auth)
//  Utilise par le controller `checkStatus` ET par le webhook (anti-spoofing).
// ---------------------------------------------
async function checkTransactionStatus(appId, app, transactionId) {
  try {
    // 1. Trouver la transaction
    const transaction = await IntouchTransaction.findOne({ appId, transactionId })
      .populate(['package', 'user']);
    if (!transaction) throw new AppError('Transaction non trouvee', 404, ErrorCodes.NOT_FOUND);

    // 2. Config — utilise le countryCode stocke sur la transaction (chaque pays
    //    = compte e-marchand InTouch distinct avec credentials propres).
    const config = getConfig(app, transaction.countryCode);

    // 3. POST /{Agence}/check_status — Basic auth
    const url = `${config.apiUrl}/${config.agence}/check_status`;
    const body = {
      partner_id:             config.partnerId,
      partner_transaction_id: transaction.transactionId,
      login_api:              config.loginApi,
      password_api:           config.passwordApi
    };

    const response = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json' },
      auth:    { username: config.basicUser, password: config.basicPassword },
      timeout: 30000
    });

    console.log(`[InTouch] check_status pour ${transactionId}:`, response.data);
    const data = response.data || {};

    // 4. Mapper le statut
    const mapped = mapApiStatus(data.status ?? data.code);
    if (mapped) transaction.status = mapped;

    if (data.gu_transaction_id) transaction.gutouchTransactionId = data.gu_transaction_id;
    if (data.commission != null) transaction.commission = Number(data.commission) || 0;
    if (data.message) transaction.errorMessage = data.message;
    if (data.code) transaction.errorCode = String(data.code);

    await transaction.save();
    return transaction;
  } catch (error) {
    console.error('[InTouch] Erreur check statut:', error.message);
    if (error instanceof IntouchError || error instanceof AppError) throw error;
    if (error.response) {
      throw new IntouchError(
        error.response.data?.message || error.message,
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
  mapApiStatus,
  normalizePhone,
  detectCountryFromPhone,
  getServiceCode,
  currencyForCountry,
  IntouchError
};
