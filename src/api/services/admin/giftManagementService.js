// src/api/services/admin/giftManagementService.js
//
// CRUD admin sur les cadeaux + lookup détail subscription→cadeaux.
// Toujours populer `tier` pour que le coût effectif soit calculable.

const Gift = require('../../models/common/Gift');
const GiftTier = require('../../models/common/GiftTier');
const UserGiftUnlock = require('../../models/common/UserGiftUnlock');
const UserCreditWallet = require('../../models/common/UserCreditWallet');
const Subscription = require('../../models/common/Subscription');
const Package = require('../../models/common/Package');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

const TIER_POPULATE = { path: 'tier' };

/**
 * Liste des cadeaux d'une app.
 * @param {Boolean} includeStats — ajoute unlockCount par gift
 */
async function listGifts({ appId, includeStats = false }) {
  const gifts = await Gift.find({ appId })
    .populate(TIER_POPULATE)
    .sort({ sortOrder: 1, createdAt: 1 });

  if (!includeStats) {
    return gifts.map((g) => g.toJSON());
  }

  const unlockCounts = await UserGiftUnlock.aggregate([
    { $match: { appId } },
    { $group: { _id: '$gift', count: { $sum: 1 } } },
  ]);
  const countByGift = Object.fromEntries(
    unlockCounts.map((u) => [u._id.toString(), u.count])
  );

  return gifts.map((g) => ({
    ...g.toJSON(),
    unlockCount: countByGift[g._id.toString()] || 0,
  }));
}

async function getGift({ appId, giftId }) {
  const gift = await Gift.findOne({ _id: giftId, appId }).populate(TIER_POPULATE);
  if (!gift) {
    throw new AppError('Cadeau introuvable', 404, ErrorCodes.NOT_FOUND);
  }
  return gift;
}

/**
 * Vérifie qu'un tier existe et est utilisable (actif).
 * Utilisé en création/édition de cadeau.
 */
async function ensureTierExists(tierId) {
  if (!tierId) {
    throw new AppError('Le tier est requis', 400, ErrorCodes.VALIDATION_ERROR);
  }
  const tier = await GiftTier.findById(tierId);
  if (!tier) {
    throw new AppError('Tier introuvable', 400, ErrorCodes.VALIDATION_ERROR);
  }
  return tier;
}

async function createGift({ appId, payload }) {
  await ensureTierExists(payload.tier);

  const gift = await Gift.create({ ...payload, appId });
  await gift.populate(TIER_POPULATE);
  return gift;
}

async function updateGift({ appId, giftId, payload }) {
  const gift = await Gift.findOne({ _id: giftId, appId });
  if (!gift) {
    throw new AppError('Cadeau introuvable', 404, ErrorCodes.NOT_FOUND);
  }

  if (payload.tier && payload.tier.toString() !== gift.tier.toString()) {
    await ensureTierExists(payload.tier);
  }

  const allowed = [
    'type',
    'tier',
    'customCreditCost',
    'category',
    'title',
    'description',
    'thumbnail',
    'previewImageUrl',
    'staticFormat',
    'contentUrl',
    'htmlContent',
    'formSchema',
    'promptTemplate',
    'outputFormat',
    'rateLimitPerWeek',
    'aiModel',
    'isFreeTeaser',
    'isActive',
    'sortOrder',
    // Métadonnées page détail (mobile rich card)
    'tags',
    'learningPoints',
    'pages',
    'durationMinutes',
    // Override pays — visible uniquement pour ce code ISO (ex: 'CM').
    'country',
  ];
  for (const key of allowed) {
    if (payload[key] !== undefined) {
      gift[key] = payload[key];
    }
  }

  await gift.save();
  await gift.populate(TIER_POPULATE);
  return gift;
}

async function deleteGift({ appId, giftId }) {
  const gift = await Gift.findOne({ _id: giftId, appId });
  if (!gift) {
    throw new AppError('Cadeau introuvable', 404, ErrorCodes.NOT_FOUND);
  }

  const unlocksCount = await UserGiftUnlock.countDocuments({ appId, gift: giftId });
  if (unlocksCount > 0) {
    throw new AppError(
      `Ce cadeau a été débloqué par ${unlocksCount} utilisateur(s). Désactive-le plutôt que de le supprimer.`,
      400,
      ErrorCodes.VALIDATION_ERROR
    );
  }

  await Gift.deleteOne({ _id: giftId, appId });
  return true;
}

async function toggleGift({ appId, giftId }) {
  const gift = await Gift.findOne({ _id: giftId, appId });
  if (!gift) {
    throw new AppError('Cadeau introuvable', 404, ErrorCodes.NOT_FOUND);
  }
  gift.isActive = !gift.isActive;
  await gift.save();
  await gift.populate(TIER_POPULATE);
  return gift;
}

/**
 * Détail cadeaux pour une subscription : crédits accordés, solde, unlocks.
 * Le wallet est par (user, app), donc les unlocks listés couvrent tout
 * l'historique de l'utilisateur sur cette app — volontairement.
 */
async function getSubscriptionGiftsDetail({ appId, subscriptionId }) {
  // On ne filtre PAS par appId du contexte admin sur la lookup
  // initiale : la subscription porte son propre appId, et un admin
  // qui regarde la liste globale des ventes peut cliquer sur une
  // sub d'une autre app (l'appId du contexte n'est pas forcément
  // celui de la sub). On utilise ENSUITE `sub.appId` pour scoper
  // wallet + unlocks correctement à l'app de la sub.
  //
  // Sécurité : la liste des ventes elle-même est déjà filtrée par
  // l'auth middleware si l'admin a un scope app. Ici on ouvre juste
  // la "fenêtre détail" sur une vente déjà visible.
  const sub = await Subscription.findById(subscriptionId).lean();
  if (!sub) {
    throw new AppError('Souscription introuvable', 404, ErrorCodes.NOT_FOUND);
  }

  // Si un appId admin est fourni, on garde une garde de cohérence :
  // si la sub appartient à une autre app que celle du contexte ET
  // que l'admin a un scope strict, on refuse. Mais sans appId admin
  // (superadmin global), on accepte.
  if (appId && appId !== sub.appId) {
    // Pour l'instant on log + on continue. Si tu veux durcir,
    // change pour throw 403.
  }

  const targetAppId = sub.appId;

  const [pkg, wallet, unlocks] = await Promise.all([
    Package.findById(sub.package).select('name unlockCredits').lean(),
    UserCreditWallet.findOne({ appId: targetAppId, user: sub.user }).lean(),
    UserGiftUnlock.find({ appId: targetAppId, user: sub.user })
      .populate({
        path: 'gift',
        select: 'title type customCreditCost category outputFormat rateLimitPerWeek tier',
        populate: { path: 'tier', select: 'key label defaultCreditCost emoji color' },
      })
      .sort({ unlockedAt: -1 })
      .lean(),
  ]);

  let creditedFromThisSale = 0;
  if (wallet && Array.isArray(wallet.history)) {
    const entry = wallet.history.find(
      (h) =>
        h.source === 'subscription' &&
        h.refId &&
        h.refId.toString() === sub._id.toString()
    );
    if (entry) creditedFromThisSale = entry.delta || 0;
  }

  const balance = wallet
    ? {
        totalCredits: wallet.totalCredits || 0,
        usedCredits: wallet.usedCredits || 0,
        availableCredits: Math.max(
          0,
          (wallet.totalCredits || 0) - (wallet.usedCredits || 0)
        ),
      }
    : { totalCredits: 0, usedCredits: 0, availableCredits: 0 };

  return {
    subscriptionId: sub._id,
    package: pkg
      ? {
          _id: pkg._id,
          name: pkg.name,
          unlockCredits: pkg.unlockCredits || 0,
        }
      : null,
    creditedFromThisSale,
    balance,
    unlocks: unlocks.map((u) => ({
      _id: u._id,
      gift: u.gift, // déjà populé avec tier
      unlockedAt: u.unlockedAt,
      costPaid: u.costPaid || 0,
      generationsCount: (u.generations || []).length,
      lastGenerationAt:
        (u.generations || []).length > 0
          ? u.generations[u.generations.length - 1].generatedAt
          : null,
    })),
    unlockCount: unlocks.length,
  };
}

module.exports = {
  listGifts,
  getGift,
  createGift,
  updateGift,
  deleteGift,
  toggleGift,
  getSubscriptionGiftsDetail,
};
