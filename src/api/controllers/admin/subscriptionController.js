// src/api/controllers/admin/subscriptionController.js

const subscriptionManagementService = require('../../services/admin/subscriptionManagementService');
const catchAsync = require('../../../utils/catchAsync');

/**
 * Récupérer toutes les souscriptions avec filtres
 * GET /api/admin/subscriptions
 */
exports.getAllSubscriptions = catchAsync(async (req, res, next) => {
  // appId: query param prioritaire, sinon header
  const appId = req.query.appId ? req.query.appId : req.appId;

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
 * Statistiques des ventes
 * GET /api/admin/subscriptions/stats
 */
exports.getSubscriptionStats = catchAsync(async (req, res, next) => {
  const appId = req.query.appId ? req.query.appId : req.appId;

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
