// src/api/controllers/user/accessController.js
//
// Endpoints utilisateur pour le déblocage de CATÉGORIES free de coupons par
// visionnage de pubs récompensées :
//   POST /user/access/category/:categoryId/unlock   { durationMinutes: number|null }
//   GET  /user/access/category/:categoryId          → état courant (polling)

const mongoose = require('mongoose');
const Category = require('../../models/common/Category');
const accessGateService = require('../../services/common/accessGateService');
const subscriptionService = require('../../services/user/subscriptionService');
const catchAsync = require('../../../utils/catchAsync');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

/** True si l'utilisateur a au moins un forfait actif (⇒ contourne le gate). */
async function userHasActiveSubscription(appId, userId) {
  try {
    const subs = await subscriptionService.getActiveSubscriptions(appId, userId);
    return Array.isArray(subs) && subs.length > 0;
  } catch (_) {
    return false; // fail-open : on traite comme non-abonné
  }
}

async function loadAccessibleCategory(appId, categoryId) {
  if (!mongoose.Types.ObjectId.isValid(categoryId)) {
    throw new AppError('Identifiant invalide.', 400, ErrorCodes.VALIDATION_ERROR);
  }
  // Catégorie accessible = de cette app OU "shared", et active.
  const category = await Category.findOne({
    _id: categoryId,
    appId: { $in: [appId, 'shared'] },
    isActive: true
  });
  if (!category) {
    throw new AppError('Coupons introuvables ou indisponibles.', 404, ErrorCodes.NOT_FOUND);
  }
  return category;
}

/**
 * POST /user/access/category/:categoryId/unlock
 * Body: { durationMinutes: <number entier > 0, ou null pour "à vie"> }
 *
 * Démarre / re-choisit une tentative de déblocage de la catégorie. Renvoie le
 * `nonce` à passer dans le `customData` des pubs récompensées + l'état courant.
 */
exports.unlockCategory = catchAsync(async (req, res) => {
  const appId = req.appId;
  const { categoryId } = req.params;
  const body = req.body || {};

  if (!Object.prototype.hasOwnProperty.call(body, 'durationMinutes')) {
    throw new AppError('Champ "durationMinutes" requis (null pour un déblocage à vie).', 400, ErrorCodes.VALIDATION_ERROR);
  }
  const { durationMinutes } = body;

  const category = await loadAccessibleCategory(appId, categoryId);
  if (category.isVip) {
    throw new AppError("Ces coupons ne sont pas concernés par le déblocage par pub.", 400, ErrorCodes.VALIDATION_ERROR);
  }
  if (!accessGateService.categoryIsGated(category)) {
    throw new AppError('Ces coupons ne nécessitent pas de déblocage.', 400, ErrorCodes.VALIDATION_ERROR);
  }
  if (await userHasActiveSubscription(appId, req.user._id)) {
    throw new AppError("Ces coupons sont déjà accessibles avec ton abonnement.", 400, ErrorCodes.OPERATION_NOT_ALLOWED);
  }

  const result = await accessGateService.startOrSwitchUnlock(appId, req.user._id, category, durationMinutes);

  return res.status(200).json({
    success: true,
    message: result.isAccessActive ? 'Coupons débloqués.' : 'Tentative de déblocage démarrée.',
    data: {
      categoryId: String(category._id),
      nonce: result.nonce,
      status: result.status,
      verifiedCount: result.verifiedCount,
      adsRequired: result.adsRequired,
      durationMinutes: result.durationMinutes,        // null = à vie
      unlockedAt: result.unlockedAt,
      unlockedUntil: result.expiresAt || null         // null = à vie ou non débloqué
    }
  });
});

/**
 * GET /user/access/category/:categoryId
 * État de la porte de la catégorie pour l'utilisateur (utilisé en polling
 * après chaque pub).
 */
exports.getCategoryAccessState = catchAsync(async (req, res) => {
  const appId = req.appId;
  const { categoryId } = req.params;

  const category = await loadAccessibleCategory(appId, categoryId);
  const isSubscriber = await userHasActiveSubscription(appId, req.user._id);
  const gateState = await accessGateService.getCategoryGateState(appId, req.user._id, category, { isSubscriber });

  return res.status(200).json({
    success: true,
    data: {
      categoryId: String(category._id),
      gated: gateState.gated,
      locked: gateState.locked,
      offers: gateState.offers,
      unlockCount: gateState.unlockCount || 0,
      state: gateState.state
    }
  });
});
