/**
 * Google Analytics 4 — Measurement Protocol sender.
 *
 * Permet d'envoyer depuis le backend des événements à GA4 qui seront ensuite
 * importés comme conversions dans Google Ads (si Firebase↔Google Ads est
 * lié). Utilisé principalement depuis `paymentMiddleware` pour fire
 * `purchase` et `payment_failed` à partir des webhooks PSP (AfribaPay /
 * Smobilpay / CinetPay / Korapay / FedaPay) — ces évents ne peuvent pas
 * être fire depuis le mobile car le mobile n'est pas toujours ouvert quand
 * le PSP confirme la transaction.
 *
 * Doc officielle :
 *   https://developers.google.com/analytics/devguides/collection/protocol/ga4
 *
 * Endpoint utilisé :
 *   POST https://www.google-analytics.com/mp/collect
 *     ?firebase_app_id=<APP_ID>&api_secret=<SECRET>
 *
 * Principes de résilience :
 *   - Fire-and-forget — un échec MP ne doit JAMAIS bloquer un webhook PSP
 *   - JAMAIS throw vers le caller
 *   - Logue les erreurs via notre logger mais ne propage pas
 *   - Si la config est incomplète → no-op silencieux
 */
const axios = require('axios');
const logger = require('../../../core/logger');

const SERVICE = 'ga4mp';
const MP_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

// Timeout court — si Google ne répond pas en 3s, on abandonne. Les MP events
// sont non-critiques donc pas la peine de bloquer la pipeline pour ça.
const REQUEST_TIMEOUT_MS = 3000;

/**
 * Extrait la config Firebase depuis le document App (résolu via appId).
 * Retourne null si la config est incomplète ou désactivée.
 */
function _getFirebaseConfig(app) {
  const cfg = app?.analytics?.firebase;
  if (!cfg || !cfg.enabled) return null;
  if (!cfg.appId || !cfg.mpApiSecret) return null;
  return cfg;
}

/**
 * Envoie un event GA4 via Measurement Protocol.
 *
 * @param {Object} opts
 * @param {Object} opts.app            - Document Mongoose App (pour la config)
 * @param {String} opts.appInstanceId  - Firebase app_instance_id du user (32 chars)
 * @param {String} opts.userId         - (optionnel) identifiant stable du user
 * @param {String} opts.eventName      - ex: 'purchase', 'payment_failed'
 * @param {Object} opts.eventParams    - params GA4 standard (currency, value, transaction_id…)
 * @param {Object} [opts.userProperties] - optionnel, ex: { is_vip: {value:'true'} }
 *
 * @returns {Promise<boolean>} true si envoyé avec succès (HTTP 2xx)
 */
async function sendEvent({
  app,
  appInstanceId,
  userId,
  eventName,
  eventParams = {},
  userProperties,
}) {
  const ctx = {
    service: SERVICE,
    category: 'send',
    appId: app?.appId,
    eventName,
  };

  try {
    // Validation préalable — on ne rate pas la transaction pour une config
    // manquante, on log juste.
    const cfg = _getFirebaseConfig(app);
    if (!cfg) {
      logger.warn('MP skipped: analytics.firebase not enabled/configured', {
        ...ctx,
        reason: app?.analytics?.firebase?.enabled ? 'missing_credentials' : 'disabled',
      });
      return false;
    }
    if (!appInstanceId) {
      logger.warn('MP skipped: firebaseAppInstanceId absent sur user', {
        ...ctx,
        userId,
      });
      return false;
    }
    if (!eventName) {
      logger.warn('MP skipped: eventName vide', ctx);
      return false;
    }

    const payload = {
      app_instance_id: appInstanceId,
      events: [
        {
          name: eventName,
          params: eventParams,
        },
      ],
    };
    if (userId) payload.user_id = String(userId);
    if (userProperties && Object.keys(userProperties).length > 0) {
      payload.user_properties = userProperties;
    }

    const url = `${MP_ENDPOINT}?firebase_app_id=${encodeURIComponent(cfg.appId)}&api_secret=${encodeURIComponent(cfg.mpApiSecret)}`;

    const response = await axios.post(url, payload, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' },
      // Google MP renvoie 204 No Content quand tout va bien. Les erreurs sont
      // typiquement 4xx avec un body d'explication.
      validateStatus: (s) => s >= 200 && s < 300,
    });

    logger.info('MP event sent', {
      ...ctx,
      userId,
      status: response.status,
      eventParams: Object.keys(eventParams),
    });
    return true;
  } catch (err) {
    // Ne JAMAIS propager — un webhook PSP ne doit pas échouer parce que GA
    // ne répond pas.
    logger.error('MP send failed', {
      ...ctx,
      message: err.message,
      httpStatus: err.response?.status,
      responseData: err.response?.data,
    });
    return false;
  }
}

/**
 * Helper spécialisé : envoie l'event `purchase` standard GA4.
 * C'est LE signal clé pour Google Ads Smart Bidding (optimisation sur
 * valeur). À appeler UNIQUEMENT quand la transaction est confirmée
 * (webhook PSP SUCCESS / status ACCEPTED).
 */
async function sendPurchase({ app, user, transactionId, value, currency, paymentMethod, packageId, packageName }) {
  return sendEvent({
    app,
    appInstanceId: user?.firebaseAppInstanceId,
    userId: user?._id,
    eventName: 'purchase',
    eventParams: {
      transaction_id: transactionId,
      value: Number(value),
      currency: String(currency || '').toUpperCase(),
      payment_method: paymentMethod,
      items: packageId ? [{
        item_id: packageId,
        item_name: packageName,
        item_category: 'subscription_package',
        price: Number(value),
        quantity: 1,
      }] : undefined,
    },
  });
}

/**
 * Helper spécialisé : envoie un event custom `payment_failed`.
 * Utile pour le diagnostic funnel (quelle proportion des begin_checkout
 * échoue ?) — pas une conversion comptée.
 */
async function sendPaymentFailed({ app, user, transactionId, value, currency, paymentMethod, reason }) {
  return sendEvent({
    app,
    appInstanceId: user?.firebaseAppInstanceId,
    userId: user?._id,
    eventName: 'payment_failed',
    eventParams: {
      transaction_id: transactionId,
      value: Number(value),
      currency: String(currency || '').toUpperCase(),
      payment_method: paymentMethod,
      failure_reason: reason || 'unknown',
    },
  });
}

module.exports = {
  sendEvent,
  sendPurchase,
  sendPaymentFailed,
};
