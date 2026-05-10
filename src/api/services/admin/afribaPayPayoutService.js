// src/api/services/admin/afribaPayPayoutService.js
//
// Service côté admin pour déclencher un payout AfribaPay (sortant).
//
// Flow :
//   1. POST {AFRIBAPAY_API_URL}/v1/token   (Basic auth apiUser:apiKey)
//      → renvoie un access_token JWT valable ~25h
//   2. POST {AFRIBAPAY_PAYOUT_API_URL}/v1/pay/payout (Bearer access_token)
//      → renvoie status SUCCESS / PENDING / FAILED + transaction_id
//
// Le token est mis en cache en mémoire pour ne pas refaire /token à chaque
// payout (l'expiration reste très large).
//
// Le service throw un AfribaPayPayoutError si :
//   - réseau injoignable
//   - réponse HTTP != 2xx
//   - status retour = FAILED
// L'admin peut alors Rejeter manuellement.

const axios = require('axios');
const logger = require('../../../core/logger');

const SERVICE = 'afribaPayPayoutService';

class AfribaPayPayoutError extends Error {
  constructor(message, statusCode, responseData) {
    super(message);
    this.name = 'AfribaPayPayoutError';
    this.statusCode = statusCode;
    this.responseData = responseData;
  }
}

// Cache tokens par app (multi-tenant). Clé = appId. Chaque app a ses
// propres credentials donc son propre token.
const tokenCache = new Map(); // appId → { token, expiresAt }

/**
 * Extrait la config AfribaPay d'une app. Lance une erreur claire si
 * un champ manque, plutôt qu'une 401 cryptique chez AfribaPay.
 */
function _getConfigFromApp(app) {
  if (!app) {
    throw new AfribaPayPayoutError(
      'App introuvable pour le payout.',
      500
    );
  }
  const cfg = app.payments?.afribapay || {};
  const apiUrl = cfg.apiUrl;
  const payoutApiUrl = cfg.payoutApiUrl;
  const apiUser = cfg.apiUser;
  const apiKey = cfg.apiKey;
  const merchantKey = cfg.merchantKey;

  if (!apiUrl || !payoutApiUrl || !apiUser || !apiKey || !merchantKey) {
    throw new AfribaPayPayoutError(
      `Config AfribaPay incomplète sur l'app "${app.appId}". ` +
        `Champs requis : payments.afribapay.apiUrl + payoutApiUrl + ` +
        `apiUser + apiKey + merchantKey.`,
      500
    );
  }
  return { appId: app.appId, apiUrl, payoutApiUrl, apiUser, apiKey, merchantKey };
}

async function _fetchAccessToken({ appId, apiUrl, apiUser, apiKey }) {
  // Réutilise le cache si encore valide (5 min de marge)
  const cached = tokenCache.get(appId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  const credentials = Buffer.from(`${apiUser}:${apiKey}`).toString('base64');
  try {
    const res = await axios.post(
      `${apiUrl}/v1/token`,
      {},
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );
    const token = res.data?.data?.access_token;
    const expiresIn = res.data?.data?.expires_in || 90000;
    if (!token) {
      throw new AfribaPayPayoutError(
        'AfribaPay /token : access_token manquant dans la réponse',
        502,
        res.data
      );
    }
    tokenCache.set(appId, {
      token,
      expiresAt: Date.now() + (expiresIn - 300) * 1000,
    });
    logger.info('afribapay token obtained', { service: SERVICE, appId });
    return token;
  } catch (err) {
    if (err instanceof AfribaPayPayoutError) throw err;
    const msg = err?.response?.data?.message || err.message;
    throw new AfribaPayPayoutError(
      `Échec authentification AfribaPay : ${msg}`,
      err?.response?.status || 502,
      err?.response?.data
    );
  }
}

function _invalidateToken(appId) {
  tokenCache.delete(appId);
}

/**
 * Déclenche un payout AfribaPay.
 *
 * @param {Object} app - le doc App de l'application courante (pour
 *                       lire payments.afribapay.{apiUrl, payoutApiUrl,
 *                       apiUser, apiKey, merchantKey}).
 * @param {Object} params
 * @param {string} params.operator    - 'orange', 'mtn', 'wave', etc.
 * @param {string} params.country     - 'CM', 'SN', 'CI', ...
 * @param {string} params.phoneNumber - numéro mobile money (sans dial code)
 * @param {number} params.amount      - montant
 * @param {string} params.currency    - 'XAF', 'XOF', ...
 * @param {string} params.orderId     - idempotency key (ex: `payout-${_id}`)
 * @param {string} [params.referenceId]
 * @param {string} [params.notifyUrl]
 * @returns {Promise<{ status, transactionId, providerId, raw }>}
 */
async function triggerPayout(app, {
  operator,
  country,
  phoneNumber,
  amount,
  currency,
  orderId,
  referenceId,
  notifyUrl,
}) {
  const cfg = _getConfigFromApp(app);
  const token = await _fetchAccessToken(cfg);

  const body = {
    operator: String(operator).toLowerCase(),
    country: String(country).toUpperCase(),
    phone_number: String(phoneNumber).trim(),
    amount: Number(amount),
    currency: String(currency).toUpperCase(),
    order_id: orderId,
    merchant_key: cfg.merchantKey,
    lang: 'fr',
    ...(referenceId ? { reference_id: referenceId } : {}),
    ...(notifyUrl ? { notify_url: notifyUrl } : {}),
  };

  let response;
  try {
    response = await axios.post(`${cfg.payoutApiUrl}/v1/pay/payout`, body, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  } catch (err) {
    // Si 401, le token est probablement expiré → on invalide le cache
    // et on relance une fois (auto-retry simple)
    if (err?.response?.status === 401) {
      _invalidateToken(cfg.appId);
      const freshToken = await _fetchAccessToken(cfg);
      try {
        response = await axios.post(
          `${cfg.payoutApiUrl}/v1/pay/payout`,
          body,
          {
            headers: {
              Authorization: `Bearer ${freshToken}`,
              'Content-Type': 'application/json',
            },
            timeout: 30000,
          }
        );
      } catch (err2) {
        throw new AfribaPayPayoutError(
          `AfribaPay payout échec après refresh token : ${err2?.response?.data?.message || err2.message}`,
          err2?.response?.status || 502,
          err2?.response?.data
        );
      }
    } else {
      throw new AfribaPayPayoutError(
        `AfribaPay payout échec : ${err?.response?.data?.message || err.message}`,
        err?.response?.status || 502,
        err?.response?.data
      );
    }
  }

  const data = response.data?.data || {};
  const status = String(data.status || '').toUpperCase();
  const transactionId = data.transaction_id || null;
  const providerId = data.provider_id || null;

  if (status === 'FAILED') {
    throw new AfribaPayPayoutError(
      `AfribaPay a refusé le payout (FAILED). transaction_id=${transactionId || '—'}`,
      400,
      data
    );
  }

  if (status !== 'SUCCESS' && status !== 'PENDING') {
    throw new AfribaPayPayoutError(
      `AfribaPay a renvoyé un status inattendu : "${status}"`,
      502,
      data
    );
  }

  logger.info('afribapay payout ok', {
    service: SERVICE,
    orderId,
    status,
    transactionId,
  });

  return { status, transactionId, providerId, raw: data };
}

/**
 * Récupère le status courant d'une transaction depuis AfribaPay via
 * GET /v1/status?order_id=... (sur l'API_URL classique, pas payout).
 *
 * @param {Object} app - doc App pour la config + token
 * @param {string} orderId - ex: `payout-${pr._id}`
 * @returns {Promise<{ status, transactionId, providerId, raw }>}
 */
async function checkTransactionStatus(app, orderId) {
  const cfg = _getConfigFromApp(app);
  const token = await _fetchAccessToken(cfg);

  let response;
  try {
    response = await axios.get(`${cfg.apiUrl}/v1/status`, {
      params: { order_id: orderId },
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000,
    });
  } catch (err) {
    if (err?.response?.status === 401) {
      _invalidateToken(cfg.appId);
      const freshToken = await _fetchAccessToken(cfg);
      try {
        response = await axios.get(`${cfg.apiUrl}/v1/status`, {
          params: { order_id: orderId },
          headers: { Authorization: `Bearer ${freshToken}` },
          timeout: 15000,
        });
      } catch (err2) {
        throw new AfribaPayPayoutError(
          `AfribaPay /status échec : ${err2?.response?.data?.message || err2.message}`,
          err2?.response?.status || 502,
          err2?.response?.data
        );
      }
    } else if (err?.response?.status === 404) {
      throw new AfribaPayPayoutError(
        `Aucune transaction AfribaPay trouvée pour order_id=${orderId}.`,
        404,
        err?.response?.data
      );
    } else {
      throw new AfribaPayPayoutError(
        `AfribaPay /status échec : ${err?.response?.data?.message || err.message}`,
        err?.response?.status || 502,
        err?.response?.data
      );
    }
  }

  const data = response.data?.data || {};
  const status = String(data.status || '').toUpperCase();
  return {
    status,
    transactionId: data.transaction_id || null,
    providerId: data.provider_id || null,
    raw: data,
  };
}

module.exports = {
  triggerPayout,
  checkTransactionStatus,
  AfribaPayPayoutError,
};
