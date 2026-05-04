// src/api/services/common/giftCatalogService.js
//
// Couche métier user-facing pour les cadeaux. Modèle "tier access" (pas
// de wallet/crédits) :
//   • listCatalog : ce que voit l'utilisateur dans l'écran "Cadeaux".
//   • unlockGift  : crée UserGiftUnlock si l'user a une sub active dont
//     le `giftTier.displayOrder` est ≥ celui du cadeau cible. Cumulatif :
//     un user "Or" peut débloquer Bronze + Argent + Or.
//   • generateAiGift : appelle Gemini si IA, persiste la génération.
//   • getMyUnlock : retrouve l'unlock + dernière génération pour le mobile.
//
// Pas de débit/refund — le déblocage est gratuit (le coût a été payé via
// le package). Un cadeau débloqué reste accessible à vie même si la sub
// expire (on ne casse pas l'historique de l'user).

const Gift = require('../../models/common/Gift');
const UserGiftUnlock = require('../../models/common/UserGiftUnlock');
const App = require('../../models/common/App');
const Subscription = require('../../models/common/Subscription');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const logger = require('../../../utils/logger');

const aiGiftService = require('./aiGiftService');

/**
 * Charge un Gift avec son tier populé.
 *
 * @param {Object} opts
 * @param {String} opts.giftId
 * @param {String} opts.appId
 * @param {Boolean} [opts.allowInactive=false] - Si true, on ne filtre PAS sur
 *   isActive. Utile pour l'accès au contenu d'un cadeau qu'un user a déjà
 *   débloqué : si l'admin désactive le cadeau plus tard, le user doit
 *   garder l'accès (sinon on casse son historique).
 */
async function loadActiveGift({ giftId, appId, allowInactive = false }) {
  const filter = { _id: giftId, appId };
  if (!allowInactive) filter.isActive = true;

  const gift = await Gift.findOne(filter).populate('tier');
  if (!gift) {
    throw new AppError('Cadeau introuvable', 404, ErrorCodes.NOT_FOUND);
  }
  return gift;
}

/**
 * Calcule le tier MAX accessible à l'user via ses subs actives.
 * Renvoie `{ maxTierOrder, packages }` :
 *   - maxTierOrder : displayOrder du tier le plus haut (0 si aucune sub
 *     ou aucun package n'a de giftTier configuré).
 *   - packages : liste des packages actifs avec leur tier (pour debug
 *     ou affichage admin).
 *
 * On ne considère que les subs ACTIVES (status='active' ET endDate > now).
 * Si plusieurs subs cumulent (rare mais possible), on prend le max.
 */
async function getUserMaxTierOrder(userId, appId) {
  if (!userId) return { maxTierOrder: 0, packages: [] };

  const subs = await Subscription.find({
    user: userId,
    appId,
    status: 'active',
    endDate: { $gt: new Date() },
  })
    .populate({
      path: 'package',
      select: 'name giftTier',
      populate: { path: 'giftTier', select: 'key label displayOrder color emoji' },
    })
    .lean();

  let maxTierOrder = 0;
  const packages = [];
  for (const sub of subs) {
    const pkg = sub.package;
    if (!pkg) continue;
    const tier = pkg.giftTier;
    if (tier && typeof tier.displayOrder === 'number') {
      if (tier.displayOrder > maxTierOrder) maxTierOrder = tier.displayOrder;
      packages.push({
        packageId: pkg._id,
        packageName: pkg.name,
        tier: {
          _id: tier._id,
          key: tier.key,
          label: tier.label,
          displayOrder: tier.displayOrder,
        },
      });
    }
  }
  return { maxTierOrder, packages };
}

/**
 * Liste le catalogue avec, pour chaque cadeau, le statut user :
 *   - free      : gratuit (isFreeTeaser ou tier=free)
 *   - unlocked  : déjà débloqué
 *   - available : pas encore débloqué + tier accessible via sub active
 *   - locked    : pas encore débloqué + tier non accessible
 */
async function listCatalog({ user, appId, lang = 'fr', country = null }) {
  const countryFilter = country
    ? {
        $or: [
          { country: { $in: [null, ''] } },
          { country: { $exists: false } },
          { country: country.toUpperCase() },
        ],
      }
    : {
        $or: [
          { country: { $in: [null, ''] } },
          { country: { $exists: false } },
        ],
      };

  const isAnonymous = !user || !user._id;

  const [gifts, unlocks, tierAccess] = await Promise.all([
    Gift.find({ appId, isActive: true, ...countryFilter })
      .populate('tier')
      .sort({ sortOrder: 1, createdAt: 1 }),
    isAnonymous
      ? Promise.resolve([])
      : UserGiftUnlock.find({ appId, user: user._id })
          .select('gift unlockedAt generations')
          .lean(),
    isAnonymous
      ? Promise.resolve({ maxTierOrder: 0, packages: [] })
      : getUserMaxTierOrder(user._id, appId),
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
    const unlock = unlockedMap[g._id.toString()] || null;
    const giftTierOrder =
      g.tier && typeof g.tier === 'object' && typeof g.tier.displayOrder === 'number'
        ? g.tier.displayOrder
        : 0;

    let status;
    if (unlock) {
      status = 'unlocked';
    } else if (g.isFreeTeaser || g.tier?.key === 'free' || giftTierOrder === 0) {
      status = 'free';
    } else if (!isAnonymous && tierAccess.maxTierOrder >= giftTierOrder) {
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

  // Le `tierAccess` remplace l'ancien `balance`. On expose le tier max
  // de l'user (label + key) pour que le mobile affiche "Tu as accès Or".
  return { items, tierAccess };
}

/**
 * Débloque un cadeau pour l'utilisateur. Pas de débit — l'user paie via
 * le package qui lui donne accès au tier. On vérifie juste que son
 * tier-access couvre le tier du cadeau, puis on crée l'unlock.
 *
 * Idempotent : si l'unlock existe déjà, on le renvoie sans erreur.
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

  // Cadeaux gratuits : déblocage sans check de tier.
  const giftTierOrder =
    gift.tier && typeof gift.tier.displayOrder === 'number'
      ? gift.tier.displayOrder
      : 0;
  const isFree = gift.isFreeTeaser || gift.tier?.key === 'free' || giftTierOrder === 0;

  if (!isFree) {
    const { maxTierOrder } = await getUserMaxTierOrder(user._id, appId);
    if (maxTierOrder < giftTierOrder) {
      throw new AppError(
        "Ce cadeau n'est pas inclus dans ton abonnement actuel. Souscris à un forfait supérieur pour le débloquer.",
        402,
        ErrorCodes.VALIDATION_ERROR
      );
    }
  }

  let unlock;
  try {
    unlock = await UserGiftUnlock.create({
      appId,
      user: user._id,
      gift: gift._id,
      costPaid: 0,
      unlockedAt: new Date(),
    });
  } catch (err) {
    if (err.code === 11000) {
      // Race avec un autre process — on retourne l'existant.
      const existingUnlock = await UserGiftUnlock.findOne({
        appId,
        user: user._id,
        gift: gift._id,
      });
      return { gift, unlock: existingUnlock, alreadyUnlocked: true };
    }
    throw err;
  }

  return { gift, unlock, alreadyUnlocked: false };
}

/**
 * Récupère le contenu statique d'un cadeau.
 * Free teasers accessibles sans unlock ; sinon unlock requis.
 *
 * Si le gift a été désactivé par l'admin APRÈS qu'un user l'ait débloqué,
 * on autorise quand même l'accès — ne pas casser l'historique du user.
 */
function pickLocalizedMedia(field, lang = 'fr') {
  if (field == null || field === '') return null;
  if (typeof field === 'string') return field;
  if (typeof field === 'object') {
    const v = field[lang] || field.fr || field.en || null;
    return (typeof v === 'string' && v.length > 0) ? v : null;
  }
  return null;
}

async function getStaticContent({ user, appId, giftId, lang = 'fr' }) {
  const gift = await loadActiveGift({ giftId, appId, allowInactive: true });

  if (gift.type !== 'static') {
    throw new AppError(
      "Ce cadeau n'est pas de type statique",
      400,
      ErrorCodes.VALIDATION_ERROR
    );
  }

  const giftTierOrder =
    gift.tier && typeof gift.tier.displayOrder === 'number'
      ? gift.tier.displayOrder
      : 0;
  const isFree = gift.isFreeTeaser || gift.tier?.key === 'free' || giftTierOrder === 0;

  const unlock = await UserGiftUnlock.findOne({
    appId,
    user: user._id,
    gift: gift._id,
  });

  if (!unlock && !isFree) {
    throw new AppError(
      "Ce cadeau n'est pas débloqué.",
      403,
      ErrorCodes.AUTH_FORBIDDEN || 'FORBIDDEN'
    );
  }

  if (!unlock && isFree && !gift.isActive) {
    throw new AppError('Cadeau introuvable', 404, ErrorCodes.NOT_FOUND);
  }

  // Increment readCount atomiquement après les checks d'accès. Fire and
  // forget — si l'$inc échoue (très rare), on log mais on ne casse pas
  // l'expérience user. C'est un compteur d'analytics, pas critique.
  Gift.updateOne({ _id: gift._id }, { $inc: { readCount: 1 } }).catch((err) =>
    logger.warn(`[giftCatalog] readCount inc failed gift=${gift._id}: ${err.message}`)
  );

  return {
    type: 'static',
    staticFormat: gift.staticFormat,
    contentUrl: pickLocalizedMedia(gift.contentUrl, lang),
    htmlContent: pickLocalizedMedia(gift.htmlContent, lang),
  };
}

/**
 * Génère un cadeau IA : check tier-access ou unlock + rate limit + appel
 * Gemini + persistence.
 *
 * Comme getStaticContent, on autorise un gift inactif si l'user a déjà un
 * unlock (ne pas casser l'historique). MAIS on bloque la première
 * génération si le gift est inactif (pas de nouveau unlock sur cadeau
 * désactivé).
 */
async function generateAiGift({ user, appId, giftId, formData = {} }) {
  const gift = await loadActiveGift({ giftId, appId, allowInactive: true });

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
    if (!gift.isActive) {
      throw new AppError('Cadeau introuvable', 404, ErrorCodes.NOT_FOUND);
    }
    const giftTierOrder =
      gift.tier && typeof gift.tier.displayOrder === 'number'
        ? gift.tier.displayOrder
        : 0;
    const isFree = gift.isFreeTeaser || gift.tier?.key === 'free' || giftTierOrder === 0;
    if (!isFree) {
      const { maxTierOrder } = await getUserMaxTierOrder(user._id, appId);
      if (maxTierOrder < giftTierOrder) {
        throw new AppError(
          "Tu dois d'abord débloquer ce cadeau (souscris à un forfait incluant ce tier).",
          403,
          ErrorCodes.AUTH_FORBIDDEN || 'FORBIDDEN'
        );
      }
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

  // Une génération IA réussie = une lecture supplémentaire. Fire and forget.
  Gift.updateOne({ _id: gift._id }, { $inc: { readCount: 1 } }).catch((err) =>
    logger.warn(`[giftCatalog] readCount inc failed gift=${gift._id}: ${err.message}`)
  );

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
 * Autorise les gifts désactivés si l'user a déjà un unlock (historique).
 */
async function getMyUnlock({ user, appId, giftId }) {
  const gift = await loadActiveGift({ giftId, appId, allowInactive: true });

  const unlock = await UserGiftUnlock.findOne({
    appId,
    user: user._id,
    gift: gift._id,
  });

  if (!gift.isActive && !unlock) {
    throw new AppError('Cadeau introuvable', 404, ErrorCodes.NOT_FOUND);
  }

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
  getUserMaxTierOrder,
};
