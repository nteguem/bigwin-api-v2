// src/api/controllers/user/giftController.js
//
// Endpoints user-facing pour le système de cadeaux.

const giftCatalogService = require('../../services/common/giftCatalogService');
const giftReviewService = require('../../services/common/giftReviewService');
const catchAsync = require('../../../utils/catchAsync');

/**
 * GET /user/gifts
 * Liste le catalogue + statut user pour chaque cadeau.
 */
exports.getCatalog = catchAsync(async (req, res) => {
  const { lang = 'fr', country = null } = req.query;
  const result = await giftCatalogService.listCatalog({
    user: req.user,
    appId: req.appId,
    lang,
    country: country || null,
  });

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * GET /user/gifts/me/tier
 * Renvoie le tier max accessible à l'user via ses subs actives.
 * Remplace l'ancien /me/balance (le concept de "solde de crédits" n'existe
 * plus — c'est un accès à un tier qui inclut les tiers inférieurs).
 */
exports.getMyTierAccess = catchAsync(async (req, res) => {
  const access = await giftCatalogService.getUserMaxTierOrder(
    req.user._id,
    req.appId
  );
  res.status(200).json({
    success: true,
    data: access,
  });
});

/**
 * POST /user/gifts/:id/unlock
 * Débloque un cadeau si l'user a une sub active dont le tier le couvre.
 */
exports.unlock = catchAsync(async (req, res) => {
  const result = await giftCatalogService.unlockGift({
    user: req.user,
    appId: req.appId,
    giftId: req.params.id,
  });

  const { lang = 'fr' } = req.query;

  res.status(200).json({
    success: true,
    message: result.alreadyUnlocked
      ? 'Cadeau déjà débloqué'
      : 'Cadeau débloqué avec succès',
    data: {
      gift: result.gift.formatForLanguage(lang),
      unlock: {
        unlockedAt: result.unlock.unlockedAt,
      },
      alreadyUnlocked: result.alreadyUnlocked,
    },
  });
});

/**
 * GET /user/gifts/:id/content
 * Récupère le contenu statique d'un cadeau débloqué.
 */
exports.getContent = catchAsync(async (req, res) => {
  const { lang = 'fr' } = req.query;
  const content = await giftCatalogService.getStaticContent({
    user: req.user,
    appId: req.appId,
    giftId: req.params.id,
    lang,
  });

  res.status(200).json({
    success: true,
    data: content,
  });
});

/**
 * POST /user/gifts/:id/generate
 * Génère le contenu IA d'un cadeau (avec rate limit).
 */
exports.generate = catchAsync(async (req, res) => {
  const formData = req.body?.formData || {};
  const result = await giftCatalogService.generateAiGift({
    user: req.user,
    appId: req.appId,
    giftId: req.params.id,
    formData,
  });

  res.status(200).json({
    success: true,
    message: 'Cadeau généré avec succès',
    data: {
      generation: result.generation,
    },
  });
});

/**
 * GET /user/gifts/:id/me
 * Détail de l'unlock du user pour ce cadeau (incl. générations passées).
 */
exports.getMyUnlock = catchAsync(async (req, res) => {
  const result = await giftCatalogService.getMyUnlock({
    user: req.user,
    appId: req.appId,
    giftId: req.params.id,
  });

  const { lang = 'fr' } = req.query;
  res.status(200).json({
    success: true,
    data: {
      gift: result.gift.formatForLanguage(lang),
      unlock: result.unlock
        ? {
            unlockedAt: result.unlock.unlockedAt,
            generations: (result.unlock.generations || []).map((g) => ({
              _id: g._id,
              outputFormat: g.outputFormat,
              generatedAt: g.generatedAt,
              // On ne retourne PAS le `output` ici (peut être lourd) — il
              // est récupéré via une route dédiée si besoin.
            })),
            generationsCount: (result.unlock.generations || []).length,
            // dernière génération (le mobile l'affiche par défaut)
            lastGeneration:
              (result.unlock.generations || []).length > 0
                ? {
                    output:
                      result.unlock.generations[
                        result.unlock.generations.length - 1
                      ].output,
                    outputFormat:
                      result.unlock.generations[
                        result.unlock.generations.length - 1
                      ].outputFormat,
                    generatedAt:
                      result.unlock.generations[
                        result.unlock.generations.length - 1
                      ].generatedAt,
                  }
                : null,
          }
        : null,
    },
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Avis utilisateurs (reviews)
// ═══════════════════════════════════════════════════════════════════════

/**
 * POST /user/gifts/:id/reviews
 * Crée OU met à jour l'avis du user sur ce cadeau.
 * Body : { rating: 1-5, comment?: string }
 */
exports.submitReview = catchAsync(async (req, res) => {
  const { rating, comment } = req.body || {};
  const review = await giftReviewService.submitReview({
    user: req.user,
    appId: req.appId,
    giftId: req.params.id,
    rating,
    comment,
  });

  res.status(200).json({
    success: true,
    data: {
      _id: review._id,
      rating: review.rating,
      comment: review.comment || '',
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    },
  });
});

/**
 * GET /user/gifts/:id/reviews?limit=20&offset=0
 * Liste paginée des avis (du plus récent).
 */
exports.listReviews = catchAsync(async (req, res) => {
  const { limit = 20, offset = 0 } = req.query;
  const result = await giftReviewService.listReviews({
    giftId: req.params.id,
    limit,
    offset,
  });

  res.status(200).json({ success: true, data: result });
});

/**
 * GET /user/gifts/:id/reviews/aggregate
 * Renvoie { average, total, distribution: {1..5} }.
 */
exports.getReviewsAggregate = catchAsync(async (req, res) => {
  const aggregate = await giftReviewService.getAggregate({
    giftId: req.params.id,
  });

  res.status(200).json({ success: true, data: aggregate });
});

/**
 * GET /user/gifts/:id/reviews/me
 * L'avis du user courant sur ce cadeau (null si aucun).
 */
exports.getMyReview = catchAsync(async (req, res) => {
  const review = await giftReviewService.getMyReview({
    user: req.user,
    giftId: req.params.id,
  });

  res.status(200).json({ success: true, data: review });
});

/**
 * DELETE /user/gifts/:id/reviews/me
 * Supprime l'avis du user courant. Idempotent.
 */
exports.deleteMyReview = catchAsync(async (req, res) => {
  const result = await giftReviewService.deleteMyReview({
    user: req.user,
    giftId: req.params.id,
  });

  res.status(200).json({ success: true, data: result });
});
