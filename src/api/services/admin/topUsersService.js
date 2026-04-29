// src/api/services/admin/topUsersService.js
//
// Identifie les meilleurs clients : ceux qui dépensent le plus, ceux qui
// achètent le plus souvent, ceux qui sont fidèles depuis longtemps.
// Sert à reconnaître la base de clients à valeur (~ 80/20 Pareto) et à
// décider d'actions ciblées (cadeaux, programmes VIP, relances).

const Subscription = require('../../models/common/Subscription');
const { convertToXAF } = require('./subscriptionManagementService');

function buildPeriodRange({ period, startDate, endDate }) {
  if (startDate || endDate) {
    return {
      start: startDate ? new Date(startDate) : null,
      end: endDate ? new Date(endDate) : null,
    };
  }
  const now = new Date();
  const end = new Date(now);
  const start = new Date(now);
  switch (period) {
    case 'day':
      start.setHours(0, 0, 0, 0);
      break;
    case 'week':
      start.setDate(start.getDate() - 7);
      break;
    case '30d':
      start.setDate(start.getDate() - 30);
      break;
    case '90d':
      start.setDate(start.getDate() - 90);
      break;
    case 'all':
    default:
      return { start: null, end: null };
  }
  return { start, end };
}

function buildMatch(appId, range) {
  const match = {};
  if (appId && appId !== 'all') match.appId = appId;
  if (range.start || range.end) {
    match.createdAt = {};
    if (range.start) match.createdAt.$gte = range.start;
    if (range.end) match.createdAt.$lt = range.end;
  }
  return match;
}

/**
 * Top users by spending (revenu cumulé converti en XAF).
 * Le calcul agrège côté JS car convertToXAF n'est pas disponible dans Mongo.
 * Acceptable car on travaille sur les souscriptions (volume modeste, pas
 * sur les events).
 */
async function getTopUsers({ appId, period = '30d', limit = 20, sortBy = 'revenue' }) {
  const range = buildPeriodRange({ period });
  const match = buildMatch(appId, range);

  // 1) Agrégation par user — somme/comptage par devise (Mongo gère bien).
  const byUserCurrency = await Subscription.aggregate([
    { $match: match },
    {
      $group: {
        _id: { user: '$user', currency: '$pricing.currency' },
        amount: { $sum: '$pricing.amount' },
        count: { $sum: 1 },
        firstAt: { $min: '$createdAt' },
        lastAt: { $max: '$createdAt' },
        appIds: { $addToSet: '$appId' },
      },
    },
  ]);

  // 2) Fusion par user (somme XAF + total achats + dates).
  const userMap = new Map();
  for (const row of byUserCurrency) {
    const userId = String(row._id.user);
    const xaf = convertToXAF(row.amount || 0, row._id.currency || 'XAF');
    const acc = userMap.get(userId) || {
      user: row._id.user,
      revenueXAF: 0,
      purchases: 0,
      firstAt: row.firstAt,
      lastAt: row.lastAt,
      appIds: new Set(),
    };
    acc.revenueXAF += xaf;
    acc.purchases += row.count;
    if (row.firstAt < acc.firstAt) acc.firstAt = row.firstAt;
    if (row.lastAt > acc.lastAt) acc.lastAt = row.lastAt;
    for (const a of row.appIds || []) acc.appIds.add(a);
    userMap.set(userId, acc);
  }

  // 3) Tri + slice avant le populate (évite de hydrater 10000 users).
  const all = Array.from(userMap.values());
  all.sort((a, b) => {
    if (sortBy === 'purchases') return b.purchases - a.purchases;
    return b.revenueXAF - a.revenueXAF;
  });
  const top = all.slice(0, limit);

  // 4) Populate manuel des users (un seul query batch).
  const User = require('mongoose').model('User');
  const userIds = top.map((t) => t.user);
  const userDocs = await User.find({ _id: { $in: userIds } })
    .select('phoneNumber email pseudo firstName lastName countryCode city createdAt')
    .lean();
  const usersById = new Map(userDocs.map((u) => [String(u._id), u]));

  return top.map((t) => {
    const u = usersById.get(String(t.user)) || {};
    return {
      userId: String(t.user),
      phoneNumber: u.phoneNumber || null,
      email: u.email || null,
      pseudo: u.pseudo || null,
      fullName: [u.firstName, u.lastName].filter(Boolean).join(' ') || null,
      countryCode: u.countryCode || null,
      city: u.city || null,
      memberSince: u.createdAt || null,
      revenueXAF: Math.round(t.revenueXAF),
      purchases: t.purchases,
      firstPurchaseAt: t.firstAt,
      lastPurchaseAt: t.lastAt,
      apps: Array.from(t.appIds),
    };
  });
}

module.exports = { getTopUsers };
