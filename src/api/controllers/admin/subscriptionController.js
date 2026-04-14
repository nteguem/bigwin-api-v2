// src/api/controllers/admin/subscriptionController.js

const subscriptionManagementService = require('../../services/admin/subscriptionManagementService');
const catchAsync = require('../../../utils/catchAsync');
const { AppError } = require('../../../utils/AppError');

/**
 * Récupérer toutes les souscriptions avec filtres
 * GET /api/admin/subscriptions
 */
exports.getAllSubscriptions = catchAsync(async (req, res, next) => {
  // Seul super_admin peut cross-app. Sinon on force l'appId du header (validé par enforceAppScope).
  const isSuper = req.admin && req.admin.role === 'super_admin';
  const appId = isSuper ? (req.query.appId || req.appId) : req.appId;

  const filters = {
    startDate: req.query.startDate,
    endDate: req.query.endDate,
    paymentProvider: req.query.paymentProvider,
    status: req.query.status,
    search: req.query.search,
  };

  const options = {
    page: req.query.page || 1,
    limit: req.query.limit || 20,
    sortBy: req.query.sortBy || 'createdAt',
    sortOrder: req.query.sortOrder || 'desc',
  };

  const result = await subscriptionManagementService.getAllSubscriptions(appId, filters, options);

  res.status(200).json({
    success: true,
    data: {
      subscriptions: result.subscriptions,
      pagination: result.pagination,
    }
  });
});

/**
 * Créer une souscription manuellement (achat ou offre)
 * POST /api/admin/subscriptions
 */
exports.createSubscription = catchAsync(async (req, res, next) => {
  const appId = req.appId;
  const { userId, packageId, isGift } = req.body;

  if (!userId || !packageId) {
    return next(new AppError('userId et packageId sont requis', 400));
  }

  const result = await subscriptionManagementService.createAdminSubscription(appId, {
    userId,
    packageId,
    isGift: isGift === true,
  });

  res.status(201).json({
    success: true,
    message: isGift ? 'Offre créée avec succès' : 'Souscription créée avec succès',
    data: { subscription: result }
  });
});

/**
 * Statistiques des ventes
 * GET /api/admin/subscriptions/stats
 */
exports.getSubscriptionStats = catchAsync(async (req, res, next) => {
  const isSuper = req.admin && req.admin.role === 'super_admin';
  const appId = isSuper ? (req.query.appId || req.appId) : req.appId;

  const filters = {
    startDate: req.query.startDate,
    endDate: req.query.endDate,
    paymentProvider: req.query.paymentProvider,
    status: req.query.status,
  };

  const stats = await subscriptionManagementService.getSubscriptionStats(appId, filters);

  res.status(200).json({
    success: true,
    data: { stats }
  });
});
