const admobService = require('../../services/admin/admobService');
const catchAsync = require('../../../utils/catchAsync');

exports.getStats = catchAsync(async (req, res) => {
  const [stats, byApp] = await Promise.all([
    admobService.getAdmobDashboardStats(),
    admobService.getAdmobStatsByApp(),
  ]);

  res.status(200).json({
    success: true,
    data: { stats, byApp },
  });
});
