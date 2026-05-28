// services/user/PawapayService.js
//
// Integration pawaPay v2 — collecte mobile money (deposits) multi-pays.
//   - POST /v2/deposits           → init paiement (Bearer JWT)
//   - GET  /v2/deposits/{id}      → check status (Bearer JWT)
//   - Webhook : configure dans le dashboard pawaPay, signature RFC 9421
//
// Particularites :
//   - 1 token = 20 pays africains (CMR, CI, SN, BJ, BF, CD, GA, GH, KE,
//     UG, TZ, ZM, NG, RW, MW, LS, MZ, SL, ...). Le pays est encode dans
//     le `provider` (ex: MTN_MOMO_CMR).
//   - Sandbox et prod ont des URLs distinctes + tokens distincts.
//   - L'ID transaction est un UUID v4 que NOUS generons et que pawaPay
//     reutilise tel quel (depositId). Pas de mapping interne/externe.

const axios = require('axios');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const PawapayTransaction = require('../../models/user/PawapayTransaction');
const Package = require('../../models/common/Package');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

// ---------------------------------------------
//  Erreur personnalisee
// ---------------------------------------------
class PawapayError extends Error {
  constructor(message, statusCode, responseData) {
    super(message);
    this.name = 'PawapayError';
    this.statusCode = statusCode;
    this.responseData = responseData;
  }
}

// ---------------------------------------------
//  Mapping ISO-2 → ISO-3 (pawaPay attend ISO-3 dans le code provider)
// ---------------------------------------------
const ISO2_TO_ISO3 = {
  CM: 'CMR', CI: 'CIV', SN: 'SEN', BJ: 'BEN', BF: 'BFA',
  CD: 'COD', GA: 'GAB', CG: 'COG', GH: 'GHA', KE: 'KEN',
  RW: 'RWA', UG: 'UGA', TZ: 'TZA', ZM: 'ZMB', NG: 'NGA',
  MW: 'MWI', LS: 'LSO', MZ: 'MOZ', SL: 'SLE'
};

// ---------------------------------------------
//  Mapping pays → devise par defaut
// ---------------------------------------------
function currencyForCountry(countryCode) {
  switch ((countryCode || '').toUpperCase()) {
    case 'CM': case 'CG': case 'GA':                  return 'XAF';
    case 'CI': case 'SN': case 'BJ': case 'BF':       return 'XOF';
    case 'CD':                                         return 'CDF';
    case 'GH':                                         return 'GHS';
    case 'KE':                                         return 'KES';
    case 'UG':                                         return 'UGX';
    case 'TZ':                                         return 'TZS';
    case 'ZM':                                         return 'ZMW';
    case 'NG':                                         return 'NGN';
    case 'RW':                                         return 'RWF';
    case 'MW':                                         return 'MWK';
    case 'LS':                                         return 'LSL';
    case 'MZ':                                         return 'MZN';
    case 'SL':                                         return 'SLE';
    default:                                           return 'XAF';
  }
}

// ---------------------------------------------
//  Detection pays depuis le numero (prefixe ITU)
// ---------------------------------------------
const PHONE_PREFIX_TO_COUNTRY = {
  '237': 'CM', '225': 'CI', '221': 'SN', '229': 'BJ', '226': 'BF',
  '243': 'CD', '241': 'GA', '242': 'CG', '233': 'GH', '254': 'KE',
  '250': 'RW', '256': 'UG', '255': 'TZ', '260': 'ZM', '234': 'NG',
  '265': 'MW', '266': 'LS', '258': 'MZ', '232': 'SL'
};

function detectCountryFromPhone(phone) {
  const cleaned = String(phone || '').replace(/\D/g, '');
  for (const [prefix, code] of Object.entries(PHONE_PREFIX_TO_COUNTRY)) {
    if (cleaned.startsWith(prefix)) return code;
  }
  return null;
}

// ---------------------------------------------
//  Construction du provider code pawaPay
//  Format : {OPERATOR}_{ISO3} ex: MTN_MOMO_CMR, ORANGE_MONEY_CIV
//  Operators normalises :
//    mtn        → MTN_MOMO
//    om/orange  → ORANGE_MONEY (sauf BF où Orange = ORANGE)
//    airtel     → AIRTEL_OAPI (Airtel Mobile Money)
//    mpesa      → MPESA (KE/TZ)
//    vodacom    → VODACOM_MPESA (TZ/CD)
//    moov       → MOOV (CI/BJ/TG)
//    tigo       → TIGO
// ---------------------------------------------
const OPERATOR_NORMALIZED = {
  'mtn':     'MTN_MOMO',
  'om':      'ORANGE',
  'orange':  'ORANGE',
  'airtel':  'AIRTEL_OAPI',
  'mpesa':   'MPESA',
  'vodacom': 'VODACOM_MPESA',
  'moov':    'MOOV',
  'tigo':    'TIGO'
};

// Cas particuliers ou pawaPay a un code provider non standard. Ces overrides
// remplacent le code generique calcule depuis OPERATOR_NORMALIZED + ISO3.
// A enrichir au fur et a mesure des decouvertes via /v2/active-conf.
const PROVIDER_OVERRIDES = {
  // exemples (a verifier en sandbox) :
  // 'ORANGE_CMR': 'ORANGE_MONEY_CMR',
};

function buildProviderCode(countryCode, operator) {
  const iso3 = ISO2_TO_ISO3[String(countryCode || '').toUpperCase()];
  if (!iso3) {
    throw new PawapayError(`Pays non supporte par pawaPay: ${countryCode}`, 400);
  }
  const opKey = String(operator || '').toLowerCase();
  const opCode = OPERATOR_NORMALIZED[opKey];
  if (!opCode) {
    throw new PawapayError(`Operateur non reconnu: ${operator}. Valeurs supportees: ${Object.keys(OPERATOR_NORMALIZED).join(', ')}`, 400);
  }
  const code = `${opCode}_${iso3}`;
  return PROVIDER_OVERRIDES[code] || code;
}

// ---------------------------------------------
//  Lire la config depuis app (base de donnees)
//  Resout sandbox OU prod selon `environment`.
// ---------------------------------------------
function getConfig(app) {
  const c = app?.payments?.pawapay;
  if (!c?.enabled) {
    throw new PawapayError('pawaPay non actif pour cette application', 400);
  }
  const env = (c.environment === 'production') ? 'production' : 'sandbox';
  const apiUrl = env === 'production'
    ? (c.prodApiUrl    || 'https://api.pawapay.io')
    : (c.sandboxApiUrl || 'https://api.sandbox.pawapay.io');
  const token = env === 'production' ? c.prodToken : c.sandboxToken;
  if (!token) {
    throw new PawapayError(`Token pawaPay ${env} manquant (configurez ${env}Token)`, 500);
  }
  return {
    apiUrl,
    environment: env,
    token,
    webhookPublicKey: c.webhookPublicKey || null
  };
}

// ---------------------------------------------
//  Normaliser le numero (MSISDN brut sans + ni espaces)
//  pawaPay attend uniquement des digits avec code pays.
// ---------------------------------------------
function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

// ---------------------------------------------
//  Mapping statut pawaPay → statut interne
//  Statuts pawaPay observes :
//    Init synchrone : ACCEPTED, REJECTED, DUPLICATE_IGNORED
//    Final (via webhook / check status) : COMPLETED, FAILED
// ---------------------------------------------
function mapApiStatus(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).toUpperCase();
  if (s === 'COMPLETED' || s === 'SUCCESS' || s === 'SUCCESSFUL')   return 'SUCCESS';
  if (s === 'FAILED' || s === 'REJECTED')                            return 'FAILED';
  if (s === 'EXPIRED')                                                return 'EXPIRED';
  if (s === 'ACCEPTED' || s === 'PROCESSING' || s === 'SUBMITTED')   return 'INITIATED';
  if (s === 'IN_RECONCILIATION' || s === 'ENQUEUED')                  return 'INITIATED';
  if (s === 'DUPLICATE_IGNORED')                                      return 'INITIATED';
  if (s === 'PENDING')                                                return 'PENDING';
  return null;
}

// ---------------------------------------------
//  Generer l'URL callback (webhook)
// ---------------------------------------------
function generateUrls() {
  const base = process.env.APP_BASE_URL;
  return {
    callback_url: `${base}/api/payments/pawapay/webhook`
  };
}

// ---------------------------------------------
//  INITIER UN PAIEMENT (deposit)
//  POST /v2/deposits — Bearer auth
// ---------------------------------------------
async function initiatePayment(appId, app, user, packageId, phoneNumber, operator, requestedCountry, requestedProvider) {
  let transaction;
  let payload;
  try {
    console.log(`[pawaPay] Init — user=${user._id}, package=${packageId}, phone=${phoneNumber}, op=${operator}, country=${requestedCountry || 'auto'}, provider=${requestedProvider || 'auto'}`);

    // 1. Config (resout sandbox/prod)
    const config = getConfig(app);

    // 2. Resolution pays : explicite > deduit du phoneNumber
    const country = (requestedCountry && String(requestedCountry).toUpperCase())
      || detectCountryFromPhone(phoneNumber);
    if (!country) {
      throw new AppError(
        'Impossible de detecter le pays depuis le numero. Precisez `country` (ISO-2).',
        400, ErrorCodes.VALIDATION_ERROR
      );
    }

    // 3. Resolution provider : explicite > construit depuis operator+country
    let provider;
    if (requestedProvider) {
      provider = String(requestedProvider).toUpperCase();
    } else {
      if (!operator) {
        throw new AppError('operator ou provider est requis', 400, ErrorCodes.VALIDATION_ERROR);
      }
      provider = buildProviderCode(country, operator);
    }

    // 4. Package + montant + devise
    const packageDoc = await Package.findOne({ _id: packageId, appId });
    if (!packageDoc) throw new AppError('Package non trouve', 404, ErrorCodes.NOT_FOUND);

    const currency = currencyForCountry(country);
    const amount = packageDoc.pricing?.get
      ? packageDoc.pricing.get(currency)
      : packageDoc.pricing?.[currency];
    if (!amount || amount <= 0) {
      throw new AppError(`Prix ${currency} non disponible pour ce package`, 400, ErrorCodes.VALIDATION_ERROR);
    }

    // 5. Numero normalise (MSISDN brut)
    const recipientPhone = normalizePhone(phoneNumber);
    if (!recipientPhone) {
      throw new AppError('phoneNumber invalide', 400, ErrorCodes.VALIDATION_ERROR);
    }

    // 6. Infos client (denormalisees pour reporting)
    const nameParts = (user.pseudo || user.name || user.username || 'Utilisateur').split(' ');
    const firstName = nameParts[0] || 'Utilisateur';
    const lastName  = nameParts.slice(1).join(' ') || firstName;
    const email     = user.email || `user_${user._id}@bigwin.app`;
    const designation = `${packageDoc.name?.fr || packageDoc.name} - ${packageDoc.duration}j`;
    const customerMessage = String(designation).slice(0, 22); // pawaPay limite l'USSD prompt

    // 7. depositId = UUID v4 (notre cote ET cote pawaPay — meme valeur)
    const depositId = uuidv4();
    const clientReferenceId = `BW-${Date.now()}-${depositId.substring(0, 8)}`;

    // 8. Sauvegarder en base avant l'appel API (idempotency)
    transaction = new PawapayTransaction({
      appId,
      depositId,
      clientReferenceId,
      user: user._id,
      package: packageId,
      countryCode: country,
      amount,
      currency,
      status: 'PENDING',
      provider,
      phoneNumber: recipientPhone,
      customerEmail: email,
      customerFirstName: firstName,
      customerLastName:  lastName,
      customerMessage,
      designation,
      environment: config.environment
    });
    await transaction.save();
    console.log(`[pawaPay] Transaction sauvegardee: ${depositId} (${config.environment})`);

    // 9. Appel API pawaPay — POST /v2/deposits
    payload = {
      depositId,
      payer: {
        type: 'MMO',
        accountDetails: {
          phoneNumber: recipientPhone,
          provider
        }
      },
      amount: String(amount),       // pawaPay attend une string
      currency,
      clientReferenceId,
      customerMessage
    };

    const response = await axios.post(`${config.apiUrl}/v2/deposits`, payload, {
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Content-Type':  'application/json',
        'Accept':        'application/json'
      },
      timeout: 30000
    });

    console.log('[pawaPay] Reponse init:', JSON.stringify(response.data));
    const data = response.data || {};

    // 10. Mapper le statut initial
    //     ACCEPTED → INITIATED (en attente USSD client)
    //     REJECTED → FAILED + on stocke failureReason
    //     DUPLICATE_IGNORED → INITIATED (idempotency declenchee)
    transaction.providerData = data;
    const mapped = mapApiStatus(data.status);
    transaction.status = mapped || 'INITIATED';
    if (data.failureReason) {
      transaction.failureCode    = data.failureReason.failureCode;
      transaction.failureMessage = data.failureReason.failureMessage;
    }
    await transaction.save();

    await transaction.populate(['package', 'user']);
    console.log(`[pawaPay] Init OK — depositId: ${depositId}, status: ${transaction.status}`);

    return { transaction };
  } catch (error) {
    console.error('[pawaPay] Erreur init:', error.message, error.responseData || '');
    if (transaction?._id) {
      await PawapayTransaction.findByIdAndDelete(transaction._id).catch(() => {});
    }
    if (error instanceof PawapayError || error instanceof AppError) throw error;
    if (error.response) {
      console.error('[pawaPay] Reponse erreur:', JSON.stringify(error.response.data));
      console.error('[pawaPay] Payload envoye:', JSON.stringify(payload || 'payload hors scope'));
      throw new PawapayError(
        error.response.data?.failureReason?.failureMessage
          || error.response.data?.message
          || error.message,
        error.response.status,
        error.response.data
      );
    }
    throw error;
  }
}

// ---------------------------------------------
//  VERIFIER LE STATUT D'UNE TRANSACTION
//  GET /v2/deposits/{depositId} — Bearer auth
//  Utilise par le controller checkStatus ET par le webhook (anti-spoofing).
// ---------------------------------------------
async function checkTransactionStatus(appId, app, depositId) {
  try {
    // 1. Trouver la transaction
    const transaction = await PawapayTransaction.findOne({ appId, depositId })
      .populate(['package', 'user']);
    if (!transaction) throw new AppError('Transaction non trouvee', 404, ErrorCodes.NOT_FOUND);

    // 2. Config
    const config = getConfig(app);

    // 3. GET /v2/deposits/{depositId} — Bearer
    const response = await axios.get(`${config.apiUrl}/v2/deposits/${depositId}`, {
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept':        'application/json'
      },
      timeout: 30000
    });

    console.log(`[pawaPay] check_status pour ${depositId}:`, JSON.stringify(response.data));

    // pawaPay v2 GET /deposits/{id} renvoie un wrapper :
    //   { data: { depositId, status: COMPLETED|FAILED|..., amount, ..., failureReason? },
    //     status: FOUND|NOT_FOUND }
    // → le vrai status metier est dans `data.data.status`, pas `data.status`.
    const raw = response.data || {};
    const inner = raw.data || raw;
    transaction.providerData = raw;

    const mapped = mapApiStatus(inner.status);
    if (mapped) transaction.status = mapped;

    if (inner.providerTransactionId) {
      // ID externe operateur — utile pour rapprochement support / litiges
      transaction.providerData = { ...raw, _providerTransactionId: inner.providerTransactionId };
    }

    if (inner.failureReason) {
      transaction.failureCode    = inner.failureReason.failureCode;
      transaction.failureMessage = inner.failureReason.failureMessage;
    }

    await transaction.save();
    return transaction;
  } catch (error) {
    console.error('[pawaPay] Erreur check statut:', error.message);
    if (error instanceof PawapayError || error instanceof AppError) throw error;
    if (error.response) {
      throw new PawapayError(
        error.response.data?.failureReason?.failureMessage
          || error.response.data?.message
          || error.message,
        error.response.status,
        error.response.data
      );
    }
    throw error;
  }
}

// ---------------------------------------------
//  VERIFIER LA SIGNATURE WEBHOOK (RFC 9421 HTTP Signatures)
//
//  pawaPay envoie 3 headers :
//    - Content-Digest : sha-256=:base64...:
//    - Signature      : sig1=:base64...:
//    - Signature-Input: sig1=(headers...);created=...;keyid=...;alg=...
//
//  La verification basique consiste a :
//    1. Recalculer Content-Digest depuis le body brut et comparer
//    2. Reconstruire la chaine signee selon Signature-Input
//    3. Verifier la signature avec la cle publique du marchand (RSA-PSS ou Ed25519)
//
//  IMPLEMENTATION : pour V1 on fait juste la verification du Content-Digest
//  (qui prouve l'integrite du body) et on FAIT CONFIANCE au transport HTTPS
//  pour l'authenticite. La signature RSA complete sera ajoutee quand on aura
//  la cle publique exacte du compte Proxidream et le format de signature
//  utilise. En attendant on a un fallback robuste : on rappelle systematiquement
//  `GET /v2/deposits/{id}` apres reception du webhook (idem pattern InTouch).
// ---------------------------------------------
function verifyContentDigest(rawBody, contentDigestHeader) {
  if (!contentDigestHeader) return false;
  // Format attendu : "sha-256=:base64string:"
  const match = /sha-256=:([^:]+):/i.exec(contentDigestHeader);
  if (!match) return false;
  const expected = match[1];
  const computed = crypto.createHash('sha256').update(rawBody).digest('base64');
  return expected === computed;
}

module.exports = {
  getConfig,
  initiatePayment,
  checkTransactionStatus,
  mapApiStatus,
  detectCountryFromPhone,
  buildProviderCode,
  currencyForCountry,
  normalizePhone,
  verifyContentDigest,
  PawapayError
};
