// src/api/controllers/common/afribaPayPayoutWebhookController.js
//
// Webhook AfribaPay pour les payouts (sortants). AfribaPay POST le statut
// final (SUCCESS / FAILED) sur cette route quand le virement est confirmé.
//
// Sécurité : signature HMAC SHA256 vérifiée avec apiKey. Si invalide → 403.
//
// L'URL doit être configurée côté .env via AFRIBAPAY_PAYOUT_NOTIFY_URL et
// passée à AfribaPay au moment du POST /v1/pay/payout.

const crypto = require('crypto');
const App = require('../../models/common/App');
const PayoutRequest = require('../../models/affiliate/PayoutRequest');
const affiliateAdminService = require('../../services/admin/affiliateAdminService');
const catchAsync = require('../../../utils/catchAsync');
const logger = require('../../../core/logger');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

const SERVICE = 'afribaPayPayoutWebhook';

function _verifySignature(rawBody, signature, apiKey) {
  if (!signature || !apiKey || !rawBody) return false;
  const computed = crypto
    .createHmac('sha256', apiKey)
    .update(rawBody)
    .digest('hex');
  // timingSafeEqual avec buffers de même longueur
  try {
    const a = Buffer.from(computed, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}

/**
 * POST /webhooks/afribapay/payout
 *
 * Headers attendus (selon doc AfribaPay) :
 *   - Afribapay-Sign : HMAC SHA256 du raw body, signé avec API_KEY
 *   - Content-Type   : application/json
 *
 * Body : { order_id, status, transaction_id, ... }
 *
 * On retrouve l'app via le order_id → la PayoutRequest → son appId →
 * la config AfribaPay de cette app pour vérifier la signature.
 */
exports.handlePayoutWebhook = catchAsync(async (req, res) => {
  const rawBody = req.rawBody || JSON.stringify(req.body);
  const payload = req.body || {};
  const signature =
    req.headers['afribapay-sign'] ||
    req.headers['Afribapay-Sign'] ||
    req.headers['AFRIBAPAY-SIGN'];

  const orderId =
    payload.order_id || payload.orderId || payload.data?.order_id;

  if (!orderId) {
    logger.warn('webhook missing order_id', { service: SERVICE, payload });
    return res.status(400).json({ ok: false, reason: 'order_id missing' });
  }

  // Retrouve la PayoutRequest pour résoudre l'app
  const pr = await PayoutRequest.findOne({ afribaPayOrderId: orderId })
    .select('appId')
    .lean();
  if (!pr) {
    // Pas notre payout — répondre 200 quand même pour ne pas que AfribaPay
    // retry indéfiniment (le webhook est probablement pour un payin).
    logger.info('webhook for unknown order_id', {
      service: SERVICE,
      orderId,
    });
    return res.status(200).json({ ok: true, reason: 'order_id not ours' });
  }

  // Vérifie la signature avec l'apiKey de l'app
  const app = await App.findOne({ appId: pr.appId })
    .select('payments.afribapay.apiKey')
    .lean();
  const apiKey = app?.payments?.afribapay?.apiKey;
  if (!apiKey) {
    logger.error('webhook : apiKey introuvable pour vérif HMAC', {
      service: SERVICE,
      appId: pr.appId,
    });
    throw new AppError(
      'Configuration apiKey manquante pour vérif HMAC.',
      500,
      ErrorCodes.INTERNAL_ERROR
    );
  }

  if (!_verifySignature(rawBody, signature, apiKey)) {
    logger.warn('webhook signature INVALID', {
      service: SERVICE,
      orderId,
      appId: pr.appId,
    });
    return res.status(403).json({ ok: false, reason: 'invalid signature' });
  }

  // Signature OK → on traite
  try {
    const result = await affiliateAdminService.handlePayoutWebhook(
      payload,
      req.headers
    );
    logger.info('webhook processed', {
      service: SERVICE,
      orderId,
      result: { handled: result.handled, finalStatus: result.finalStatus },
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    logger.error('webhook processing failed', {
      service: SERVICE,
      orderId,
      error: err.message,
      stack: err.stack,
    });
    // Retourne 200 pour éviter retry infini AfribaPay sur erreur applicative
    return res.status(200).json({ ok: false, reason: err.message });
  }
});
