const admobService = require('../../services/admin/admobService');
const catchAsync = require('../../../utils/catchAsync');

exports.getStats = catchAsync(async (req, res) => {
  const dateParam = req.query.date || null; // format YYYY-MM-DD
  const [stats, byApp] = await Promise.all([
    admobService.getAdmobDashboardStats(dateParam),
    admobService.getAdmobStatsByApp(dateParam),
  ]);

  res.status(200).json({
    success: true,
    data: { stats, byApp },
  });
});
