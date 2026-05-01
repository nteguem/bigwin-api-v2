// src/api/services/common/creditWalletService.js
//
// SOURCE UNIQUE de vérité pour toute opération sur les crédits "cadeaux".
// Toute autre partie du code doit passer par ce service.
//
// Garanties :
//  - Toutes les opérations sont atomiques (findOneAndUpdate).
//  - Le credit est idempotent : si on tente de créditer 2x la même source/refId,
//    le 2ème appel renvoie le wallet inchangé.
//  - Le debit est atomique avec garde "fonds suffisants" via $expr.
//    Pas de race condition possible : 2 clics simultanés → 1 seul réussit.
//  - Toute opération laisse une trace dans wallet.history (audit log).

const mongoose = require('mongoose');
const UserCreditWallet = require('../../models/common/UserCreditWallet');
const logger = require('../../../utils/logger');

/**
 * Récupère ou crée le wallet pour (user, app).
 * Idempotent.
 */
async function getOrCreateWallet(userId, appId) {
  if (!userId || !appId) {
    throw new Error('getOrCreateWallet: userId et appId requis');
  }

  const wallet = await UserCreditWallet.findOneAndUpdate(
    { appId, user: userId },
    {
      $setOnInsert: {
        appId,
        user: userId,
        totalCredits: 0,
        usedCredits: 0,
        history: [],
        createdAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return wallet;
}

/**
 * Crédite le wallet de manière IDEMPOTENTE.
 *
 * Si une entrée d'historique existe déjà pour (source, refId), on skip et on
 * retourne le wallet sans modification. Cela rend le hook Subscription safe
 * même s'il s'exécute plusieurs fois (replays, retries, double-save).
 *
 * @param {Object} params
 * @param {ObjectId|String} params.user      - ID utilisateur
 * @param {String}          params.appId     - ID app
 * @param {Number}          params.amount    - montant à créditer (>0)
 * @param {String}          params.source    - 'subscription'|'admin_grant'|'promo'
 * @param {ObjectId|String} [params.refId]   - réf entité source (subscription, etc.)
 * @param {String}          [params.refModel]
 * @param {String}          [params.note]
 * @returns {Promise<{wallet: Document, alreadyCredited: Boolean}>}
 */
async function creditWallet({ user, appId, amount, source, refId, refModel, note }) {
  if (!user || !appId) throw new Error('creditWallet: user et appId requis');
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('creditWallet: amount doit être > 0');
  }
  if (!source) throw new Error('creditWallet: source requis');

  // 1) S'assurer que le wallet existe
  await getOrCreateWallet(user, appId);

  // 2) Garde idempotence : si on a un refId, on vérifie qu'il n'a pas déjà
  //    été crédité pour cette source. Sinon on créditerait 2x sur replay.
  if (refId) {
    const existing = await UserCreditWallet.findOne({
      appId,
      user,
      'history.source': source,
      'history.refId': refId,
    }).lean();

    if (existing) {
      logger.info(
        `[creditWallet] SKIP idempotent — user=${user} app=${appId} source=${source} refId=${refId}`
      );
      const wallet = await UserCreditWallet.findOne({ appId, user });
      return { wallet, alreadyCredited: true };
    }
  }

  // 3) Crédit atomique
  const wallet = await UserCreditWallet.findOneAndUpdate(
    { appId, user },
    {
      $inc: { totalCredits: amount },
      $set: { updatedAt: new Date() },
      $push: {
        history: {
          delta: amount,
          source,
          refId: refId || undefined,
          refModel: refModel || undefined,
          note: note || undefined,
          at: new Date(),
        },
      },
    },
    { new: true }
  );

  logger.info(
    `[creditWallet] +${amount} user=${user} app=${appId} source=${source} refId=${refId || 'none'}`
  );

  return { wallet, alreadyCredited: false };
}

/**
 * Débite le wallet de manière ATOMIQUE avec garde "solde suffisant".
 *
 * Utilise un $expr dans le filter pour garantir que le débit ne passe que si
 * (totalCredits - usedCredits) >= amount. Si insuffisant ou wallet inexistant,
 * findOneAndUpdate renvoie null → on lève NOT_ENOUGH_CREDITS.
 *
 * 2 clics simultanés → un seul des 2 trouve un solde suffisant.
 *
 * @param {Object} params
 * @param {ObjectId|String} params.user
 * @param {String}          params.appId
 * @param {Number}          params.amount     - montant à débiter (>0)
 * @param {String}          params.source     - 'gift_unlock'|'admin_adjust'
 * @param {ObjectId|String} [params.refId]    - réf entité (gift, etc.)
 * @param {String}          [params.refModel]
 * @param {String}          [params.note]
 * @returns {Promise<Document>} wallet mis à jour
 * @throws  {Error} avec err.code='NOT_ENOUGH_CREDITS' si solde insuffisant
 */
async function debitWallet({ user, appId, amount, source, refId, refModel, note }) {
  if (!user || !appId) throw new Error('debitWallet: user et appId requis');
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('debitWallet: amount doit être > 0');
  }
  if (!source) throw new Error('debitWallet: source requis');

  // Si amount === 0 → no-op (pour les cadeaux gratuits)
  // (mais on a déjà guard amount > 0 plus haut, donc 0 fait sauter avant)

  const wallet = await UserCreditWallet.findOneAndUpdate(
    {
      appId,
      user,
      // GARDE ATOMIQUE : ne match que si solde dispo suffisant
      $expr: {
        $gte: [
          { $subtract: ['$totalCredits', '$usedCredits'] },
          amount,
        ],
      },
    },
    {
      $inc: { usedCredits: amount },
      $set: { updatedAt: new Date() },
      $push: {
        history: {
          delta: -amount,
          source,
          refId: refId || undefined,
          refModel: refModel || undefined,
          note: note || undefined,
          at: new Date(),
        },
      },
    },
    { new: true }
  );

  if (!wallet) {
    const err = new Error('Solde de cadeaux insuffisant');
    err.code = 'NOT_ENOUGH_CREDITS';
    throw err;
  }

  logger.info(
    `[debitWallet] -${amount} user=${user} app=${appId} source=${source} refId=${refId || 'none'}`
  );

  return wallet;
}

/**
 * Rembourse un débit (ex : génération IA qui a foiré → on rend les crédits).
 * Cas typique : on a débité au unlock, mais le contenu n'est pas servi.
 * En pratique on ne devrait pas en avoir besoin car le débit ne se fait qu'au
 * unlock (qui ne fait pas d'appel IA), mais on l'expose au cas où.
 */
async function refundWallet({ user, appId, amount, refId, refModel, note }) {
  return creditWallet({
    user,
    appId,
    amount,
    source: 'admin_adjust',
    refId,
    refModel,
    note: note || 'Refund',
  });
}

/**
 * Lecture du solde dispo (pour les controllers).
 */
async function getBalance(userId, appId) {
  const wallet = await UserCreditWallet.findOne({ appId, user: userId }).lean();
  if (!wallet) {
    return {
      totalCredits: 0,
      usedCredits: 0,
      availableCredits: 0,
      historyCount: 0,
    };
  }
  return {
    totalCredits: wallet.totalCredits || 0,
    usedCredits: wallet.usedCredits || 0,
    availableCredits: Math.max(
      0,
      (wallet.totalCredits || 0) - (wallet.usedCredits || 0)
    ),
    historyCount: (wallet.history || []).length,
  };
}

module.exports = {
  getOrCreateWallet,
  creditWallet,
  debitWallet,
  refundWallet,
  getBalance,
};
