// src/api/services/common/giftReviewService.js
//
// Couche métier pour les avis utilisateur sur les cadeaux :
//   - submitReview : crée OU édite l'avis du user (upsert atomique)
//   - listReviews  : pagination par cadeau, tri du plus récent
//   - getAggregate : moyenne + distribution par étoile + total
//   - getMyReview  : avis du user connecté sur ce cadeau (null si none)
//   - deleteMyReview : suppression de son propre avis

const mongoose = require('mongoose');
const GiftReview = require('../../models/common/GiftReview');
const Gift = require('../../models/common/Gift');
const UserGiftUnlock = require('../../models/common/UserGiftUnlock');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

/**
 * Soumet un avis. Si l'user a déjà un avis sur ce cadeau, il est mis à
 * jour (upsert). Sinon créé.
 *
 * Permissions : l'user doit avoir débloqué le cadeau OU c'est gratuit
 * (isFreeTeaser). Sinon 403.
 */
async function submitReview({ user, appId, giftId, rating, comment }) {
  const ratingInt = Number.parseInt(rating, 10);
  if (!Number.isFinite(ratingInt) || ratingInt < 1 || ratingInt > 5) {
    throw new AppError(
      'Note invalide (doit être entre 1 et 5)',
      400,
      ErrorCodes.VALIDATION_ERROR
    );
  }

  const gift = await Gift.findOne({ _id: giftId, appId });
  if (!gift) {
    throw new AppError('Cadeau introuvable', 404, ErrorCodes.NOT_FOUND);
  }

  // Accès requis : freeTeaser OU unlock existant.
  const isFree = gift.isFreeTeaser;
  if (!isFree) {
    const unlock = await UserGiftUnlock.findOne({
      appId,
      user: user._id,
      gift: gift._id,
    }).select('_id').lean();
    if (!unlock) {
      throw new AppError(
        'Tu dois débloquer ce cadeau pour laisser un avis.',
        403,
        ErrorCodes.AUTH_FORBIDDEN || 'FORBIDDEN'
      );
    }
  }

  const cleanComment = (comment || '').toString().trim().slice(0, 1000);

  const review = await GiftReview.findOneAndUpdate(
    { gift: gift._id, user: user._id, appId },
    {
      $set: { rating: ratingInt, comment: cleanComment },
      $setOnInsert: { gift: gift._id, user: user._id, appId },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return review;
}

/**
 * Liste paginée des avis d'un cadeau (du plus récent au plus ancien).
 * Limit max : 50 par page.
 */
async function listReviews({ giftId, limit = 20, offset = 0 }) {
  const lim = Math.min(50, Math.max(1, Number.parseInt(limit, 10) || 20));
  const off = Math.max(0, Number.parseInt(offset, 10) || 0);

  const [reviews, total] = await Promise.all([
    GiftReview.find({ gift: giftId })
      .populate({ path: 'user', select: 'pseudo' })
      .sort({ createdAt: -1 })
      .skip(off)
      .limit(lim)
      .lean(),
    GiftReview.countDocuments({ gift: giftId }),
  ]);

  return {
    reviews: reviews.map((r) => ({
      _id: r._id,
      rating: r.rating,
      comment: r.comment || '',
      createdAt: r.createdAt,
      user: {
        _id: r.user?._id || null,
        pseudo: r.user?.pseudo || 'Utilisateur',
      },
    })),
    total,
    limit: lim,
    offset: off,
    hasMore: off + reviews.length < total,
  };
}

/**
 * Calcul de l'agrégat des avis d'un cadeau :
 *   - average : moyenne (1 décimale)
 *   - total   : nombre total d'avis
 *   - distribution : { 1, 2, 3, 4, 5 } → count par étoile
 *
 * Sur ID invalide (non-ObjectId), on renvoie l'agrégat vide direct.
 * Évite le crash BSONError du constructeur `new ObjectId(invalid)`
 * qui n'est pas attrapé par le middleware CastError standard.
 */
async function getAggregate({ giftId }) {
  if (!mongoose.Types.ObjectId.isValid(giftId)) {
    return {
      average: 0,
      total: 0,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    };
  }

  const result = await GiftReview.aggregate([
    {
      $match: {
        gift: new mongoose.Types.ObjectId(giftId),
      },
    },
    {
      $group: {
        _id: '$rating',
        count: { $sum: 1 },
      },
    },
  ]);

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;
  let sumRatings = 0;
  result.forEach((r) => {
    const rating = Number(r._id);
    if (rating >= 1 && rating <= 5) {
      distribution[rating] = r.count;
      total += r.count;
      sumRatings += rating * r.count;
    }
  });

  const average = total > 0 ? Math.round((sumRatings / total) * 10) / 10 : 0;
  return { average, total, distribution };
}

/**
 * Récupère l'avis du user courant sur un cadeau (null si pas d'avis).
 * Sert à pré-remplir le formulaire d'édition.
 */
async function getMyReview({ user, giftId }) {
  const review = await GiftReview.findOne({
    gift: giftId,
    user: user._id,
  }).lean();
  if (!review) return null;
  return {
    _id: review._id,
    rating: review.rating,
    comment: review.comment || '',
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
}

/**
 * Supprime l'avis du user courant. Idempotent.
 */
async function deleteMyReview({ user, giftId }) {
  await GiftReview.deleteOne({ gift: giftId, user: user._id });
  return { success: true };
}

module.exports = {
  submitReview,
  listReviews,
  getAggregate,
  getMyReview,
  deleteMyReview,
};
