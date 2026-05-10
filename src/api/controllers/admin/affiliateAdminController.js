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

// Reset les coordonnées de retrait d'un affilié (admin force le reset)
exports.resetPayoutMethod = catchAsync(async (req, res) => {
  const appId = req.appId;
  const { userId } = req.params;
  const result = await affiliateAdminService.resetPayoutMethod(appId, userId);
  res.status(200).json({
    success: true,
    message: 'Coordonnées de retrait réinitialisées',
    data: { affiliate: result.affiliate },
  });
});

// Liste paginée des filleuls d'un affilié donné
exports.listAffiliateReferrals = catchAsync(async (req, res) => {
  const appId = req.appId;
  const { userId } = req.params;
  const { page = 1, limit = 20, q } = req.query;
  const result = await affiliateAdminService.listAffiliateReferrals(
    appId,
    userId,
    {
      page: parseInt(page, 10),
      limit: Math.min(parseInt(limit, 10), 100),
      q,
    }
  );
  res.status(200).json({ success: true, data: result });
});

// Liste paginée des commissions d'un affilié donné
exports.listAffiliateCommissions = catchAsync(async (req, res) => {
  const appId = req.appId;
  const { userId } = req.params;
  const { page = 1, limit = 20, status } = req.query;
  const result = await affiliateAdminService.listAffiliateCommissions(
    appId,
    userId,
    {
      page: parseInt(page, 10),
      limit: Math.min(parseInt(limit, 10), 100),
      status,
    }
  );
  res.status(200).json({ success: true, data: result });
});

// Liste paginée des PayoutRequests d'un affilié donné
exports.listAffiliatePayouts = catchAsync(async (req, res) => {
  const appId = req.appId;
  const { userId } = req.params;
  const { page = 1, limit = 20, status } = req.query;
  const result = await affiliateAdminService.listAffiliatePayouts(
    appId,
    userId,
    {
      page: parseInt(page, 10),
      limit: Math.min(parseInt(limit, 10), 100),
      status,
    }
  );
  res.status(200).json({ success: true, data: result });
});

// Vérifie le status d'une PayoutRequest auprès d'AfribaPay et réconcilie
// la BDD si AfribaPay confirme SUCCESS ou FAILED. Utile si le webhook
// AfribaPay ne vient pas (network glitch, NOTIFY_URL mal configuré, etc.).
exports.syncPayoutStatusFromAfribaPay = catchAsync(async (req, res) => {
  const appId = req.appId;
  const { payoutId } = req.params;
  const result = await affiliateAdminService.syncPayoutStatusFromAfribaPay(
    appId,
    payoutId,
    req.admin?._id
  );
  res.status(200).json({
    success: true,
    message: result.transient
      ? 'AfribaPay confirme que le virement est encore en cours.'
      : `Statut synchronisé : ${result.finalStatus}`,
    data: result,
  });
});

// Marque une PayoutRequest comme payée (validation manuelle admin)
exports.markPayoutPaid = catchAsync(async (req, res) => {
  const appId = req.appId;
  const { payoutId } = req.params;
  const { transferReference, note } = req.body || {};
  const result = await affiliateAdminService.markPayoutPaid(appId, payoutId, {
    adminId: req.admin?._id,
    transferReference,
    note,
  });
  res.status(200).json({
    success: true,
    message: 'Retrait marqué comme payé',
    data: result,
  });
});

// Rejette une PayoutRequest (numéro invalide, fraude, etc.)
exports.rejectPayout = catchAsync(async (req, res) => {
  const appId = req.appId;
  const { payoutId } = req.params;
  const { reason } = req.body || {};
  const result = await affiliateAdminService.rejectPayout(appId, payoutId, {
    adminId: req.admin?._id,
    reason,
  });
  res.status(200).json({
    success: true,
    message: 'Retrait rejeté — solde retourné dans le wallet de l\'affilié',
    data: result,
  });
});

// Liste des pays activables pour l'affiliation = AppConfig globale, filtrée
// sur paymentProvider=afribapay (puisque AfribaPay est notre processor de
// payouts). Permet à l'admin UI de proposer un dropdown des pays au lieu
// de saisir le code/devise à la main.
exports.listAvailableCountries = catchAsync(async (req, res) => {
  const AppConfig = require('../../models/common/AppConfig');
  const countries = await AppConfig.find({
    isActive: true,
    paymentProvider: 'afribapay',
    countryCode: { $ne: 'DEFAULT' },
  })
    .select('countryCode countryName currency phonePrefix')
    .sort({ countryName: 1 })
    .lean();
  res.status(200).json({
    success: true,
    data: countries.map((c) => ({
      code: c.countryCode,
      name: c.countryName,
      currency: c.currency,
      phonePrefix: c.phonePrefix,
    })),
  });
});
