const admobService = require('../../services/admin/admobService');
const catchAsync = require('../../../utils/catchAsync');

exports.getStats = catchAsync(async (req, res) => {
  const stats = await admobService.getAdmobDashboardStats();

  res.status(200).json({
    success: true,
    data: { stats },
  });
});
