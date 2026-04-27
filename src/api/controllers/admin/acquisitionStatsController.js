// src/api/controllers/admin/acquisitionStatsController.js

const acquisitionStatsService = require('../../services/admin/acquisitionStatsService');
const catchAsync = require('../../../utils/catchAsync');

exports.getStats = catchAsync(async (req, res) => {
  const { appId, startDate, endDate } = req.query;
  const stats = await acquisitionStatsService.getAcquisitionStats(
    appId || 'all',
    { startDate, endDate }
  );

  res.status(200).json({
    success: true,
    data: stats,
  });
});
