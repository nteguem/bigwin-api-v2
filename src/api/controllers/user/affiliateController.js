// src/api/controllers/user/affiliateController.js
//
// Endpoints affiliation côté user (auth user requise).
// Préfixés par /user/affiliate (cf. routes/user/affiliateRoutes.js).

const User = require('../../models/user/User');
const affiliateService = require('../../services/affiliate/affiliateService');
const catchAsync = require('../../../utils/catchAsync');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

/**
 * POST /user/affiliate/activate
 * Body: { operator, phoneNumber }
 * Active le rôle affilié pour le user authentifié.
 */
exports.activate = catchAsync(async (req, res, next) => {
  const { operator, phoneNumber } = req.body || {};
  const user = await User.findById(req.user._id);
  if (!user) {
    return next(new AppError('User introuvable', 404, ErrorCodes.NOT_FOUND));
  }

  await affiliateService.activate(user, { operator, phoneNumber });

  const state = await affiliateService.getMyState(user);
  res.status(200).json({
    success: true,
    message: 'Compte affilié activé avec succès',
    data: state,
  });
});

/**
 * GET /user/affiliate/me
 * Retourne l'état affilié + stats (balance, filleuls, commissions).
 */
exports.getMe = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    return next(new AppError('User introuvable', 404, ErrorCodes.NOT_FOUND));
  }
  const state = await affiliateService.getMyState(user);
  res.status(200).json({ success: true, data: state });
});

/**
 * PATCH /user/affiliate/payout-method
 * Body: { operator, phoneNumber }
 */
exports.updatePayoutMethod = catchAsync(async (req, res, next) => {
  const { operator, phoneNumber } = req.body || {};
  const user = await User.findById(req.user._id);
  if (!user) {
    return next(new AppError('User introuvable', 404, ErrorCodes.NOT_FOUND));
  }
  await affiliateService.updatePayoutMethod(user, { operator, phoneNumber });
  const state = await affiliateService.getMyState(user);
  res.status(200).json({
    success: true,
    message: 'Coordonnées mobile money mises à jour',
    data: state,
  });
});

/**
 * GET /user/affiliate/link
 * Retourne le lien de partage Play Store + code + packageName.
 */
exports.getShareLink = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    return next(new AppError('User introuvable', 404, ErrorCodes.NOT_FOUND));
  }
  const link = await affiliateService.getMyShareLink(user);
  res.status(200).json({ success: true, data: link });
});

/**
 * GET /user/affiliate/referrals?page=1&limit=20
 * Liste paginée des filleuls (anonymisés).
 */
exports.listReferrals = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    return next(new AppError('User introuvable', 404, ErrorCodes.NOT_FOUND));
  }
  const { page = 1, limit = 20 } = req.query;
  const result = await affiliateService.listMyReferrals(user, {
    page: parseInt(page, 10),
    limit: Math.min(parseInt(limit, 10), 100),
  });
  res.status(200).json({ success: true, data: result });
});

/**
 * GET /user/affiliate/commissions?page=1&limit=20&status=available
 */
exports.listCommissions = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    return next(new AppError('User introuvable', 404, ErrorCodes.NOT_FOUND));
  }
  const { page = 1, limit = 20, status } = req.query;
  const result = await affiliateService.listMyCommissions(user, {
    page: parseInt(page, 10),
    limit: Math.min(parseInt(limit, 10), 100),
    status,
  });
  res.status(200).json({ success: true, data: result });
});

/**
 * POST /user/affiliate/payout
 * Crée une demande de retrait pour la totalité du solde available
 * dans la devise du pays affilié.
 */
exports.requestPayout = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    return next(new AppError('User introuvable', 404, ErrorCodes.NOT_FOUND));
  }
  const payout = await affiliateService.requestPayout(user);
  res.status(201).json({
    success: true,
    message: 'Demande de retrait enregistrée',
    data: payout,
  });
});

/**
 * GET /user/affiliate/payouts?page=1&limit=20&status=queued
 */
exports.listPayouts = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    return next(new AppError('User introuvable', 404, ErrorCodes.NOT_FOUND));
  }
  const { page = 1, limit = 20, status } = req.query;
  const result = await affiliateService.listMyPayouts(user, {
    page: parseInt(page, 10),
    limit: Math.min(parseInt(limit, 10), 100),
    status,
  });
  res.status(200).json({ success: true, data: result });
});
