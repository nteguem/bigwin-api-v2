// src/api/controllers/admin/analyticsController.js

const geoAnalyticsService = require('../../services/admin/geoAnalyticsService');
const transactionsAnalyticsService = require('../../services/admin/transactionsAnalyticsService');
const predictionsAnalyticsService = require('../../services/admin/predictionsAnalyticsService');
const topUsersService = require('../../services/admin/topUsersService');
const subscriptionManagementService = require('../../services/admin/subscriptionManagementService');
const Package = require('../../models/common/Package');
const catchAsync = require('../../../utils/catchAsync');

exports.getGeo = catchAsync(async (req, res) => {
  const { appId, period, startDate, endDate, limit } = req.query;
  const data = await geoAnalyticsService.getGeoAnalytics({
    appId: appId || 'all',
    period: period || 'month',
    startDate,
    endDate,
    limit: limit ? parseInt(limit, 10) : 10,
  });

  res.status(200).json({ success: true, data });
});

exports.getTransactions = catchAsync(async (req, res) => {
  const { appId, period, startDate, endDate, limit } = req.query;
  const data = await transactionsAnalyticsService.getTransactionsAnalytics({
    appId: appId || 'all',
    period: period || 'month',
    startDate,
    endDate,
    limit: limit ? parseInt(limit, 10) : 10,
  });

  res.status(200).json({ success: true, data });
});

exports.getPredictions = catchAsync(async (req, res) => {
  const { appId, period, startDate, endDate, limit } = req.query;
  const data = await predictionsAnalyticsService.getPredictionsAnalytics({
    appId: appId || 'all',
    period: period || 'month',
    startDate,
    endDate,
    limit: limit ? parseInt(limit, 10) : 10,
  });
  res.status(200).json({ success: true, data });
});

/**
 * Mini-stat pronostics pour le dashboard (taux de réussite 10j pronos + tickets).
 * Léger, optimisé pour le chargement initial.
 */
exports.getPredictionsDashboardMini = catchAsync(async (req, res) => {
  const { appId } = req.query;
  const data = await predictionsAnalyticsService.getDashboardMini(appId || 'all');
  res.status(200).json({ success: true, data });
});

/**
 * Top users — meilleurs clients par revenu ou nombre d'achats.
 * Période par défaut : 30 derniers jours.
 */
exports.getTopUsers = catchAsync(async (req, res) => {
  const { appId, period, limit, sortBy } = req.query;
  const data = await topUsersService.getTopUsers({
    appId: appId || 'all',
    period: period || '30d',
    limit: limit ? parseInt(limit, 10) : 20,
    sortBy: sortBy || 'revenue',
  });
  res.status(200).json({ success: true, data });
});

/**
 * Détails d'un client pour la modal latérale (Top Clients).
 * Renvoie : profil + apps liées (multi-app via téléphone/email) + souscriptions.
 */
exports.getUserDetails = catchAsync(async (req, res) => {
  const { userId } = req.params;
  const data = await topUsersService.getUserDetails(userId);
  if (!data) {
    return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
  }
  res.status(200).json({ success: true, data });
});

/**
 * Candidats à relancer : top N clients qui ont dépensé sur 90j mais n'ont
 * plus de forfait actif.
 */
exports.getWinbackCandidates = catchAsync(async (req, res) => {
  const { appId, limit, lookbackDays } = req.query;
  const data = await topUsersService.getWinbackCandidates({
    appId: appId || 'all',
    limit: limit ? parseInt(limit, 10) : 10,
    lookbackDays: lookbackDays ? parseInt(lookbackDays, 10) : 90,
  });
  res.status(200).json({ success: true, data });
});

/**
 * Liste des packages disponibles pour une app (pour le formulaire d'offre).
 * Renvoie aussi les packages 'shared' qui sont disponibles partout.
 */
exports.getPackagesByApp = catchAsync(async (req, res) => {
  const { appId } = req.params;
  const packages = await Package.find({
    appId: { $in: [appId, 'shared'] },
    isActive: true,
  })
    .select('name description duration pricing appId')
    .sort({ duration: 1 })
    .lean();

  // Normaliser les noms i18n pour éviter de renvoyer des objets bruts
  const normalized = packages.map((p) => {
    const pickFr = (v) => (v && typeof v === 'object') ? (v.fr || v.en || Object.values(v)[0]) : v;
    return {
      _id: String(p._id),
      appId: p.appId,
      name: pickFr(p.name) || 'Package',
      description: pickFr(p.description) || '',
      duration: p.duration,
      pricing: p.pricing,
    };
  });

  res.status(200).json({ success: true, data: normalized });
});

/**
 * Offrir un forfait fidélité à un client — variante de createAdminSubscription
 * avec une notification galvanisante personnalisée (au lieu de la notif
 * cadeau standard). Sert à relancer un client churné ou récompenser un fidèle.
 */
exports.giveLoyaltyGift = catchAsync(async (req, res) => {
  const { userId } = req.params;
  const { appId, packageId, customMessageFr, customMessageEn } = req.body;

  if (!appId || !packageId) {
    return res.status(400).json({
      success: false,
      message: 'appId et packageId sont requis',
    });
  }

  const subscription = await subscriptionManagementService.createAdminSubscription(appId, {
    userId,
    packageId,
    isGift: true,
    loyaltyOptions: {
      customMessageFr: customMessageFr || null,
      customMessageEn: customMessageEn || null,
    },
  });

  res.status(201).json({
    success: true,
    message: 'Forfait fidélité offert avec succès',
    data: {
      subscriptionId: String(subscription._id),
      endDate: subscription.endDate,
    },
  });
});
