// src/api/controllers/user/wheelController.js
//
// Endpoints user pour la "Roue de la Chance" — multi-tenant.
// `req.appId` est fourni par le middleware identifyApp (monté en amont).

const wheelService = require('../../services/user/wheelService');
const wheelTicketService = require('../../services/user/wheelTicketService');
const walletService = require('../../services/common/walletService');
const catchAsync = require('../../../utils/catchAsync');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

function getLang(req) {
  const l = (req.query?.lang || req.headers?.['accept-language'] || 'fr').toString().toLowerCase();
  return l.startsWith('en') ? 'en' : 'fr';
}
function getCurrency(req) {
  return (req.query?.currency || 'XAF').toString().toUpperCase();
}
// Pays de l'user (ISO-2) : tiré du compte si authentifié, sinon du query param
// `?country=` (utile pour /config qui est public). Vide si inconnu.
function getCountry(req) {
  const c = (req.user && req.user.countryCode) || req.query?.country || '';
  return String(c).toUpperCase();
}

// ====== CONFIG + ÉTAT USER ================================================

/** GET /api/user/wheel/config — config + lots adaptés à la devise et au pays. Public. */
exports.getConfig = catchAsync(async (req, res) => {
  const data = await wheelService.getPublicConfig(req.appId, getLang(req), getCurrency(req), getCountry(req));
  res.status(200).json({ success: true, data });
});

/** GET /api/user/wheel/stats — solde de tickets + stats user. Auth requise. */
exports.getStats = catchAsync(async (req, res) => {
  const data = await wheelService.getUserStats(req.appId, req.user._id);
  res.status(200).json({ success: true, data });
});

// ====== SPIN (consomme 1 ticket) ==========================================

/**
 * POST /api/user/wheel/spin — Body: { clientRequestId? }
 *   402 si plus de tickets · 429 cooldown/limite · 503 roue désactivée.
 */
exports.spin = catchAsync(async (req, res) => {
  const spin = await wheelService.spin(req.appId, req.user._id, {
    currency: getCurrency(req),
    lang: getLang(req),
    clientRequestId: req.body?.clientRequestId,
    country: getCountry(req)
  });
  res.status(200).json({ success: true, data: { spin } });
});

// ====== TICKETS (déblocage via pubs) ======================================

/** GET /api/user/wheel/ticket-packs — packs configurés par l'admin. */
exports.listTicketPacks = catchAsync(async (req, res) => {
  const data = await wheelTicketService.listPacks(req.appId, getLang(req));
  res.status(200).json({ success: true, data });
});

/** POST /api/user/wheel/tickets/unlock/start — Body: { packIndex }. */
exports.startTicketsUnlock = catchAsync(async (req, res, next) => {
  const packIndex = req.body?.packIndex;
  if (packIndex === undefined || packIndex === null) {
    return next(new AppError('packIndex requis', 400, ErrorCodes.VALIDATION_ERROR));
  }
  const data = await wheelTicketService.startUnlock(req.appId, req.user._id, packIndex);
  res.status(200).json({ success: true, data });
});

/** GET /api/user/wheel/tickets/unlock/state — polling, crédite si seuil atteint. */
exports.getTicketsUnlockState = catchAsync(async (req, res) => {
  const data = await wheelTicketService.getUnlockState(req.appId, req.user._id);
  res.status(200).json({ success: true, data });
});

// ====== HISTORIQUE ========================================================

exports.getHistory = catchAsync(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
  const skip = parseInt(req.query.skip, 10) || 0;
  const result = await wheelService.getHistory(req.appId, req.user._id, {
    limit, skip,
    lang: getLang(req),
    currency: getCurrency(req)
  });
  res.status(200).json({
    success: true,
    data: result.items,
    pagination: result.pagination
  });
});

// ====== WALLET ============================================================

exports.getWallet = catchAsync(async (req, res) => {
  const data = await walletService.getWalletView(req.appId, req.user._id);
  res.status(200).json({ success: true, data });
});

exports.getWalletTransactions = catchAsync(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const skip = parseInt(req.query.skip, 10) || 0;
  const txs = await walletService.listTransactions(req.appId, req.user._id, { limit, skip });
  res.status(200).json({ success: true, data: txs });
});

exports.requestWithdrawal = catchAsync(async (req, res) => {
  const { amount, currency = 'XAF', paymentMethod, paymentDetails } = req.body;
  const description = paymentMethod
    ? `Retrait via ${paymentMethod}${paymentDetails ? ` — ${paymentDetails}` : ''}`
    : 'Demande de retrait';
  const { transaction } = await walletService.requestWithdrawal({
    appId: req.appId,
    userId: req.user._id,
    amount: Number(amount),
    currency,
    description
  });
  res.status(201).json({ success: true, data: transaction });
});
