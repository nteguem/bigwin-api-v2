// src/api/services/admin/affiliateAdminService.js
//
// Service admin pour la supervision affiliation. Couvre :
//   - Liste / détail des affiliés (User avec affiliate.isActive)
//   - Suspension / réactivation
//   - Liste / détail PayoutRequest
//   - Liste AdminFundingRequest (demandes awaiting_funds)
//   - Get / patch AffiliateConfig
//
// Les actions qui touchent AfribaPay (relance payout, validate funding,
// process queue) seront ajoutées en Phase 5 avec l'intégration du
// AfribaPayService. Pour Phase 1, on a juste les lectures + suspend.

const User = require('../../models/user/User');
const Referral = require('../../models/affiliate/Referral');
const Commission = require('../../models/affiliate/Commission');
const PayoutRequest = require('../../models/affiliate/PayoutRequest');
const AffiliateConfig = require('../../models/affiliate/AffiliateConfig');
const AdminFundingRequest = require('../../models/affiliate/AdminFundingRequest');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

class AffiliateAdminService {
  /**
   * Liste paginée des affiliés actifs d'une app, avec stats agrégées.
   */
  async listAffiliates(appId, { page = 1, limit = 20, country, suspended } = {}) {
    const filter = {
      appId,
      'affiliate.isActive': true,
    };
    if (country) filter['affiliate.country'] = country.toUpperCase();
    if (typeof suspended === 'boolean') filter['affiliate.suspended'] = suspended;

    const skip = (Math.max(1, page) - 1) * limit;
    const [items, total] = await Promise.all([
      User.find(filter)
        .select('pseudo email phoneNumber dialCode countryCode affiliate createdAt')
        .sort({ 'affiliate.activatedAt': -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    // Stats par affilié (dans une seule aggregation pour limiter les queries)
    const ids = items.map((u) => u._id);
    const stats = await Commission.aggregate([
      { $match: { appId, referrer: { $in: ids } } },
      {
        $group: {
          _id: { referrer: '$referrer', status: '$status' },
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]);

    // Index par userId pour merger
    const statsMap = {};
    for (const s of stats) {
      const uid = s._id.referrer.toString();
      statsMap[uid] = statsMap[uid] || {};
      statsMap[uid][s._id.status] = { amount: s.total, count: s.count };
    }

    return {
      items: items.map((u) => ({
        _id: u._id,
        pseudo: u.pseudo,
        email: u.email,
        phone: u.dialCode ? `${u.dialCode}${u.phoneNumber || ''}` : u.phoneNumber,
        countryCode: u.countryCode,
        affiliate: u.affiliate,
        createdAt: u.createdAt,
        stats: statsMap[u._id.toString()] || {},
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Détail d'un affilié + ses derniers filleuls + dernières commissions + payouts.
   */
  async getAffiliateDetail(appId, userId) {
    const user = await User.findOne({ _id: userId, appId })
      .select('pseudo email phoneNumber dialCode countryCode affiliate createdAt isActive')
      .lean();
    if (!user) {
      throw new AppError('Affilié introuvable', 404, ErrorCodes.NOT_FOUND);
    }
    if (!user.affiliate?.isActive) {
      throw new AppError(
        'Cet utilisateur n\'a pas activé son rôle affilié',
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    const [referrals, commissions, payouts, balanceAgg] = await Promise.all([
      Referral.find({ appId, referrer: userId })
        .populate('referee', 'pseudo countryCode createdAt')
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
      Commission.find({ appId, referrer: userId })
        .populate('referee', 'pseudo')
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
      PayoutRequest.find({ appId, user: userId })
        .sort({ requestedAt: -1 })
        .limit(20)
        .lean(),
      Commission.aggregate([
        { $match: { appId, referrer: user._id } },
        {
          $group: {
            _id: { status: '$status', currency: '$currency' },
            total: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    // Construit balance: { available: { XAF: { amount, count } }, locked: ..., paid: ..., cancelled: ... }
    const balance = {};
    for (const row of balanceAgg) {
      const { status, currency } = row._id;
      balance[status] = balance[status] || {};
      balance[status][currency] = { amount: row.total, count: row.count };
    }

    return { user, referrals, commissions, payouts, balance };
  }

  /**
   * Suspend un affilié : bloque les nouvelles commissions + payouts en attente.
   */
  async suspendAffiliate(appId, userId, reason, adminId) {
    const user = await User.findOne({ _id: userId, appId });
    if (!user || !user.affiliate?.isActive) {
      throw new AppError('Affilié introuvable', 404, ErrorCodes.NOT_FOUND);
    }
    user.affiliate.suspended = true;
    user.affiliate.suspendedReason = reason || 'Suspension admin';
    user.affiliate.suspendedAt = new Date();
    await user.save();
    return user;
  }

  async unsuspendAffiliate(appId, userId) {
    const user = await User.findOne({ _id: userId, appId });
    if (!user || !user.affiliate?.isActive) {
      throw new AppError('Affilié introuvable', 404, ErrorCodes.NOT_FOUND);
    }
    user.affiliate.suspended = false;
    user.affiliate.suspendedReason = undefined;
    user.affiliate.suspendedAt = undefined;
    await user.save();
    return user;
  }

  // ===== PAYOUT REQUESTS =====

  async listPayoutRequests(appId, { page = 1, limit = 20, status } = {}) {
    const filter = { appId };
    if (status) filter.status = status;

    const skip = (Math.max(1, page) - 1) * limit;
    const [items, total] = await Promise.all([
      PayoutRequest.find(filter)
        .populate('user', 'pseudo email phoneNumber dialCode')
        .sort({ requestedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      PayoutRequest.countDocuments(filter),
    ]);
    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getPayoutRequestDetail(appId, payoutId) {
    const payout = await PayoutRequest.findOne({ _id: payoutId, appId })
      .populate('user', 'pseudo email phoneNumber dialCode countryCode affiliate')
      .populate('commissionsIncluded')
      .lean();
    if (!payout) {
      throw new AppError('PayoutRequest introuvable', 404, ErrorCodes.NOT_FOUND);
    }
    return payout;
  }

  // ===== ADMIN FUNDING REQUESTS =====

  async listFundingRequests(appId, { page = 1, limit = 20, status = 'pending' } = {}) {
    const filter = { appId };
    if (status) filter.status = status;

    const skip = (Math.max(1, page) - 1) * limit;
    const [items, total] = await Promise.all([
      AdminFundingRequest.find(filter)
        .populate('user', 'pseudo email phoneNumber dialCode')
        .populate('payoutRequest')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AdminFundingRequest.countDocuments(filter),
    ]);
    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ===== CONFIG =====

  async getConfig(appId) {
    let config = await AffiliateConfig.findOne({ appId });
    if (!config) {
      // Création paresseuse
      config = await AffiliateConfig.create({
        appId,
        isEnabled: true,
        defaultTier: 'rookie',
        defaultCommissionRate: 15,
      });
    }
    return config;
  }

  async updateConfig(appId, patch) {
    const config = await AffiliateConfig.findOneAndUpdate(
      { appId },
      { $set: patch },
      { new: true, upsert: true, runValidators: true }
    );
    return config;
  }

  /**
   * Marque une PayoutRequest comme PAYÉE (validation manuelle admin
   * après virement effectif via AfribaPay/autre). Effets :
   *   - PayoutRequest.status passe à 'paid' + paidAt + audit trail
   *   - Toutes les Commissions liées passent de 'locked' à 'paid'
   *   - User.affiliate.activePayoutId est unset (l'affilié peut
   *     re-demander un retrait)
   *
   * @param {string} appId
   * @param {string} payoutId
   * @param {Object} adminInfo - { adminId, transferReference?, note? }
   */
  async markPayoutPaid(appId, payoutId, adminInfo = {}) {
    const pr = await PayoutRequest.findOne({ _id: payoutId, appId });
    if (!pr) {
      throw new AppError(
        'Demande de retrait introuvable.',
        404,
        ErrorCodes.NOT_FOUND
      );
    }
    if (pr.status !== 'queued' && pr.status !== 'awaiting_funds') {
      throw new AppError(
        `Impossible de valider une demande au statut "${pr.status}".`,
        400,
        ErrorCodes.OPERATION_NOT_ALLOWED
      );
    }

    const now = new Date();
    pr.status = 'paid';
    pr.paidAt = now;
    if (adminInfo.transferReference) {
      pr.afribaPayTransactionId = adminInfo.transferReference;
    }
    pr.attempts.push({
      at: now,
      type: 'admin_action',
      status: 'paid',
      actor: adminInfo.adminId ? String(adminInfo.adminId) : 'admin',
      payload: {
        action: 'mark_paid',
        transferReference: adminInfo.transferReference || null,
        note: adminInfo.note || null,
      },
    });
    await pr.save();

    // Commissions: locked → paid
    await Commission.updateMany(
      { _id: { $in: pr.commissionsIncluded }, status: 'locked' },
      { $set: { status: 'paid', paidAt: now } }
    );

    // Unlock User.affiliate.activePayoutId — l'affilié peut re-demander
    await User.findOneAndUpdate(
      { _id: pr.user, 'affiliate.activePayoutId': pr._id },
      { $unset: { 'affiliate.activePayoutId': '' } }
    );

    return pr;
  }

  /**
   * Rejette une PayoutRequest (numéro invalide, fraude soupçonnée,
   * etc.). Effets :
   *   - PayoutRequest.status → 'failed' + failureReason
   *   - Commissions liées repassent de 'locked' à 'available'
   *     (l'argent retourne dans le wallet de l'affilié)
   *   - User.activePayoutId unset → re-demande possible
   *
   * @param {string} appId
   * @param {string} payoutId
   * @param {Object} adminInfo - { adminId, reason }
   */
  async rejectPayout(appId, payoutId, adminInfo = {}) {
    if (!adminInfo.reason || !String(adminInfo.reason).trim()) {
      throw new AppError(
        'Une raison de rejet est requise.',
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }
    const pr = await PayoutRequest.findOne({ _id: payoutId, appId });
    if (!pr) {
      throw new AppError(
        'Demande de retrait introuvable.',
        404,
        ErrorCodes.NOT_FOUND
      );
    }
    if (pr.status !== 'queued' && pr.status !== 'awaiting_funds') {
      throw new AppError(
        `Impossible de rejeter une demande au statut "${pr.status}".`,
        400,
        ErrorCodes.OPERATION_NOT_ALLOWED
      );
    }

    const reason = String(adminInfo.reason).trim();
    const now = new Date();
    pr.status = 'failed';
    pr.failureReason = reason;
    pr.attempts.push({
      at: now,
      type: 'admin_action',
      status: 'failed',
      actor: adminInfo.adminId ? String(adminInfo.adminId) : 'admin',
      error: reason,
      payload: { action: 'reject', reason },
    });
    await pr.save();

    // Commissions: locked → available (retour dans le wallet)
    await Commission.updateMany(
      { _id: { $in: pr.commissionsIncluded }, status: 'locked' },
      { $set: { status: 'available' }, $unset: { payoutRequest: '' } }
    );

    // Unlock User
    await User.findOneAndUpdate(
      { _id: pr.user, 'affiliate.activePayoutId': pr._id },
      { $unset: { 'affiliate.activePayoutId': '' } }
    );

    return pr;
  }
}

module.exports = new AffiliateAdminService();
