// src/api/services/admin/acquisitionStatsService.js
//
// Stats d'acquisition utilisateurs : répartition google_ads / organique /
// affiliation (basée sur User.acquisition.source capturé via Play Install
// Referrer par le mobile, ET surtout sur l'existence d'un Referral ou d'une
// Commission qui fait basculer le user/la vente en source 'affiliation').
//
// Règles de classification :
//   - users   : 'affiliation' si un Referral (signed_up|converted) existe pour ce
//               user (en tant que referee). Sinon → acquisition.source.
//   - revenue : 'affiliation' si une Commission existe pour la subscription (peu
//               importe son status — même cancelled, ça reste une vente "via affil").
//               Sinon → user.acquisition.source.
//
// Trois agrégats :
//   - users   : nombre d'utilisateurs par source
//   - revenue : revenu (somme Subscription.pricing.amount) par source x devise
//   - monthly : revenu mensuel par source x devise (12 derniers mois)
//
// Plus, depuis l'ajout du module affiliation :
//   - commissionsXAF       : total brut dû aux affiliés sur la période (status !=
//                            cancelled), converti en XAF. À soustraire au CA brut.
//   - commissionsByCurrency: idem ventilé par devise (pour audit).

const User = require('../../models/user/User');
const Subscription = require('../../models/common/Subscription');
const Referral = require('../../models/affiliate/Referral');
const Commission = require('../../models/affiliate/Commission');
const { convertToXAF } = require('./subscriptionManagementService');

const SOURCES = ['google_ads', 'organique', 'affiliation'];

function buildUserMatch(appId, filters = {}) {
  const match = {};
  if (appId && appId !== 'all') match.appId = appId;
  if (filters.startDate || filters.endDate) {
    match.createdAt = {};
    if (filters.startDate) match.createdAt.$gte = new Date(filters.startDate);
    if (filters.endDate) match.createdAt.$lt = new Date(filters.endDate);
  }
  return match;
}

function buildSubscriptionMatch(appId, filters = {}) {
  // Pour les revenus, on filtre sur createdAt de Subscription (date d'achat),
  // pas sur la date de création du user.
  const match = { isGift: { $ne: true } };
  if (appId && appId !== 'all') match.appId = appId;
  if (filters.startDate || filters.endDate) {
    match.createdAt = {};
    if (filters.startDate) match.createdAt.$gte = new Date(filters.startDate);
    if (filters.endDate) match.createdAt.$lt = new Date(filters.endDate);
  }
  return match;
}

/**
 * Stats utilisateurs par source d'acquisition.
 * Un user est considéré 'affiliation' s'il a été parrainé (Referral existe en
 * tant que referee, status signed_up ou converted — pas country_mismatch /
 * self_ref qui sont des cas dégradés). Sinon, on retombe sur acquisition.source.
 * `untracked` = users créés avant le sprint (acquisition.source null + pas de referral).
 */
async function getUsersBySource(appId, filters = {}) {
  const match = buildUserMatch(appId, filters);

  const result = await User.aggregate([
    { $match: match },
    {
      $lookup: {
        from: 'referrals',
        let: { userId: '$_id', userAppId: '$appId' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$referee', '$$userId'] },
                  { $eq: ['$appId', '$$userAppId'] },
                  { $in: ['$status', ['signed_up', 'converted']] },
                ],
              },
            },
          },
          { $limit: 1 },
          { $project: { _id: 1 } },
        ],
        as: 'referralDoc',
      },
    },
    {
      $addFields: {
        effectiveSource: {
          $cond: [
            { $gt: [{ $size: '$referralDoc' }, 0] },
            'affiliation',
            '$acquisition.source',
          ],
        },
      },
    },
    {
      $group: {
        _id: '$effectiveSource',
        count: { $sum: 1 },
      },
    },
  ]);

  const out = { google_ads: 0, organique: 0, affiliation: 0, untracked: 0 };
  for (const row of result) {
    if (row._id === 'google_ads') out.google_ads = row.count;
    else if (row._id === 'organique') out.organique = row.count;
    else if (row._id === 'affiliation') out.affiliation = row.count;
    else out.untracked += row.count; // null ou source inconnue
  }
  return out;
}

/**
 * Revenu par source d'acquisition x devise.
 * Join Subscription → Commission (pour détecter affiliation) → User (fallback
 * acquisition.source).
 */
async function getRevenueBySource(appId, filters = {}) {
  const match = buildSubscriptionMatch(appId, filters);

  const result = await Subscription.aggregate([
    { $match: match },
    {
      $lookup: {
        from: 'commissions',
        let: { subId: '$_id', subAppId: '$appId' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$subscription', '$$subId'] },
                  { $eq: ['$appId', '$$subAppId'] },
                ],
              },
            },
          },
          { $limit: 1 },
          { $project: { _id: 1 } },
        ],
        as: 'commissionDoc',
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        as: 'userDoc',
      },
    },
    { $unwind: { path: '$userDoc', preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        effectiveSource: {
          $cond: [
            { $gt: [{ $size: '$commissionDoc' }, 0] },
            'affiliation',
            '$userDoc.acquisition.source',
          ],
        },
      },
    },
    {
      $group: {
        _id: {
          source: '$effectiveSource',
          currency: '$pricing.currency',
        },
        count: { $sum: 1 },
        totalAmount: { $sum: '$pricing.amount' },
      },
    },
  ]);

  // Pivoter en { [currency]: { google_ads:..., organique:..., affiliation:..., untracked:... } }
  const byCurrency = {};
  for (const row of result) {
    const currency = row._id.currency;
    if (!currency) continue;
    if (!byCurrency[currency]) {
      byCurrency[currency] = {
        google_ads: { amount: 0, count: 0 },
        organique: { amount: 0, count: 0 },
        affiliation: { amount: 0, count: 0 },
        untracked: { amount: 0, count: 0 },
      };
    }
    const sourceKey = SOURCES.includes(row._id.source) ? row._id.source : 'untracked';
    byCurrency[currency][sourceKey].amount += row.totalAmount;
    byCurrency[currency][sourceKey].count += row.count;
  }

  // Format array pour le frontend
  return Object.entries(byCurrency).map(([currency, data]) => ({
    currency,
    ...data,
  }));
}

/**
 * Revenu mensuel par source d'acquisition x devise (12 derniers mois).
 * Pour le stacked bar chart.
 */
async function getMonthlyRevenue(appId, filters = {}) {
  const match = buildSubscriptionMatch(appId, filters);

  // Si pas de période fournie, on prend les 12 derniers mois
  if (!match.createdAt) {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
    twelveMonthsAgo.setDate(1);
    twelveMonthsAgo.setHours(0, 0, 0, 0);
    match.createdAt = { $gte: twelveMonthsAgo };
  }

  const result = await Subscription.aggregate([
    { $match: match },
    {
      $lookup: {
        from: 'commissions',
        let: { subId: '$_id', subAppId: '$appId' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$subscription', '$$subId'] },
                  { $eq: ['$appId', '$$subAppId'] },
                ],
              },
            },
          },
          { $limit: 1 },
          { $project: { _id: 1 } },
        ],
        as: 'commissionDoc',
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        as: 'userDoc',
      },
    },
    { $unwind: { path: '$userDoc', preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        effectiveSource: {
          $cond: [
            { $gt: [{ $size: '$commissionDoc' }, 0] },
            'affiliation',
            '$userDoc.acquisition.source',
          ],
        },
      },
    },
    {
      $group: {
        _id: {
          month: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          source: '$effectiveSource',
          currency: '$pricing.currency',
        },
        totalAmount: { $sum: '$pricing.amount' },
        count: { $sum: 1 },
      },
    },
    { $sort: { '_id.month': 1 } },
  ]);

  // Pivoter par mois : [{ month, currency, google_ads, organique, affiliation, untracked }]
  const byMonthCurrency = {};
  for (const row of result) {
    const key = `${row._id.month}|${row._id.currency || 'UNK'}`;
    if (!byMonthCurrency[key]) {
      byMonthCurrency[key] = {
        month: row._id.month,
        currency: row._id.currency || null,
        google_ads: 0,
        organique: 0,
        affiliation: 0,
        untracked: 0,
      };
    }
    const sourceKey = SOURCES.includes(row._id.source) ? row._id.source : 'untracked';
    byMonthCurrency[key][sourceKey] += row.totalAmount;
  }

  return Object.values(byMonthCurrency).sort((a, b) => {
    if (a.month !== b.month) return a.month.localeCompare(b.month);
    return (a.currency || '').localeCompare(b.currency || '');
  });
}

/**
 * Total des commissions dues aux affiliés sur la période. À soustraire du CA
 * brut pour obtenir le revenu net plateforme.
 *
 * Exclut les commissions `cancelled` (refund / fraude → ne seront pas payées).
 * Inclut available + locked + paid (toutes représentent un dû — pas forcément
 * encore décaissé, mais comptablement engagé).
 *
 * Filtre sur Commission.createdAt (qui mirror Subscription.createdAt vu que la
 * commission est créée au paiement réussi) pour rester cohérent avec les
 * revenus aggregés sur Subscription.createdAt.
 */
async function getTotalCommissions(appId, filters = {}) {
  const match = { status: { $ne: 'cancelled' } };
  if (appId && appId !== 'all') match.appId = appId;
  if (filters.startDate || filters.endDate) {
    match.createdAt = {};
    if (filters.startDate) match.createdAt.$gte = new Date(filters.startDate);
    if (filters.endDate) match.createdAt.$lt = new Date(filters.endDate);
  }

  const result = await Commission.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$currency',
        amount: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
  ]);

  const byCurrency = result.map((r) => ({
    currency: r._id,
    amount: r.amount,
    count: r.count,
  }));

  const totalXAF = byCurrency.reduce(
    (sum, r) => sum + convertToXAF(r.amount, r.currency),
    0
  );

  return {
    totalXAF,
    byCurrency,
    count: byCurrency.reduce((sum, r) => sum + r.count, 0),
  };
}

/**
 * Conversion du `revenue` (multi-devise) en agrégat XAF par source.
 * Permet d'afficher dans le dashboard les ventes du jour Pub vs Organique vs
 * Affiliation en une seule devise comparable, comme le `totalRevenueXAF` global.
 */
function buildRevenueXAF(revenue) {
  const out = {
    google_ads: { count: 0, amount: 0 },
    organique: { count: 0, amount: 0 },
    affiliation: { count: 0, amount: 0 },
    untracked: { count: 0, amount: 0 },
  };
  for (const row of revenue) {
    for (const src of ['google_ads', 'organique', 'affiliation', 'untracked']) {
      out[src].count += row[src]?.count || 0;
      out[src].amount += convertToXAF(row[src]?.amount || 0, row.currency);
    }
  }
  return out;
}

/**
 * Endpoint principal — retourne tous les agrégats d'un coup.
 */
async function getAcquisitionStats(appId, filters = {}) {
  const [users, revenue, monthly, commissions] = await Promise.all([
    getUsersBySource(appId, filters),
    getRevenueBySource(appId, filters),
    getMonthlyRevenue(appId, filters),
    getTotalCommissions(appId, filters),
  ]);

  const revenueXAF = buildRevenueXAF(revenue);

  return {
    users,
    revenue,
    revenueXAF,
    monthly,
    commissions,
  };
}

module.exports = {
  getAcquisitionStats,
};
