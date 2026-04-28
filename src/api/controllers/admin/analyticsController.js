// src/api/controllers/admin/analyticsController.js

const geoAnalyticsService = require('../../services/admin/geoAnalyticsService');
const transactionsAnalyticsService = require('../../services/admin/transactionsAnalyticsService');
const predictionsAnalyticsService = require('../../services/admin/predictionsAnalyticsService');
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
 * Mini-stat pronostics pour le dashboard (Win Rate 30j + volumes).
 * Léger, optimisé pour le chargement initial.
 */
exports.getPredictionsDashboardMini = catchAsync(async (req, res) => {
  const { appId } = req.query;
  const data = await predictionsAnalyticsService.getDashboardMini(appId || 'all');
  res.status(200).json({ success: true, data });
});
