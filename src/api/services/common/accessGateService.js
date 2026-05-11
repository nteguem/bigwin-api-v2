// src/api/services/common/accessGateService.js
//
// Logique métier du déblocage de tickets free par visionnage de pubs
// récompensées (AdMob rewarded + Server-Side Verification).
//
// Concepts :
//  - Un ticket peut porter un sous-document `accessGate` ({ type:'ad_reward',
//    options:[{ durationMinutes, adsRequired }] }). Absent ⇒ ticket public.
//  - Pour un ticket gaté, l'utilisateur choisit une offre puis regarde
//    `adsRequired` pubs récompensées. Chaque pub validée par le SSV incrémente
//    un compteur côté serveur (UserAccessUnlock.verifiedCount).
//  - Une fois le seuil atteint : accès débloqué jusqu'à `unlockedAt + durée`
//    (ou à vie si `durationMinutes` est null).
//  - La progression partielle est conservée et reportée si l'utilisateur
//    change d'offre. Une fois l'accès actif, l'offre est figée jusqu'à
//    l'expiration (comme un abonnement).

const crypto = require('crypto');
const mongoose = require('mongoose');
const UserAccessUnlock = require('../../models/common/UserAccessUnlock');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

const RESOURCE_TYPE_TICKET = 'ticket';

/** Forme d'une offre telle qu'exposée par l'API. */
function publicOption(opt) {
  return {
    durationMinutes: opt.durationMinutes ?? null,
    adsRequired: opt.adsRequired
  };
}

/** Le ticket a-t-il une porte de déblocage active et bien formée ? */
function ticketIsGated(ticket) {
  const gate = ticket && ticket.accessGate;
  return !!(
    gate &&
    gate.type === 'ad_reward' &&
    Array.isArray(gate.options) &&
    gate.options.length > 0
  );
}

/**
 * Bloc `state` exposé par l'API à partir d'un doc UserAccessUnlock.
 * Si l'unlock est expiré, on présente verifiedCount = 0 : les pubs consommées
 * pour une période expirée ne sont pas réutilisables pour la suivante.
 */
function buildState(doc) {
  if (!doc) return null;
  const active = doc.isAccessActive();
  const expired = doc.status === 'unlocked' && !active; // unlocked mais dépassé
  return {
    status: active ? 'unlocked' : 'in_progress',
    verifiedCount: expired ? 0 : (doc.verifiedCount || 0),
    adsRequired: expired ? null : (doc.selectedOption ? doc.selectedOption.adsRequired ?? null : null),
    selectedDurationMinutes: expired ? null : (doc.selectedOption ? doc.selectedOption.durationMinutes ?? null : null),
    unlockedAt: active ? doc.unlockedAt : null,
    expiresAt: active ? doc.expiresAt : null
  };
}

/**
 * État de la porte d'un ticket pour un utilisateur.
 * @param {string} appId
 * @param {string|null} userId  null si requête anonyme
 * @param {object} ticket  document/objet Ticket (doit contenir `accessGate`)
 * @returns {Promise<{ gated:boolean, locked:boolean, offers:Array, state:object|null }>}
 *   - gated  : le ticket a une porte
 *   - locked : porte active ET l'utilisateur n'a pas (ou plus) l'accès
 *   - offers : offres proposées (toujours présentes si gated)
 *   - state  : progression de l'utilisateur (null si non gaté ou pas d'user)
 */
async function getTicketGateState(appId, userId, ticket) {
  if (!ticketIsGated(ticket)) {
    return { gated: false, locked: false, offers: [], state: null };
  }
  const offers = ticket.accessGate.options.map(publicOption);
  if (!userId) {
    return { gated: true, locked: true, offers, state: null };
  }
  const doc = await UserAccessUnlock.findOne({
    appId,
    user: userId,
    resourceType: RESOURCE_TYPE_TICKET,
    resource: ticket._id
  });
  const locked = !(doc && doc.isAccessActive());
  return { gated: true, locked, offers, state: buildState(doc) };
}

/**
 * Le ticket est-il actuellement débloqué pour cet utilisateur ?
 * (Utilisé par le contrôleur coupons pour décider d'inclure ou non les pronos.)
 */
async function isTicketUnlockedFor(appId, userId, ticketId) {
  if (!userId) return false;
  const doc = await UserAccessUnlock.findOne({
    appId,
    user: userId,
    resourceType: RESOURCE_TYPE_TICKET,
    resource: ticketId
  });
  return !!(doc && doc.isAccessActive());
}

/**
 * Démarre (ou re-choisit) une tentative de déblocage pour un ticket gaté.
 *  - accès déjà actif → 409 (changement possible seulement après expiration)
 *  - tentative en cours → on change l'offre en CONSERVANT verifiedCount ;
 *    si verifiedCount couvre déjà la nouvelle offre → déblocage immédiat
 *  - unlock expiré → réinitialisation (verifiedCount = 0, rewards purgés)
 *
 * @param {object} ticket  document Ticket déjà chargé et accessible (avec accessGate)
 * @param {number|null} durationMinutes  null = "à vie" ; doit correspondre à
 *        une offre déclarée sur le ticket
 */
async function startOrSwitchUnlock(appId, userId, ticket, durationMinutes) {
  if (!ticketIsGated(ticket)) {
    throw new AppError('Ce ticket ne nécessite pas de déblocage.', 400, ErrorCodes.VALIDATION_ERROR);
  }

  const wanted = (durationMinutes === undefined || durationMinutes === null) ? null : Number(durationMinutes);
  if (wanted !== null && (!Number.isFinite(wanted) || wanted < 1)) {
    throw new AppError('Durée de déblocage invalide.', 400, ErrorCodes.VALIDATION_ERROR);
  }
  const option = ticket.accessGate.options.find(o => ((o.durationMinutes ?? null) === wanted));
  if (!option) {
    throw new AppError('Offre de déblocage invalide pour ce ticket.', 400, ErrorCodes.VALIDATION_ERROR);
  }

  let doc = await UserAccessUnlock.findOne({
    appId, user: userId, resourceType: RESOURCE_TYPE_TICKET, resource: ticket._id
  });

  if (doc && doc.isAccessActive()) {
    throw new AppError(
      "Ce ticket est déjà débloqué. Tu pourras choisir une autre offre après l'expiration.",
      409,
      ErrorCodes.OPERATION_NOT_ALLOWED
    );
  }

  const carriedCount = (doc && doc.status === 'in_progress') ? (doc.verifiedCount || 0) : 0;

  if (!doc) {
    doc = new UserAccessUnlock({
      appId, user: userId, resourceType: RESOURCE_TYPE_TICKET, resource: ticket._id
    });
  }

  doc.status = 'in_progress';
  doc.selectedOption = {
    durationMinutes: option.durationMinutes ?? null,
    adsRequired: option.adsRequired
  };
  doc.verifiedCount = carriedCount;
  doc.nonce = crypto.randomBytes(24).toString('hex');
  doc.unlockedAt = null;
  doc.expiresAt = null;
  if (carriedCount === 0) doc.rewards = []; // repart d'un unlock expiré / nouveau

  // Déblocage immédiat si le report de pubs couvre déjà l'offre choisie (Cas C).
  if (doc.verifiedCount >= option.adsRequired) {
    doc.status = 'unlocked';
    doc.unlockedAt = new Date();
    doc.expiresAt = option.durationMinutes ? new Date(Date.now() + option.durationMinutes * 60000) : null;
  }

  await doc.save();

  return {
    nonce: doc.nonce,
    status: doc.status,
    verifiedCount: doc.verifiedCount,
    adsRequired: doc.selectedOption.adsRequired,
    durationMinutes: doc.selectedOption.durationMinutes,
    unlockedAt: doc.unlockedAt,
    expiresAt: doc.expiresAt,
    isAccessActive: doc.isAccessActive()
  };
}

/**
 * Enregistre une récompense vérifiée (depuis le handler du callback SSV AdMob).
 * Atomique + idempotent : la dédup se fait sur `transactionId`, donc les
 * retries d'AdMob (jusqu'à 5×) sont sans effet. Renvoie toujours `ok: true`
 * (le handler répond 200) ; `found:false` si le nonce est inconnu.
 *
 * @returns {Promise<{ ok:boolean, found:boolean, alreadyProcessed?:boolean, unlocked?:boolean }>}
 */
async function recordVerifiedReward({ nonce, userId, transactionId, adUnitId, adNetwork, rewardAmount, rewardItem, timestampMs }) {
  if (!nonce || !transactionId) return { ok: true, found: false };

  let userObjId = null;
  if (userId) {
    try { userObjId = new mongoose.Types.ObjectId(String(userId)); } catch (_) { userObjId = null; }
  }

  const reward = {
    transactionId: String(transactionId),
    adUnitId: adUnitId || null,
    adNetwork: adNetwork || null,
    rewardAmount: Number.isFinite(Number(rewardAmount)) ? Number(rewardAmount) : null,
    rewardItem: rewardItem || null,
    rewardedAt: timestampMs && Number.isFinite(Number(timestampMs)) ? new Date(Number(timestampMs)) : null,
    receivedAt: new Date()
  };

  const filter = {
    nonce,
    status: 'in_progress',
    'rewards.transactionId': { $ne: reward.transactionId }
  };
  if (userObjId) filter.user = userObjId;

  // Pipeline atomique : push de la récompense + incrément du compteur, puis
  // bascule en `unlocked` si le seuil est atteint. `$$NOW` = horloge serveur.
  const updated = await UserAccessUnlock.findOneAndUpdate(
    filter,
    [
      {
        $set: {
          rewards: { $concatArrays: [{ $ifNull: ['$rewards', []] }, [reward]] },
          verifiedCount: { $add: [{ $ifNull: ['$verifiedCount', 0] }, 1] }
        }
      },
      {
        $set: {
          status: {
            $cond: [
              { $gte: ['$verifiedCount', { $ifNull: ['$selectedOption.adsRequired', 999999999] }] },
              'unlocked',
              '$status'
            ]
          },
          unlockedAt: {
            $cond: [
              { $gte: ['$verifiedCount', { $ifNull: ['$selectedOption.adsRequired', 999999999] }] },
              '$$NOW',
              '$unlockedAt'
            ]
          },
          expiresAt: {
            $cond: [
              {
                $and: [
                  { $gte: ['$verifiedCount', { $ifNull: ['$selectedOption.adsRequired', 999999999] }] },
                  { $ne: [{ $ifNull: ['$selectedOption.durationMinutes', null] }, null] }
                ]
              },
              { $add: ['$$NOW', { $multiply: ['$selectedOption.durationMinutes', 60000] }] },
              '$expiresAt'
            ]
          }
        }
      }
    ],
    { new: true }
  );

  if (updated) {
    return { ok: true, found: true, unlocked: updated.status === 'unlocked' };
  }

  // Pas de match : nonce inconnu, ou récompense déjà comptée, ou doc plus
  // `in_progress`. On lève l'ambiguïté.
  const doc = await UserAccessUnlock.findOne({ nonce });
  if (!doc) return { ok: true, found: false };
  if (userObjId && !doc.user.equals(userObjId)) return { ok: true, found: false }; // pas notre callback

  if (doc.rewards.some(r => r.transactionId === reward.transactionId)) {
    return { ok: true, found: true, alreadyProcessed: true, unlocked: doc.isAccessActive() };
  }

  // Doc déjà `unlocked` (callback arrivé après le déblocage) : on garde la
  // trace pour l'audit, sans rien changer d'autre. Best-effort.
  try {
    await UserAccessUnlock.updateOne(
      { _id: doc._id, 'rewards.transactionId': { $ne: reward.transactionId } },
      { $push: { rewards: reward } }
    );
  } catch (_) { /* non bloquant */ }

  return { ok: true, found: true, unlocked: doc.isAccessActive() };
}

module.exports = {
  RESOURCE_TYPE_TICKET,
  ticketIsGated,
  publicOption,
  buildState,
  getTicketGateState,
  isTicketUnlockedFor,
  startOrSwitchUnlock,
  recordVerifiedReward
};
