// src/api/services/admin/acquisitionStatsService.js
//
// Stats d'acquisition utilisateurs : répartition google_ads vs organique
// (basée sur User.acquisition.source capturé via Play Install Referrer
// par le mobile au 1er run).
//
// Trois agrégats :
//   - users   : nombre d'utilisateurs par source
//   - revenue : revenu (somme Subscription.pricing.amount) par source x devise
//   - monthly : revenu mensuel par source x devise (12 derniers mois)

const User = require('../../models/user/User');
const Subscription = require('../../models/common/Subscription');

const SOURCES = ['google_ads', 'organique'];

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
 * Retourne aussi `untracked` = users créés avant le sprint (acquisition.source null).
 */
async function getUsersBySource(appId, filters = {}) {
  const match = buildUserMatch(appId, filters);

  const result = await User.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$acquisition.source',
        count: { $sum: 1 },
      }
    }
  ]);

  const out = { google_ads: 0, organique: 0, untracked: 0 };
  for (const row of result) {
    if (row._id === 'google_ads') out.google_ads = row.count;
    else if (row._id === 'organique') out.organique = row.count;
    else out.untracked += row.count; // null ou source inconnue
  }
  return out;
}

/**
 * Revenu par source d'acquisition x devise.
 * Join Subscription → User pour récupérer acquisition.source.
 */
async function getRevenueBySource(appId, filters = {}) {
  const match = buildSubscriptionMatch(appId, filters);

  const result = await Subscription.aggregate([
    { $match: match },
    {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        as: 'userDoc'
      }
    },
    { $unwind: { path: '$userDoc', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: {
          source: '$userDoc.acquisition.source',
          currency: '$pricing.currency'
        },
        count: { $sum: 1 },
        totalAmount: { $sum: '$pricing.amount' },
      }
    }
  ]);

  // Pivoter en { [currency]: { google_ads: {amount,count}, organique:..., untracked:... } }
  const byCurrency = {};
  for (const row of result) {
    const currency = row._id.currency;
    if (!currency) continue;
    if (!byCurrency[currency]) {
      byCurrency[currency] = {
        google_ads: { amount: 0, count: 0 },
        organique: { amount: 0, count: 0 },
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
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        as: 'userDoc'
      }
    },
    { $unwind: { path: '$userDoc', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: {
          month: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          source: '$userDoc.acquisition.source',
          currency: '$pricing.currency'
        },
        totalAmount: { $sum: '$pricing.amount' },
        count: { $sum: 1 },
      }
    },
    { $sort: { '_id.month': 1 } }
  ]);

  // Pivoter par mois : [{ month, currency, google_ads, organique, untracked }]
  const byMonthCurrency = {};
  for (const row of result) {
    const key = `${row._id.month}|${row._id.currency || 'UNK'}`;
    if (!byMonthCurrency[key]) {
      byMonthCurrency[key] = {
        month: row._id.month,
        currency: row._id.currency || null,
        google_ads: 0,
        organique: 0,
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
 * Endpoint principal — retourne tous les agrégats d'un coup.
 */
async function getAcquisitionStats(appId, filters = {}) {
  const [users, revenue, monthly] = await Promise.all([
    getUsersBySource(appId, filters),
    getRevenueBySource(appId, filters),
    getMonthlyRevenue(appId, filters),
  ]);

  return { users, revenue, monthly };
}

module.exports = {
  getAcquisitionStats,
};
