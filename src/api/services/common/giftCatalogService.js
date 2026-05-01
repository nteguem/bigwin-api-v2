// src/api/services/common/giftCatalogService.js
//
// Couche métier user-facing pour les cadeaux.
//   • listCatalog : ce que voit l'utilisateur dans l'écran "Cadeaux".
//   • unlockGift  : débite les crédits + crée UserGiftUnlock (atomique).
//   • generateAiGift : appelle Gemini si IA, persiste la génération.
//   • getMyUnlock : retrouve l'unlock + dernière génération pour le mobile.
//
// Le coût effectif d'un cadeau dépend de son tier (populé) + customCreditCost.
// On utilise toujours `Gift.computeEffectiveCost(gift)` pour ne JAMAIS
// hardcoder.

const Gift = require('../../models/common/Gift');
const UserGiftUnlock = require('../../models/common/UserGiftUnlock');
const App = require('../../models/common/App');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const logger = require('../../../utils/logger');

const creditWalletService = require('./creditWalletService');
const aiGiftService = require('./aiGiftService');

/**
 * Charge un Gift avec son tier populé. Lève si introuvable ou inactif.
 */
async function loadActiveGift({ giftId, appId }) {
  const gift = await Gift.findOne({ _id: giftId, appId, isActive: true }).populate(
    'tier'
  );
  if (!gift) {
    throw new AppError('Cadeau introuvable', 404, ErrorCodes.NOT_FOUND);
  }
  return gift;
}

/**
 * Liste le catalogue avec, pour chaque cadeau, le statut user :
 *   - free      : gratuit (isFreeTeaser ou tier=free)
 *   - unlocked  : déjà débloqué
 *   - available : pas encore débloqué + solde suffisant
 *   - locked    : pas encore débloqué + solde insuffisant
 */
async function listCatalog({ user, appId, lang = 'fr' }) {
  const [gifts, unlocks, balance] = await Promise.all([
    Gift.find({ appId, isActive: true })
      .populate('tier')
      .sort({ sortOrder: 1, createdAt: 1 }),
    UserGiftUnlock.find({ appId, user: user._id })
      .select('gift unlockedAt generations')
      .lean(),
    creditWalletService.getBalance(user._id, appId),
  ]);

  const unlockedMap = {};
  unlocks.forEach((u) => {
    unlockedMap[u.gift.toString()] = {
      unlockedAt: u.unlockedAt,
      generationsCount: (u.generations || []).length,
      lastGenerationAt:
        (u.generations || []).length > 0
          ? u.generations[u.generations.length - 1].generatedAt
          : null,
    };
  });

  const items = gifts.map((g) => {
    const formatted = g.formatForLanguage(lang);
    const cost = Gift.computeEffectiveCost(g);
    const unlock = unlockedMap[g._id.toString()] || null;

    let status;
    if (unlock) {
      status = 'unlocked';
    } else if (g.isFreeTeaser || cost === 0) {
      status = 'free';
    } else if (balance.availableCredits >= cost) {
      status = 'available';
    } else {
      status = 'locked';
    }

    return {
      ...formatted,
      status,
      unlock,
    };
  });

  return { items, balance };
}

/**
 * Débloque un cadeau pour l'utilisateur.
 * Atomique : débit + création unlock + idempotence sur double-clic.
 */
async function unlockGift({ user, appId, giftId }) {
  const gift = await loadActiveGift({ giftId, appId });

  const existing = await UserGiftUnlock.findOne({
    appId,
    user: user._id,
    gift: gift._id,
  });
  if (existing) {
    logger.info(
      `[giftCatalog] unlock idempotent — user=${user._id} gift=${gift._id}`
    );
    return { gift, unlock: existing, alreadyUnlocked: true };
  }

  const cost = Gift.computeEffectiveCost(gift);

  if (cost > 0) {
    try {
      await creditWalletService.debitWallet({
        user: user._id,
        appId,
        amount: cost,
        source: 'gift_unlock',
        refId: gift._id,
        refModel: 'Gift',
        note: `Unlock ${gift.title?.fr || gift._id}`,
      });
    } catch (err) {
      if (err.code === 'NOT_ENOUGH_CREDITS') {
        throw new AppError(
          "Tu n'as pas assez de cadeaux pour débloquer celui-ci.",
          402,
          ErrorCodes.VALIDATION_ERROR
        );
      }
      throw err;
    }
  }

  let unlock;
  try {
    unlock = await UserGiftUnlock.create({
      appId,
      user: user._id,
      gift: gift._id,
      costPaid: cost,
      unlockedAt: new Date(),
    });
  } catch (err) {
    // E11000 = race avec un autre process ; on rembourse et on retourne
    // l'unlock existant.
    if (err.code === 11000) {
      if (cost > 0) {
        await creditWalletService.creditWallet({
          user: user._id,
          appId,
          amount: cost,
          source: 'admin_adjust',
          refId: gift._id,
          refModel: 'Gift',
          note: 'Refund: race condition unlock',
        });
      }
      const existingUnlock = await UserGiftUnlock.findOne({
        appId,
        user: user._id,
        gift: gift._id,
      });
      return { gift, unlock: existingUnlock, alreadyUnlocked: true };
    }
    // Autre erreur : on rembourse pour ne pas pénaliser l'utilisateur
    if (cost > 0) {
      try {
        await creditWalletService.creditWallet({
          user: user._id,
          appId,
          amount: cost,
          source: 'admin_adjust',
          refId: gift._id,
          refModel: 'Gift',
          note: `Refund: échec création unlock (${err.message})`,
        });
      } catch (refundErr) {
        logger.error(
          `[giftCatalog] CRITIQUE: refund échoué après échec unlock — user=${user._id} gift=${gift._id} amount=${cost}: ${refundErr.message}`
        );
      }
    }
    throw err;
  }

  return { gift, unlock, alreadyUnlocked: false };
}

/**
 * Récupère le contenu statique d'un cadeau.
 * Free teasers accessibles sans unlock ; sinon unlock requis.
 */
async function getStaticContent({ user, appId, giftId }) {
  const gift = await loadActiveGift({ giftId, appId });

  if (gift.type !== 'static') {
    throw new AppError(
      "Ce cadeau n'est pas de type statique",
      400,
      ErrorCodes.VALIDATION_ERROR
    );
  }

  const cost = Gift.computeEffectiveCost(gift);
  const isFree = gift.isFreeTeaser || cost === 0;

  if (!isFree) {
    const unlock = await UserGiftUnlock.findOne({
      appId,
      user: user._id,
      gift: gift._id,
    });
    if (!unlock) {
      throw new AppError(
        "Ce cadeau n'est pas débloqué.",
        403,
        ErrorCodes.AUTH_FORBIDDEN || 'FORBIDDEN'
      );
    }
  }

  return {
    type: 'static',
    staticFormat: gift.staticFormat,
    contentUrl: gift.contentUrl || null,
    htmlContent: gift.htmlContent || null,
  };
}

/**
 * Génère un cadeau IA : check unlock + rate limit + appel Gemini + persistence.
 */
async function generateAiGift({ user, appId, giftId, formData = {} }) {
  const gift = await loadActiveGift({ giftId, appId });

  if (gift.type !== 'ai') {
    throw new AppError(
      "Ce cadeau n'est pas de type IA",
      400,
      ErrorCodes.VALIDATION_ERROR
    );
  }

  let unlock = await UserGiftUnlock.findOne({
    appId,
    user: user._id,
    gift: gift._id,
  });

  if (!unlock) {
    const cost = Gift.computeEffectiveCost(gift);
    const isFree = gift.isFreeTeaser || cost === 0;
    if (!isFree) {
      throw new AppError(
        "Tu dois d'abord débloquer ce cadeau.",
        403,
        ErrorCodes.AUTH_FORBIDDEN || 'FORBIDDEN'
      );
    }
    unlock = await UserGiftUnlock.create({
      appId,
      user: user._id,
      gift: gift._id,
      costPaid: 0,
    });
  }

  const limit = gift.rateLimitPerWeek || 1;
  if (!unlock.canGenerate(limit)) {
    const nextAllowedAt = computeNextAllowedAt(unlock, limit);
    throw new AppError(
      `Tu as atteint la limite de ${limit} génération(s) par semaine pour ce cadeau. Réessaye après ${formatDate(nextAllowedAt)}.`,
      429,
      'RATE_LIMITED'
    );
  }

  const app = await App.findOne({ appId }).select('branding').lean();
  const appBranding = app?.branding || {};

  const { output, outputFormat, tokensUsed, durationMs, aiModel } =
    await aiGiftService.generateGiftContent({
      gift,
      formData,
      appBranding,
    });

  unlock.generations.push({
    formData,
    output,
    outputFormat,
    aiModel,
    tokensUsed,
    durationMs,
    generatedAt: new Date(),
  });
  await unlock.save();

  const generation = unlock.generations[unlock.generations.length - 1];

  return {
    gift,
    unlock,
    generation: {
      _id: generation._id,
      output: generation.output,
      outputFormat: generation.outputFormat,
      generatedAt: generation.generatedAt,
    },
  };
}

/**
 * Détail d'un unlock pour un user — avec dernière génération si applicable.
 */
async function getMyUnlock({ user, appId, giftId }) {
  const gift = await loadActiveGift({ giftId, appId });

  const unlock = await UserGiftUnlock.findOne({
    appId,
    user: user._id,
    gift: gift._id,
  });

  return { gift, unlock: unlock || null };
}

// ===== Helpers privés =====

function computeNextAllowedAt(unlock, limit) {
  const sorted = (unlock.generations || [])
    .map((g) => g.generatedAt)
    .filter(Boolean)
    .sort((a, b) => a - b);
  if (sorted.length < limit) return new Date();
  const oldestRecent = sorted[sorted.length - limit];
  return new Date(oldestRecent.getTime() + 7 * 24 * 60 * 60 * 1000);
}

function formatDate(d) {
  if (!d) return '';
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

module.exports = {
  listCatalog,
  unlockGift,
  getStaticContent,
  generateAiGift,
  getMyUnlock,
};
