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
const afribaPayPayoutService = require('./afribaPayPayoutService');
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

  /**
   * Reset les coordonnées de retrait d'un affilié (operator + phoneNumber).
   * Cas d'usage : numéro saisi à la 1ère demande était erroné, ou l'affilié
   * a changé de numéro mobile money. Au prochain retrait, on lui redemande.
   */
  async resetPayoutMethod(appId, userId) {
    const user = await User.findOne({ _id: userId, appId });
    if (!user || !user.affiliate?.isActive) {
      throw new AppError('Affilié introuvable', 404, ErrorCodes.NOT_FOUND);
    }
    user.affiliate.payoutMethod = undefined;
    await user.save();
    return user;
  }

  /**
   * Liste paginée des filleuls d'un affilié, recherche par
   * pseudo/firstName/lastName/email/phoneNumber du filleul.
   */
  async listAffiliateReferrals(appId, userId, { page = 1, limit = 20, q } = {}) {
    const baseFilter = { appId, referrer: userId };

    if (q && q.trim()) {
      const escaped = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rgx = new RegExp(escaped, 'i');
      const matchingUsers = await User.find({
        appId,
        $or: [
          { pseudo: rgx },
          { firstName: rgx },
          { lastName: rgx },
          { email: rgx },
          { phoneNumber: rgx },
        ],
      }).select('_id').lean();
      const ids = matchingUsers.map((u) => u._id);
      if (ids.length === 0) {
        return { items: [], pagination: { page, limit, total: 0, totalPages: 0 } };
      }
      baseFilter.referee = { $in: ids };
    }

    const skip = (Math.max(1, page) - 1) * limit;
    const [items, total] = await Promise.all([
      Referral.find(baseFilter)
        .populate('referee', 'pseudo email phoneNumber countryCode createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Referral.countDocuments(baseFilter),
    ]);

    return {
      items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Liste paginée des commissions d'un affilié, filtrable par status.
   */
  async listAffiliateCommissions(appId, userId, { page = 1, limit = 20, status } = {}) {
    const filter = { appId, referrer: userId };
    if (status) filter.status = status;
    const skip = (Math.max(1, page) - 1) * limit;
    const [items, total] = await Promise.all([
      Commission.find(filter)
        .populate('referee', 'pseudo')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Commission.countDocuments(filter),
    ]);
    return {
      items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Liste paginée des PayoutRequest d'un affilié, filtrable par status.
   */
  async listAffiliatePayouts(appId, userId, { page = 1, limit = 20, status } = {}) {
    const filter = { appId, user: userId };
    if (status) filter.status = status;
    const skip = (Math.max(1, page) - 1) * limit;
    const [items, total] = await Promise.all([
      PayoutRequest.find(filter)
        .sort({ requestedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      PayoutRequest.countDocuments(filter),
    ]);
    return {
      items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
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
   * Valide une PayoutRequest = déclenche le payout AfribaPay, puis
   * marque la demande comme payée si AfribaPay confirme. Effets :
   *   1. Appel AfribaPay /v1/pay/payout (si erreur → throw, rien ne change)
   *   2. Si AfribaPay SUCCESS ou PENDING : status='paid', stocker
   *      transaction_id réel, commissions locked → paid, lock User unset
   *   3. Si AfribaPay FAILED : throw, l'admin peut Rejeter manuellement
   *
   * @param {string} appId
   * @param {string} payoutId
   * @param {Object} adminInfo - { adminId, note? }
   *   `transferReference` est ignoré : on prend le transaction_id réel
   *   d'AfribaPay au lieu d'une saisie admin.
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

    // ===== 1. Appel AfribaPay payout =====
    let afribaResult;
    try {
      afribaResult = await afribaPayPayoutService.triggerPayout({
        operator: pr.operator,
        country: pr.country,
        phoneNumber: pr.phoneNumber,
        amount: pr.amount,
        currency: pr.currency,
        orderId: pr.afribaPayOrderId || `payout-${pr._id}`,
        referenceId: `affiliate-${pr.user}`,
        notifyUrl: process.env.AFRIBAPAY_PAYOUT_NOTIFY_URL || undefined,
      });
    } catch (err) {
      // Audit le tentative échouée pour traçabilité, sans changer le status
      pr.attempts.push({
        at: new Date(),
        type: 'admin_action',
        status: pr.status,
        actor: adminInfo.adminId ? String(adminInfo.adminId) : 'admin',
        error: err.message,
        payload: {
          action: 'trigger_afribapay',
          afribaResponse: err.responseData || null,
        },
      });
      await pr.save();
      // On relève l'erreur pour que l'admin la voie à l'écran
      throw new AppError(
        err.message || 'Échec AfribaPay',
        err.statusCode || 502,
        ErrorCodes.OPERATION_FAILED
      );
    }

    // ===== 2. AfribaPay a accepté (SUCCESS ou PENDING) =====
    const now = new Date();
    pr.status = 'paid'; // V1 : on accepte SUCCESS et PENDING comme paid
    pr.paidAt = now;
    pr.afribaPayTransactionId = afribaResult.transactionId;
    pr.afribaPayProviderId = afribaResult.providerId;
    pr.afribaPayLastResponse = afribaResult.raw;
    pr.attempts.push({
      at: now,
      type: 'admin_action',
      status: 'paid',
      actor: adminInfo.adminId ? String(adminInfo.adminId) : 'admin',
      payload: {
        action: 'trigger_afribapay',
        afribaStatus: afribaResult.status,
        transactionId: afribaResult.transactionId,
        note: adminInfo.note || null,
      },
      response: afribaResult.raw,
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
