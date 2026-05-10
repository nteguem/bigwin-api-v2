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

// Cache token en mémoire (process-level). Si plusieurs instances en
// scaling horizontal, chacune aura son cache — pas grave, expirations
// gérées indépendamment.
let cachedToken = null;
let cachedTokenExpiry = null;

function _getConfig() {
  const apiUrl = process.env.AFRIBAPAY_API_URL;
  const payoutApiUrl =
    process.env.AFRIBAPAY_PAYOUT_API_URL ||
    (apiUrl ? apiUrl.replace('api.', 'api-payout.') : null) ||
    (apiUrl
      ? apiUrl.replace('api-sandbox.', 'api-payout-sandbox.')
      : null);
  const apiUser = process.env.AFRIBAPAY_API_USER;
  const apiKey = process.env.AFRIBAPAY_API_KEY;
  const merchantKey = process.env.AFRIBAPAY_MERCHANT_KEY;

  if (!apiUrl || !payoutApiUrl || !apiUser || !apiKey || !merchantKey) {
    throw new AfribaPayPayoutError(
      'Configuration AfribaPay incomplète (vérifie AFRIBAPAY_API_URL, ' +
        'AFRIBAPAY_PAYOUT_API_URL, AFRIBAPAY_API_USER, AFRIBAPAY_API_KEY, ' +
        'AFRIBAPAY_MERCHANT_KEY dans le .env).',
      500
    );
  }
  return { apiUrl, payoutApiUrl, apiUser, apiKey, merchantKey };
}

async function _fetchAccessToken({ apiUrl, apiUser, apiKey }) {
  // Réutilise le cache si encore valide (5 min de marge)
  if (cachedToken && cachedTokenExpiry && Date.now() < cachedTokenExpiry) {
    return cachedToken;
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
    cachedToken = token;
    cachedTokenExpiry = Date.now() + (expiresIn - 300) * 1000; // -5 min de marge
    logger.info('afribapay token obtained', { service: SERVICE });
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

/**
 * Déclenche un payout AfribaPay.
 *
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
async function triggerPayout({
  operator,
  country,
  phoneNumber,
  amount,
  currency,
  orderId,
  referenceId,
  notifyUrl,
}) {
  const cfg = _getConfig();
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
      cachedToken = null;
      cachedTokenExpiry = null;
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

module.exports = {
  triggerPayout,
  AfribaPayPayoutError,
};
