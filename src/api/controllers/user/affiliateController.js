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
 * Body: { country?, firstName, lastName }
 * - country : pays choisi (défaut user.countryCode)
 * - firstName / lastName : identité réelle pour les payouts AfribaPay
 */
exports.activate = catchAsync(async (req, res, next) => {
  const { country, firstName, lastName } = req.body || {};
  const user = await User.findById(req.user._id);
  if (!user) {
    return next(new AppError('User introuvable', 404, ErrorCodes.NOT_FOUND));
  }

  await affiliateService.activate(user, { country, firstName, lastName });

  const state = await affiliateService.getMyState(user);
  res.status(200).json({
    success: true,
    message: 'Compte affilié activé avec succès',
    data: state,
  });
});

/**
 * GET /user/affiliate/eligible-countries
 * Liste des pays disponibles pour activer un compte affilié, enrichie
 * du nom du pays et flag isUserCountry pour pré-sélection UI.
 */
exports.listEligibleCountries = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    return next(new AppError('User introuvable', 404, ErrorCodes.NOT_FOUND));
  }
  const countries = await affiliateService.listEligibleCountries(user);
  res.status(200).json({ success: true, data: countries });
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
 * POST /user/affiliate/payout-method
 * Body: { operator, phoneNumber }
 *
 * Définit les coordonnées mobile money UNE SEULE FOIS. Si déjà définies,
 * renvoie 409 (conflict). Pour modifier, l'admin doit reset.
 */
exports.setPayoutMethod = catchAsync(async (req, res, next) => {
  const { operator, phoneNumber } = req.body || {};
  const user = await User.findById(req.user._id);
  if (!user) {
    return next(new AppError('User introuvable', 404, ErrorCodes.NOT_FOUND));
  }
  await affiliateService.setPayoutMethod(user, { operator, phoneNumber });
  const state = await affiliateService.getMyState(user);
  res.status(200).json({
    success: true,
    message: 'Coordonnées mobile money enregistrées',
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
 * GET /user/affiliate/referrals?page=1&limit=20&q=...
 * Liste paginée des filleuls (anonymisés). `q` cherche dans pseudo/email/phone.
 */
exports.listReferrals = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    return next(new AppError('User introuvable', 404, ErrorCodes.NOT_FOUND));
  }
  const { page = 1, limit = 20, q } = req.query;
  const result = await affiliateService.listMyReferrals(user, {
    page: parseInt(page, 10),
    limit: Math.min(parseInt(limit, 10), 100),
    q,
  });
  res.status(200).json({ success: true, data: result });
});

/**
 * GET /user/affiliate/referrals/:id
 * Détail d'un filleul + ses subscriptions + ses commissions.
 */
exports.getReferralDetail = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    return next(new AppError('User introuvable', 404, ErrorCodes.NOT_FOUND));
  }
  const detail = await affiliateService.getReferralDetail(user, req.params.id);
  res.status(200).json({ success: true, data: detail });
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
 * Body: { operator?, phoneNumber? } — requis UNIQUEMENT au 1er retrait
 *                                     (set la méthode immuable). Ignorés
 *                                     ensuite si méthode déjà définie.
 *
 * Crée une demande de retrait pour la totalité du solde available
 * dans la devise du pays affilié.
 */
exports.requestPayout = catchAsync(async (req, res, next) => {
  const { operator, phoneNumber } = req.body || {};
  const user = await User.findById(req.user._id);
  if (!user) {
    return next(new AppError('User introuvable', 404, ErrorCodes.NOT_FOUND));
  }
  const payout = await affiliateService.requestPayout(user, {
    operator,
    phoneNumber,
  });
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
