// src/api/services/admin/giftTierManagementService.js
//
// CRUD admin sur les paliers (GiftTier). Tiers globaux : pas de scoping appId.

const GiftTier = require('../../models/common/GiftTier');
const Gift = require('../../models/common/Gift');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

async function listTiers({ activeOnly = false } = {}) {
  const filter = activeOnly ? { isActive: true } : {};
  const tiers = await GiftTier.find(filter).sort({ displayOrder: 1, createdAt: 1 });
  return tiers;
}

async function getTier(tierId) {
  const tier = await GiftTier.findById(tierId);
  if (!tier) {
    throw new AppError('Tier introuvable', 404, ErrorCodes.NOT_FOUND);
  }
  return tier;
}

async function createTier(payload) {
  // key est immutable une fois créé. Vérification d'unicité en plus de l'index.
  if (!payload.key) {
    throw new AppError('key requise', 400, ErrorCodes.VALIDATION_ERROR);
  }
  const existing = await GiftTier.findOne({ key: payload.key.toLowerCase() });
  if (existing) {
    throw new AppError(
      `Un tier avec la clé "${payload.key}" existe déjà`,
      400,
      ErrorCodes.VALIDATION_ERROR
    );
  }
  const tier = await GiftTier.create(payload);
  return tier;
}

async function updateTier(tierId, payload) {
  const tier = await GiftTier.findById(tierId);
  if (!tier) {
    throw new AppError('Tier introuvable', 404, ErrorCodes.NOT_FOUND);
  }

  // key immutable
  if (payload.key && payload.key.toLowerCase() !== tier.key) {
    throw new AppError(
      'La clé d\'un tier est immutable. Crée un nouveau tier si besoin.',
      400,
      ErrorCodes.VALIDATION_ERROR
    );
  }

  const allowed = ['label', 'emoji', 'color', 'displayOrder', 'isActive'];
  for (const k of allowed) {
    if (payload[k] !== undefined) tier[k] = payload[k];
  }

  await tier.save();
  return tier;
}

async function deleteTier(tierId) {
  const tier = await GiftTier.findById(tierId);
  if (!tier) {
    throw new AppError('Tier introuvable', 404, ErrorCodes.NOT_FOUND);
  }

  // Bloque la suppression si des Gifts y référencent encore.
  const giftCount = await Gift.countDocuments({ tier: tierId });
  if (giftCount > 0) {
    throw new AppError(
      `Ce tier est utilisé par ${giftCount} cadeau(x). Désactive-le ou réassigne d'abord.`,
      400,
      ErrorCodes.VALIDATION_ERROR
    );
  }

  await GiftTier.deleteOne({ _id: tierId });
  return true;
}

/**
 * Statistiques d'usage : pour chaque tier, le nombre de gifts qui l'utilisent.
 * Utile dans l'UI admin pour voir l'impact d'un changement.
 */
async function getTierUsage() {
  const usage = await Gift.aggregate([
    { $group: { _id: '$tier', count: { $sum: 1 } } },
  ]);
  const map = {};
  usage.forEach((u) => {
    if (u._id) map[u._id.toString()] = u.count;
  });
  return map;
}

module.exports = {
  listTiers,
  getTier,
  createTier,
  updateTier,
  deleteTier,
  getTierUsage,
};
