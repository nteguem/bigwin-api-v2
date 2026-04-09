const installStatsService = require('../../services/admin/installStatsService');
const catchAsync = require('../../../utils/catchAsync');

exports.getStats = catchAsync(async (req, res) => {
  const stats = await installStatsService.getInstallStats();

  res.status(200).json({
    success: true,
    data: stats,
  });
});
