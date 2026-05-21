// src/api/services/user/wheelService.js
//
// Cœur métier de la "Roue de la Chance" — multi-tenant (tout est scopé par
// `appId`). Système de TICKETS :
//   - L'user a un solde de tours (ticketsBalance) dans WheelUserStats.
//   - Il gagne des tours via wheelTicketService (pubs récompensées + SSV).
//   - Tourner la roue dépense 1 tour : synchrone côté serveur. Le mobile fait
//     converger son animation vers le segment du lot retourné.
//
// Tirage pondéré + capé. Idempotence du spin via `clientRequestId` optionnel.

const crypto = require('crypto');
const WheelPrize = require('../../models/common/WheelPrize');
const WheelConfig = require('../../models/common/WheelConfig');
const WheelSpin = require('../../models/common/WheelSpin');
const WheelUserStats = require('../../models/common/WheelUserStats');
const Subscription = require('../../models/common/Subscription');
const Package = require('../../models/common/Package');
const Gift = require('../../models/common/Gift');
const UserGiftUnlock = require('../../models/common/UserGiftUnlock');
const walletService = require('../common/walletService');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

/**
 * Détermine le "meilleur" package à attribuer pour un lot subscription dont le
 * packageId n'est pas configuré. Le meilleur = celui actif (de l'app) avec le
 * PLUS de catégories ; en cas d'égalité, durée la plus longue.
 * Cache mémoire 60s par app.
 */
const _bestPackageCache = new Map(); // appId -> { id, expiresAt }
async function findBestVipPackage(appId) {
  const cached = _bestPackageCache.get(appId);
  if (cached && Date.now() < cached.expiresAt) return cached.id;
  const results = await Package.aggregate([
    { $match: { appId, isActive: true } },
    { $addFields: { categoryCount: { $size: { $ifNull: ['$categories', []] } } } },
    { $sort: { categoryCount: -1, duration: -1 } },
    { $limit: 1 },
    { $project: { _id: 1 } }
  ]);
  const id = results[0]?._id || null;
  _bestPackageCache.set(appId, { id, expiresAt: Date.now() + 60_000 });
  return id;
}

function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function startOfMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), 1); }

/**
 * Un lot est-il visible / gagnable pour un pays donné ?
 *   - countries vide   → lot universel (partout)
 *   - countries remplis → uniquement les users de ces pays
 *   - country absent    → seuls les lots universels passent
 */
function prizeMatchesCountry(prize, country) {
  const list = Array.isArray(prize.countries) ? prize.countries : [];
  if (list.length === 0) return true;
  if (!country) return false;
  return list.includes(String(country).toUpperCase());
}

/**
 * Vérifie qu'un lot peut être tiré : enabled + tous les caps satisfaits.
 * Tous les comptages sont scopés par app.
 */
async function isPrizeAvailable(appId, prize, userId) {
  if (!prize.enabled) return false;
  const c = prize.caps || {};
  if (c.globalDay != null) {
    const n = await WheelSpin.countDocuments({ appId, prize: prize._id, createdAt: { $gte: startOfDay() } });
    if (n >= c.globalDay) return false;
  }
  if (c.globalMonth != null) {
    const n = await WheelSpin.countDocuments({ appId, prize: prize._id, createdAt: { $gte: startOfMonth() } });
    if (n >= c.globalMonth) return false;
  }
  if (c.userDay != null) {
    const n = await WheelSpin.countDocuments({ appId, user: userId, prize: prize._id, createdAt: { $gte: startOfDay() } });
    if (n >= c.userDay) return false;
  }
  if (c.userMonth != null) {
    const n = await WheelSpin.countDocuments({ appId, user: userId, prize: prize._id, createdAt: { $gte: startOfMonth() } });
    if (n >= c.userMonth) return false;
  }
  if (c.userLifetime != null) {
    const n = await WheelSpin.countDocuments({ appId, user: userId, prize: prize._id });
    if (n >= c.userLifetime) return false;
  }
  if (c.window && c.window.days && c.window.max != null) {
    const since = new Date(Date.now() - c.window.days * 86400000);
    const n = await WheelSpin.countDocuments({ appId, prize: prize._id, createdAt: { $gte: since } });
    if (n >= c.window.max) return false;
  }
  return true;
}

/**
 * Tirage pondéré parmi les lots dispos de l'app, avec fallback isFallback.
 * `country` (ISO-2) restreint le pool : lots universels + lots ciblés sur ce pays.
 */
async function drawPrize(appId, userId, country) {
  const all = (await WheelPrize.find({ appId, enabled: true }))
    .filter(p => prizeMatchesCountry(p, country));
  if (all.length === 0) {
    throw new AppError('Aucun lot configuré sur la roue.', 500, ErrorCodes.SERVICE_UNAVAILABLE);
  }
  const available = [];
  for (const p of all) {
    if (await isPrizeAvailable(appId, p, userId)) available.push(p);
  }
  if (available.length === 0) {
    const fb = await WheelPrize.findOne({ appId, isFallback: true, enabled: true });
    return fb || all[0];
  }
  const totalWeight = available.reduce((s, p) => s + Math.max(0, p.weight || 0), 0);
  if (totalWeight <= 0) {
    return available.find(p => p.isFallback) || available[0];
  }
  let r = Math.random() * totalWeight;
  for (const p of available) {
    r -= Math.max(0, p.weight || 0);
    if (r <= 0) return p;
  }
  return available[available.length - 1];
}

/**
 * Spin synchrone : consomme 1 ticket, tire un lot, applique, crée WheelSpin.
 *
 * @param {string} appId
 * @param {string} userId
 * @param {object} opts {currency, lang, clientRequestId, country}
 * @returns spin formaté
 */
async function spin(appId, userId, { currency = 'XAF', lang = 'fr', clientRequestId, country = null } = {}) {
  const cfg = await WheelConfig.getSingleton(appId);
  if (!cfg.wheelEnabled) {
    throw new AppError('La roue est temporairement indisponible.', 503, ErrorCodes.SERVICE_UNAVAILABLE);
  }

  // Idempotence client : si un WheelSpin existe déjà pour ce clientRequestId,
  // on le retourne au lieu de consommer un nouveau ticket.
  if (clientRequestId) {
    const existing = await WheelSpin.findOne({ appId, nonce: `cli-${clientRequestId}` }).populate('prize');
    if (existing) return formatSpin(existing, lang, currency);
  }

  const stats = await WheelUserStats.getOrCreate(appId, userId);

  // Cooldown anti-bot
  if (stats.lastSpinAt && cfg.cooldownSec > 0) {
    const elapsed = (Date.now() - stats.lastSpinAt.getTime()) / 1000;
    if (elapsed < cfg.cooldownSec) {
      throw new AppError(
        `Patiente ${Math.ceil(cfg.cooldownSec - elapsed)}s avant de relancer.`,
        429, ErrorCodes.RATE_LIMIT_EXCEEDED
      );
    }
  }

  // Limite quotidienne (anti-farm)
  const todayCount = await WheelSpin.countDocuments({ appId, user: userId, createdAt: { $gte: startOfDay() } });
  if (todayCount >= cfg.dailyMaxSpinsPerUser) {
    throw new AppError('Tu as atteint le maximum de tours pour aujourd\'hui.', 429, ErrorCodes.RATE_LIMIT_EXCEEDED);
  }

  // *** Consommation du ticket ***
  if ((stats.ticketsBalance || 0) < 1) {
    throw new AppError(
      'Tu n\'as plus de tours. Regarde des pubs pour en obtenir.',
      402, ErrorCodes.PAYMENT_REQUIRED
    );
  }
  stats.ticketsBalance = Math.max(0, stats.ticketsBalance - 1);

  const prize = await drawPrize(appId, userId, country);

  // Snapshot complet du prize (fige l'amount/currency choisis pour cet user).
  const snapshot = {
    name: prize.name,
    type: prize.type,
    cash: prize.cash ? {
      amount: prize.getCashAmountFor(currency),
      currency: prize.getCashCurrency(currency)
    } : null,
    physical: prize.physical,
    subscription: prize.subscription,
    freeSpin: prize.freeSpin,
    gift: { tierId: prize.gift?.tierId || null }
  };

  let status = 'won';
  let walletTxId = null;
  let subId = null;
  let giftUnlockId = null;

  try {
    if (prize.type === 'cash') {
      const amount = prize.getCashAmountFor(currency) || 0;
      const cashCur = prize.getCashCurrency(currency);
      if (amount > 0) {
        const { transaction } = await walletService.credit({
          appId, userId, amount, currency: cashCur,
          source: { kind: 'wheel_spin', ref: null },
          description: `Gain roue: ${prize.name?.fr || 'cash'}`
        });
        walletTxId = transaction._id;
      }
      status = 'claimed_auto';
    } else if (prize.type === 'free_spin') {
      const n = prize.freeSpin?.count || 1;
      stats.ticketsBalance += n;
      stats.totalTicketsEarned = (stats.totalTicketsEarned || 0) + n;
      status = 'claimed_auto';
    } else if (prize.type === 'subscription') {
      let packageId = prize.subscription?.packageId || null;
      if (!packageId) {
        packageId = await findBestVipPackage(appId);
      }
      if (packageId) {
        const startDate = new Date();
        const endDate = new Date(startDate.getTime() + (prize.subscription?.durationHours || 24) * 3600 * 1000);
        const sub = await Subscription.create({
          appId,
          user: userId,
          package: packageId,
          startDate, endDate,
          pricing: { amount: 0, currency: 'XAF' },
          status: 'active',
          paymentProvider: 'ADS',
          paymentReference: `wheel:${appId}:${userId}:${Date.now()}`
        });
        subId = sub._id;
      }
      status = 'claimed_auto';
    } else if (prize.type === 'gift') {
      // Débloque un cadeau du tier configuré : on choisit un Gift actif de ce
      // tier (de l'app) que l'user n'a pas encore débloqué, et on crée un
      // UserGiftUnlock. Si aucun cadeau dispo → on marque quand même
      // claimed_auto (un admin pourra créditer manuellement).
      const tierId = prize.gift?.tierId || null;
      if (tierId) {
        const owned = await UserGiftUnlock.find({ appId, user: userId }).distinct('gift');
        const candidates = await Gift.find({
          appId, tier: tierId, isActive: true,
          _id: { $nin: owned }
        }).select('_id');
        if (candidates.length > 0) {
          const chosen = candidates[Math.floor(Math.random() * candidates.length)];
          const unlock = await UserGiftUnlock.create({ appId, user: userId, gift: chosen._id });
          giftUnlockId = unlock._id;
        }
      }
      status = 'claimed_auto';
    } else if (prize.type === 'physical') {
      status = 'pending_delivery';
    } else {
      status = 'claimed_auto';
    }
  } catch (e) {
    console.error('[wheelService.spin] Apply prize failed:', e.message);
  }

  // Nonce unique pour ce spin (idempotence client + index unique (appId,nonce))
  const spinNonce = clientRequestId
    ? `cli-${clientRequestId}`
    : `sync-${crypto.randomBytes(12).toString('hex')}-${Date.now()}`;

  let spinDoc;
  try {
    spinDoc = await WheelSpin.create({
      appId,
      user: userId,
      prize: prize._id,
      prizeSnapshot: snapshot,
      unlockId: null,
      nonce: spinNonce,
      adsRequired: 0,
      wasFreeSpin: false,
      status,
      walletTransaction: walletTxId,
      subscriptionCreated: subId,
      giftUnlockCreated: giftUnlockId
    });
  } catch (e) {
    if (e.code === 11000) {
      // Race sur (appId, nonce) → on retourne l'existant + rollback du ticket
      const existing = await WheelSpin.findOne({ appId, nonce: spinNonce }).populate('prize');
      if (existing) {
        stats.ticketsBalance += 1;
        await stats.save();
        return formatSpin(existing, lang, currency);
      }
    }
    // Erreur fatale → restaure le ticket consommé
    stats.ticketsBalance += 1;
    await stats.save();
    throw e;
  }

  stats.lastSpinAt = new Date();
  stats.totalSpins = (stats.totalSpins || 0) + 1;
  await stats.save();

  await spinDoc.populate('prize');
  return formatSpin(spinDoc, lang, currency);
}

/**
 * Formatte un WheelSpin pour le client.
 */
function formatSpin(spinDoc, lang = 'fr', currency = 'XAF') {
  const p = spinDoc.prize || {};
  const snap = spinDoc.prizeSnapshot || {};
  const name = snap.name || p.name || {};
  return {
    _id: spinDoc._id,
    status: spinDoc.status,
    wasFreeSpin: spinDoc.wasFreeSpin,
    createdAt: spinDoc.createdAt,
    prize: {
      _id: p._id || null,
      name: name[lang] || name.fr || '',
      type: snap.type || p.type,
      color: p.color || '#FFD700',
      icon: p.icon || null,
      order: p.order ?? null,
      cash: snap.cash || p.cash || null,
      physical: snap.physical || p.physical || null,
      subscription: snap.subscription || p.subscription || null,
      freeSpin: snap.freeSpin || p.freeSpin || null,
      gift: snap.gift || (p.gift ? { tierId: p.gift.tierId } : null)
    }
  };
}

/**
 * Config publique pour le client — adapte les montants cash à la devise de l'user
 * et filtre les lots selon le pays (universels + lots ciblés sur ce pays).
 */
async function getPublicConfig(appId, lang = 'fr', currency = 'XAF', country = null) {
  const cfg = await WheelConfig.getSingleton(appId);
  const prizes = (await WheelPrize.find({ appId, enabled: true }).sort({ order: 1, createdAt: 1 }))
    .filter(p => prizeMatchesCountry(p, country));
  return {
    wheelEnabled: cfg.wheelEnabled,
    adsPerSpin: cfg.adsPerSpin,
    cooldownSec: cfg.cooldownSec,
    dailyMaxSpinsPerUser: cfg.dailyMaxSpinsPerUser,
    defaultCurrency: cfg.defaultCurrency,
    prizes: prizes.map(p => p.toPublicJSON(lang, currency))
  };
}

/**
 * Historique des spins d'un user (paginé, descendant).
 */
async function getHistory(appId, userId, { limit = 10, skip = 0, lang = 'fr', currency = 'XAF' } = {}) {
  const lim = Math.min(limit, 50);
  const [spins, total] = await Promise.all([
    WheelSpin.find({ appId, user: userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(lim)
      .populate('prize'),
    WheelSpin.countDocuments({ appId, user: userId })
  ]);
  return {
    items: spins.map(s => formatSpin(s, lang, currency)),
    pagination: {
      skip,
      limit: lim,
      total,
      hasNext: (skip + spins.length) < total
    }
  };
}

/**
 * Solde de tickets + stats user (vue publique mobile).
 */
async function getUserStats(appId, userId) {
  const stats = await WheelUserStats.getOrCreate(appId, userId);
  return {
    ticketsBalance: stats.ticketsBalance || 0,
    totalTicketsEarned: stats.totalTicketsEarned || 0,
    totalSpins: stats.totalSpins || 0,
    lastSpinAt: stats.lastSpinAt
  };
}

module.exports = {
  spin,
  drawPrize,
  getPublicConfig,
  getHistory,
  getUserStats,
  findBestVipPackage
};
