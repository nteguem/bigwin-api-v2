// src/api/services/admin/predictionsAnalyticsService.js
//
// Analytics pronostics : qualité du produit cœur (taux de réussite,
// volume, performance par sport/catégorie). C'est LE KPI central de la
// plateforme — si le win rate baisse, tout le reste s'effondre.

const Prediction = require('../../models/common/Prediction');
const Ticket = require('../../models/common/Ticket');

// Statut d'un ticket dérivé de l'ensemble de ses prédictions :
// - won : toutes les preds décidées sont 'won' (au moins 1 décidée)
// - lost : au moins 1 pred 'lost' parmi les decidées
// - pending : reste des preds 'pending' et aucune perdue
// - void : seulement des 'void' (cas marginal — ticket annulé)
function deriveTicketStatus(preds) {
  let pending = 0, won = 0, lost = 0, voidCount = 0;
  for (const p of preds) {
    if (p.status === 'pending') pending++;
    else if (p.status === 'won') won++;
    else if (p.status === 'lost') lost++;
    else if (p.status === 'void') voidCount++;
  }
  if (lost > 0) return 'lost';
  if (pending > 0) return 'pending';
  if (won > 0) return 'won';
  if (voidCount > 0) return 'void';
  return 'pending';
}

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
    case '10d':
      start.setDate(start.getDate() - 10);
      break;
    case 'month':
    default:
      start.setDate(start.getDate() - 30);
      break;
  }
  return { start, end };
}

function buildPredictionMatch(appId, range) {
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
 * Compute Win Rate sur un set de prédictions.
 * Win Rate = won / (won + lost) — on ignore pending et void volontairement
 * pour ne mesurer que les paris décidés.
 */
function computeWinRate(stats) {
  const decided = (stats.won || 0) + (stats.lost || 0);
  return decided > 0 ? ((stats.won || 0) / decided) * 100 : 0;
}

/**
 * Stats globales pronostics (KPIs principaux).
 */
async function getGlobalStats(appId, range) {
  const result = await Prediction.aggregate([
    { $match: buildPredictionMatch(appId, range) },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        avgOdds: { $avg: '$odds' },
      },
    },
  ]);

  const stats = { total: 0, pending: 0, won: 0, lost: 0, void: 0, avgOdds: 0 };
  let oddsSum = 0;
  let oddsCount = 0;
  for (const row of result) {
    const status = row._id || 'pending';
    stats[status] = row.count;
    stats.total += row.count;
    if (row.avgOdds) {
      oddsSum += row.avgOdds * row.count;
      oddsCount += row.count;
    }
  }
  stats.avgOdds = oddsCount > 0 ? oddsSum / oddsCount : 0;
  stats.winRate = computeWinRate(stats);

  // ROI théorique : si tu pariais 1 unité sur chaque prono,
  // (winRate × avgOdds) - 1 = profit en %
  // Ex: winRate=70%, avgOdds=1.8 → ROI = 0.7 × 1.8 - 1 = 26%
  const decided = stats.won + stats.lost;
  stats.theoreticalRoi = decided > 0 ? ((stats.won / decided) * stats.avgOdds - 1) * 100 : 0;

  return stats;
}

/**
 * Win Rate par sport.
 * Filtre les sports avec >= 5 pronos décidés (statistiquement fiable).
 */
async function getStatsBySport(appId, range, limit = 10) {
  const result = await Prediction.aggregate([
    { $match: buildPredictionMatch(appId, range) },
    {
      $group: {
        _id: { sportId: '$sport.id', sportName: '$sport.name' },
        total: { $sum: 1 },
        pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
        won: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } },
        lost: { $sum: { $cond: [{ $eq: ['$status', 'lost'] }, 1, 0] } },
        voidCount: { $sum: { $cond: [{ $eq: ['$status', 'void'] }, 1, 0] } },
        avgOdds: { $avg: '$odds' },
      },
    },
  ]);

  return result
    .map((r) => {
      const won = r.won || 0;
      const lost = r.lost || 0;
      const decided = won + lost;
      return {
        sportId: r._id?.sportId || null,
        sportName: r._id?.sportName || 'Inconnu',
        total: r.total,
        pending: r.pending,
        won,
        lost,
        void: r.voidCount,
        winRate: decided > 0 ? (won / decided) * 100 : 0,
        avgOdds: r.avgOdds || 0,
      };
    })
    .filter((r) => (r.won + r.lost) >= 5)
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, limit);
}

/**
 * Win Rate par catégorie de ticket (Coupons gratuits, VIP, etc.).
 * Joine Prediction → Ticket → Category pour récupérer le nom de catégorie.
 */
async function getStatsByCategory(appId, range, limit = 10) {
  const result = await Prediction.aggregate([
    { $match: buildPredictionMatch(appId, range) },
    {
      $lookup: {
        from: 'tickets',
        localField: 'ticket',
        foreignField: '_id',
        as: 'ticketDoc',
      },
    },
    { $unwind: { path: '$ticketDoc', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'categories',
        localField: 'ticketDoc.category',
        foreignField: '_id',
        as: 'categoryDoc',
      },
    },
    { $unwind: { path: '$categoryDoc', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: { catId: '$categoryDoc._id', catName: '$categoryDoc.name' },
        total: { $sum: 1 },
        pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
        won: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } },
        lost: { $sum: { $cond: [{ $eq: ['$status', 'lost'] }, 1, 0] } },
        voidCount: { $sum: { $cond: [{ $eq: ['$status', 'void'] }, 1, 0] } },
        avgOdds: { $avg: '$odds' },
      },
    },
  ]);

  return result
    .map((r) => {
      const won = r.won || 0;
      const lost = r.lost || 0;
      const decided = won + lost;
      // Le nom de catégorie peut être un sous-doc multilingue (i18n)
      let catName = r._id?.catName;
      if (catName && typeof catName === 'object') {
        catName = catName.fr || catName.en || Object.values(catName)[0] || 'Inconnu';
      }
      return {
        categoryId: r._id?.catId || null,
        categoryName: catName || 'Inconnu',
        total: r.total,
        pending: r.pending,
        won,
        lost,
        void: r.voidCount,
        winRate: decided > 0 ? (won / decided) * 100 : 0,
        avgOdds: r.avgOdds || 0,
      };
    })
    .filter((r) => (r.won + r.lost) >= 3)
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, limit);
}

/**
 * Stats au niveau TICKET (coupon) — c'est ce que le client vit réellement.
 * Un ticket gagne uniquement si TOUS ses pronos sont gagnés. Une seule perte
 * fait perdre tout le coupon, même si le pronostiqueur avait raison sur 4/5.
 *
 * On agrège par ticket via $group, puis on dérive le statut côté Mongo
 * directement (logique en SQL aurait été plus lisible mais $group fait l'affaire).
 */
async function getTicketsStats(appId, range) {
  const result = await Prediction.aggregate([
    { $match: buildPredictionMatch(appId, range) },
    {
      $group: {
        _id: '$ticket',
        statuses: { $push: '$status' },
      },
    },
  ]);

  const stats = { total: 0, pending: 0, won: 0, lost: 0, void: 0 };
  for (const row of result) {
    const status = deriveTicketStatus(row.statuses.map((s) => ({ status: s })));
    stats[status] = (stats[status] || 0) + 1;
    stats.total += 1;
  }
  const decided = stats.won + stats.lost;
  stats.successRate = decided > 0 ? (stats.won / decided) * 100 : 0;
  stats.decided = decided;
  return stats;
}

/**
 * Volume de pronos par jour (pour repérer les pics et les jours creux).
 */
async function getDailyVolume(appId, range) {
  const result = await Prediction.aggregate([
    { $match: buildPredictionMatch(appId, range) },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        total: { $sum: 1 },
        won: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } },
        lost: { $sum: { $cond: [{ $eq: ['$status', 'lost'] }, 1, 0] } },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return result.map((r) => ({
    date: r._id,
    total: r.total,
    won: r.won,
    lost: r.lost,
    winRate: r.won + r.lost > 0 ? (r.won / (r.won + r.lost)) * 100 : 0,
  }));
}

/**
 * Endpoint principal.
 */
async function getPredictionsAnalytics({ appId, period, startDate, endDate, limit = 10 }) {
  const range = buildPeriodRange({ period, startDate, endDate });

  const [global, tickets, bySport, byCategory, dailyVolume] = await Promise.all([
    getGlobalStats(appId, range),
    getTicketsStats(appId, range),
    getStatsBySport(appId, range, limit),
    getStatsByCategory(appId, range, limit),
    getDailyVolume(appId, range),
  ]);

  return {
    period: { start: range.start, end: range.end },
    global,
    tickets,
    bySport,
    byCategory,
    dailyVolume,
  };
}

/**
 * Mini-stat pour le dashboard : Win Rate sur 10 derniers jours.
 * Fenêtre courte = sensible aux récentes performances. 30j est trop long
 * pour repérer une dérive ; 7j n'a pas assez de volume sur certaines apps.
 */
async function getDashboardMini(appId) {
  const range = buildPeriodRange({ period: '10d' });
  const [stats, tickets] = await Promise.all([
    getGlobalStats(appId, range),
    getTicketsStats(appId, range),
  ]);
  return {
    period: '10d',
    predictions: {
      successRate: stats.winRate,
      decided: stats.won + stats.lost,
      won: stats.won,
      lost: stats.lost,
    },
    tickets: {
      successRate: tickets.successRate,
      decided: tickets.decided,
      won: tickets.won,
      lost: tickets.lost,
    },
  };
}

module.exports = {
  getPredictionsAnalytics,
  getDashboardMini,
};
