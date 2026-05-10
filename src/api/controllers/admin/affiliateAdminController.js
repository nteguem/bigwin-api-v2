// src/api/controllers/admin/affiliateAdminController.js
//
// Controllers admin pour la section Affiliation du backoffice bigwin-admin.
// Auth admin requise (via adminAuth.protect dans les routes).

const affiliateAdminService = require('../../services/admin/affiliateAdminService');
const catchAsync = require('../../../utils/catchAsync');

// ===== AFFILIATES =====

exports.listAffiliates = catchAsync(async (req, res) => {
  const appId = req.appId;
  const { page = 1, limit = 20, country, suspended } = req.query;
  const result = await affiliateAdminService.listAffiliates(appId, {
    page: parseInt(page, 10),
    limit: Math.min(parseInt(limit, 10), 100),
    country,
    suspended: suspended === 'true' ? true : suspended === 'false' ? false : undefined,
  });
  res.status(200).json({ success: true, data: result });
});

exports.getAffiliate = catchAsync(async (req, res) => {
  const appId = req.appId;
  const { userId } = req.params;
  const result = await affiliateAdminService.getAffiliateDetail(appId, userId);
  res.status(200).json({ success: true, data: result });
});

exports.suspendAffiliate = catchAsync(async (req, res) => {
  const appId = req.appId;
  const { userId } = req.params;
  const { reason } = req.body || {};
  const user = await affiliateAdminService.suspendAffiliate(
    appId,
    userId,
    reason,
    req.admin?._id
  );
  res.status(200).json({
    success: true,
    message: 'Affilié suspendu',
    data: { affiliate: user.affiliate },
  });
});

exports.unsuspendAffiliate = catchAsync(async (req, res) => {
  const appId = req.appId;
  const { userId } = req.params;
  const user = await affiliateAdminService.unsuspendAffiliate(appId, userId);
  res.status(200).json({
    success: true,
    message: 'Affilié réactivé',
    data: { affiliate: user.affiliate },
  });
});

// ===== PAYOUT REQUESTS =====

exports.listPayoutRequests = catchAsync(async (req, res) => {
  const appId = req.appId;
  const { page = 1, limit = 20, status } = req.query;
  const result = await affiliateAdminService.listPayoutRequests(appId, {
    page: parseInt(page, 10),
    limit: Math.min(parseInt(limit, 10), 100),
    status,
  });
  res.status(200).json({ success: true, data: result });
});

exports.getPayoutRequest = catchAsync(async (req, res) => {
  const appId = req.appId;
  const { payoutId } = req.params;
  const result = await affiliateAdminService.getPayoutRequestDetail(appId, payoutId);
  res.status(200).json({ success: true, data: result });
});

// ===== ADMIN FUNDING REQUESTS =====

exports.listFundingRequests = catchAsync(async (req, res) => {
  const appId = req.appId;
  const { page = 1, limit = 20, status = 'pending' } = req.query;
  const result = await affiliateAdminService.listFundingRequests(appId, {
    page: parseInt(page, 10),
    limit: Math.min(parseInt(limit, 10), 100),
    status,
  });
  res.status(200).json({ success: true, data: result });
});

// ===== CONFIG =====

exports.getConfig = catchAsync(async (req, res) => {
  const appId = req.appId;
  const config = await affiliateAdminService.getConfig(appId);
  res.status(200).json({ success: true, data: config });
});

exports.updateConfig = catchAsync(async (req, res) => {
  const appId = req.appId;
  const patch = req.body || {};
  const config = await affiliateAdminService.updateConfig(appId, patch);
  res.status(200).json({
    success: true,
    message: 'Configuration affiliation mise à jour',
    data: config,
  });
});
