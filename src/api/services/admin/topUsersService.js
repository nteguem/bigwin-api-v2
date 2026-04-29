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

/**
 * Détails d'un user pour la modal latérale du Top Clients :
 *   - infos profil
 *   - liste des apps où il a un compte (par phoneNumber/email — un même
 *     numéro peut avoir un User dans plusieurs apps de la galaxie)
 *   - historique complet des souscriptions (package, montant, devise, dates)
 */
async function getUserDetails(userId) {
  const mongoose = require('mongoose');
  const User = mongoose.model('User');
  const App = mongoose.model('App');

  const user = await User.findById(userId).lean();
  if (!user) return null;

  // Comptes liés : autres User docs avec même phoneNumber ou email
  // (la galaxie d'apps utilise des Users séparés par appId).
  const linkedQuery = { $or: [] };
  if (user.phoneNumber) linkedQuery.$or.push({ phoneNumber: user.phoneNumber });
  if (user.email) linkedQuery.$or.push({ email: user.email });
  const linkedAccounts = linkedQuery.$or.length > 0
    ? await User.find(linkedQuery)
        .select('_id appId pseudo phoneNumber email createdAt')
        .lean()
    : [user];

  const linkedUserIds = linkedAccounts.map((u) => u._id);
  const linkedAppIds = [...new Set(linkedAccounts.map((u) => u.appId))];

  // Apps : displayName + branding pour rendu visuel
  const appDocs = await App.find({ appId: { $in: linkedAppIds } })
    .select('appId displayName branding')
    .lean();
  const appById = new Map(appDocs.map((a) => [a.appId, a]));

  // Souscriptions de TOUS les comptes liés (pas seulement le user cliqué).
  // ATTENTION : on utilise aggregate pour bypasser le hook pre('find') du
  // modèle Subscription, qui filtre automatiquement les expirées (endDate > now).
  // Ici on veut TOUT l'historique, expirées comprises.
  const Package = require('mongoose').model('Package');
  const subscriptions = await Subscription.aggregate([
    { $match: { user: { $in: linkedUserIds } } },
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'packages',
        localField: 'package',
        foreignField: '_id',
        as: 'packageDoc',
      },
    },
    { $unwind: { path: '$packageDoc', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        as: 'userDoc',
      },
    },
    { $unwind: { path: '$userDoc', preserveNullAndEmptyArrays: true } },
  ]);
  void Package; // require préchargé pour s'assurer que le modèle est enregistré

  const totalRevenueXAF = subscriptions.reduce(
    (sum, s) => sum + convertToXAF(s.pricing?.amount || 0, s.pricing?.currency || 'XAF'),
    0
  );

  return {
    user: {
      _id: user._id,
      phoneNumber: user.phoneNumber,
      email: user.email,
      pseudo: user.pseudo,
      firstName: user.firstName,
      lastName: user.lastName,
      countryCode: user.countryCode,
      city: user.city,
      authProvider: user.authProvider,
      createdAt: user.createdAt,
    },
    apps: linkedAccounts.map((acc) => {
      const app = appById.get(acc.appId);
      const appName = typeof app?.displayName === 'object'
        ? (app.displayName.fr || app.displayName.en)
        : app?.displayName;
      return {
        userId: String(acc._id),
        appId: acc.appId,
        appName: appName || acc.appId,
        appIcon: app?.branding?.icon || null,
        appColor: app?.branding?.primaryColor || null,
        pseudo: acc.pseudo,
        memberSince: acc.createdAt,
      };
    }),
    subscriptions: subscriptions.map((s) => {
      // package.name peut être un objet i18n { fr, en } ou une string
      let packageName = s.packageDoc?.name;
      if (packageName && typeof packageName === 'object') {
        packageName = packageName.fr || packageName.en || Object.values(packageName)[0];
      }
      return {
        _id: String(s._id),
        appId: s.userDoc?.appId || null,
        packageName: packageName || 'Package supprimé',
        amount: s.pricing?.amount || 0,
        currency: s.pricing?.currency || 'XAF',
        amountXAF: convertToXAF(s.pricing?.amount || 0, s.pricing?.currency || 'XAF'),
        provider: s.paymentProvider,
        status: s.status,
        isGift: s.isGift || false,
        startDate: s.startDate,
        endDate: s.endDate,
        createdAt: s.createdAt,
      };
    }),
    totals: {
      revenueXAF: Math.round(totalRevenueXAF),
      purchasesCount: subscriptions.length,
      appsCount: linkedAccounts.length,
    },
  };
}

/**
 * Candidats à relancer (win-back) : clients qui ont dépensé sur les 90 derniers
 * jours mais qui n'ont AUCUN forfait actif au moment du calcul.
 *
 * Logique :
 *   1) Identifier les users avec ≥ 1 souscription dans les N derniers jours
 *   2) Filtrer ceux qui n'ont aucune souscription dont endDate > now
 *   3) Trier par revenu cumulé (Pareto — relancer d'abord les gros)
 *
 * Tous les calculs passent par aggregate pour bypasser le hook pre('find')
 * qui filtre automatiquement les expirées.
 */
async function getWinbackCandidates({ appId, lookbackDays = 90, limit = 10 }) {
  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);

  const match = { createdAt: { $gte: since } };
  if (appId && appId !== 'all') match.appId = appId;

  // 1) Tous les users qui ont acheté dans la fenêtre
  const recentBuyers = await Subscription.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$user',
        revenueByCurrency: { $push: { amount: '$pricing.amount', currency: '$pricing.currency' } },
        purchases: { $sum: 1 },
        firstAt: { $min: '$createdAt' },
        lastAt: { $max: '$createdAt' },
        appIds: { $addToSet: '$appId' },
      },
    },
  ]);

  if (recentBuyers.length === 0) return [];

  // 2) Pour chaque user, vérifier s'il a au moins une souscription active
  const userIds = recentBuyers.map((u) => u._id);
  const now = new Date();
  const activeUsers = await Subscription.aggregate([
    {
      $match: {
        user: { $in: userIds },
        status: 'active',
        endDate: { $gt: now },
      },
    },
    { $group: { _id: '$user' } },
  ]);
  const activeUserIds = new Set(activeUsers.map((u) => String(u._id)));

  // 3) Garder uniquement les churners (avec calcul du revenu XAF)
  const churners = recentBuyers
    .filter((u) => !activeUserIds.has(String(u._id)))
    .map((u) => {
      let revenueXAF = 0;
      for (const r of u.revenueByCurrency) {
        revenueXAF += convertToXAF(r.amount || 0, r.currency || 'XAF');
      }
      return {
        userId: u._id,
        revenueXAF: Math.round(revenueXAF),
        purchases: u.purchases,
        firstPurchaseAt: u.firstAt,
        lastPurchaseAt: u.lastAt,
        appIds: u.appIds,
        daysSinceLastPurchase: Math.floor((Date.now() - u.lastAt.getTime()) / (1000 * 60 * 60 * 24)),
      };
    });

  // 4) Trier par revenu cumulé décroissant + slice
  churners.sort((a, b) => b.revenueXAF - a.revenueXAF);
  const top = churners.slice(0, limit);

  // 5) Hydrater les profils utilisateurs
  const User = require('mongoose').model('User');
  const userDocs = await User.find({ _id: { $in: top.map((t) => t.userId) } })
    .select('phoneNumber email pseudo firstName lastName countryCode city createdAt')
    .lean();
  const usersById = new Map(userDocs.map((u) => [String(u._id), u]));

  return top.map((t) => {
    const u = usersById.get(String(t.userId)) || {};
    return {
      userId: String(t.userId),
      phoneNumber: u.phoneNumber || null,
      email: u.email || null,
      pseudo: u.pseudo || null,
      fullName: [u.firstName, u.lastName].filter(Boolean).join(' ') || null,
      countryCode: u.countryCode || null,
      city: u.city || null,
      memberSince: u.createdAt || null,
      revenueXAF: t.revenueXAF,
      purchases: t.purchases,
      firstPurchaseAt: t.firstPurchaseAt,
      lastPurchaseAt: t.lastPurchaseAt,
      daysSinceLastPurchase: t.daysSinceLastPurchase,
      apps: t.appIds,
    };
  });
}

module.exports = { getTopUsers, getUserDetails, getWinbackCandidates };
