// src/api/services/user/wheelTicketService.js
//
// Déblocage des "tours" (tickets) de la roue par visionnage de pubs — scopé
// par app (multi-tenant).
//
// Flow :
//   1. listPacks(appId, lang) → packs configurés par l'admin.
//   2. startUnlock(appId, userId, packIndex) → crée/réinitialise un
//      UserAccessUnlock 'wheel_tickets' (resource = WheelConfig._id de l'app)
//      avec un nonce frais préfixé `idx<N>-` (mémorise le pack). Le mobile
//      transmet ce nonce dans le `customData` AdMob.
//   3. (async) callback SSV → accessGateService.recordVerifiedReward incrémente
//      verifiedCount (travail générique par nonce — aucun code spécifique).
//   4. getUnlockState(appId, userId) → polling : quand status='unlocked',
//      crédite ticketsBalance et réinitialise l'unlock pour un prochain pack.

const crypto = require('crypto');
const UserAccessUnlock = require('../../models/common/UserAccessUnlock');
const WheelConfig = require('../../models/common/WheelConfig');
const WheelUserStats = require('../../models/common/WheelUserStats');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

const RESOURCE_TYPE_TICKETS = 'wheel_tickets';

/**
 * Liste des packs configurés (info publique).
 */
async function listPacks(appId, lang = 'fr') {
  const cfg = await WheelConfig.getSingleton(appId);
  return (cfg.ticketPacks || []).map((p, i) => ({
    index: i,
    tickets: p.tickets,
    adsRequired: p.adsRequired,
    label: (p.label && (p.label[lang] || p.label.fr)) || `${p.tickets} tour(s)`,
    featured: !!p.featured
  }));
}

/**
 * Démarre une session de déblocage de tickets pour le pack `packIndex`.
 */
async function startUnlock(appId, userId, packIndex) {
  const cfg = await WheelConfig.getSingleton(appId);
  if (!cfg.wheelEnabled) {
    throw new AppError('La roue est temporairement indisponible.', 503, ErrorCodes.SERVICE_UNAVAILABLE);
  }
  const idx = Number(packIndex);
  if (!Number.isInteger(idx) || idx < 0 || !cfg.ticketPacks || idx >= cfg.ticketPacks.length) {
    throw new AppError('Pack de tours invalide.', 400, ErrorCodes.VALIDATION_ERROR);
  }
  const pack = cfg.ticketPacks[idx];

  // Singleton par (app, user) : on réutilise toujours le même doc
  // (resource = cfg._id) pour ce resourceType.
  let doc = await UserAccessUnlock.findOne({
    appId,
    user: userId,
    resourceType: RESOURCE_TYPE_TICKETS,
    resource: cfg._id
  });

  if (doc) {
    doc.status = 'in_progress';
    doc.verifiedCount = 0;
    doc.rewards = [];
    doc.unlockedAt = null;
    doc.expiresAt = null;
  } else {
    doc = new UserAccessUnlock({
      appId,
      user: userId,
      resourceType: RESOURCE_TYPE_TICKETS,
      resource: cfg._id,
      status: 'in_progress'
    });
  }

  doc.selectedOption = {
    adsRequired: pack.adsRequired,
    durationMinutes: null
  };
  // Le packIndex est encodé dans le nonce (préfixe `idx<N>-`) pour figer le
  // pack même si l'user en relance un autre, et le relire au crédit.
  doc.nonce = `idx${idx}-${crypto.randomBytes(20).toString('hex')}`;
  await doc.save();

  return {
    nonce: doc.nonce,
    adsRequired: pack.adsRequired,
    adsWatched: 0,
    completed: false,
    ticketsToCredit: pack.tickets,
    packIndex: idx,
    packLabel: pack.label?.fr || `${pack.tickets} tour(s)`
  };
}

/**
 * Polling. Si le seuil est atteint → crédite ticketsBalance + reset.
 */
async function getUnlockState(appId, userId) {
  const cfg = await WheelConfig.getSingleton(appId);
  const stats = await WheelUserStats.getOrCreate(appId, userId);

  const doc = await UserAccessUnlock.findOne({
    appId,
    user: userId,
    resourceType: RESOURCE_TYPE_TICKETS,
    resource: cfg._id
  });

  if (!doc || !doc.nonce) {
    return {
      hasActiveUnlock: false,
      adsRequired: 0,
      adsWatched: 0,
      completed: false,
      nonce: null,
      ticketsBalance: stats.ticketsBalance,
      justCredited: 0
    };
  }

  const adsRequired = doc.selectedOption?.adsRequired ?? 0;
  let justCredited = 0;

  if (doc.status === 'unlocked') {
    const m = /^idx(\d+)-/.exec(doc.nonce);
    if (m) {
      const idx = Number(m[1]);
      const pack = (cfg.ticketPacks || [])[idx];
      if (pack) {
        stats.ticketsBalance += pack.tickets;
        stats.totalTicketsEarned = (stats.totalTicketsEarned || 0) + pack.tickets;
        await stats.save();
        justCredited = pack.tickets;
      }
    }
    // Reset pour permettre un nouveau pack
    doc.status = 'in_progress';
    doc.verifiedCount = 0;
    doc.rewards = [];
    doc.unlockedAt = null;
    doc.expiresAt = null;
    doc.nonce = null;
    doc.selectedOption = { adsRequired: null, durationMinutes: null };
    await doc.save();
  }

  return {
    hasActiveUnlock: doc.status === 'in_progress' && !!doc.nonce,
    adsRequired,
    adsWatched: Math.min(doc.verifiedCount || 0, adsRequired || Number.MAX_SAFE_INTEGER),
    completed: justCredited > 0,
    nonce: doc.nonce,
    ticketsBalance: stats.ticketsBalance,
    justCredited
  };
}

module.exports = {
  RESOURCE_TYPE_TICKETS,
  listPacks,
  startUnlock,
  getUnlockState
};
