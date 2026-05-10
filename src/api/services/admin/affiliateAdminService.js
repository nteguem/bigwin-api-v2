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
const App = require('../../models/common/App');
const Device = require('../../models/common/Device');
const afribaPayPayoutService = require('./afribaPayPayoutService');
const notificationService = require('../common/notificationService');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

/**
 * Push notif à l'affilié quand son payout passe paid ou failed.
 * Fail silently — on ne bloque pas le traitement de la PayoutRequest.
 */
async function _notifyAffiliateAboutPayout(payoutRequest, finalStatus) {
  try {
    const devices = await Device.find({
      appId: payoutRequest.appId,
      user: payoutRequest.user,
      isActive: true,
      playerId: { $exists: true, $ne: null },
    })
      .select('playerId')
      .lean();
    const playerIds = devices.map((d) => d.playerId).filter(Boolean);
    if (playerIds.length === 0) return;

    const isPaid = finalStatus === 'paid';
    const headings = isPaid
      ? { fr: 'Retrait envoyé ✅', en: 'Payout sent ✅' }
      : { fr: 'Retrait rejeté', en: 'Payout rejected' };
    const contents = isPaid
      ? {
          fr: `Ton retrait de ${payoutRequest.amount} ${payoutRequest.currency} a été envoyé sur ton mobile money.`,
          en: `Your payout of ${payoutRequest.amount} ${payoutRequest.currency} has been sent to your mobile money.`,
        }
      : {
          fr: `Ton retrait de ${payoutRequest.amount} ${payoutRequest.currency} n'a pas pu être traité. ${payoutRequest.failureReason || ''}`,
          en: `Your payout of ${payoutRequest.amount} ${payoutRequest.currency} could not be processed. ${payoutRequest.failureReason || ''}`,
        };
    await notificationService.sendToUsers(
      payoutRequest.appId,
      playerIds,
      {
        headings,
        contents,
        data: {
          type: `affiliate.payout_${finalStatus}`,
          payoutId: String(payoutRequest._id),
          amount: String(payoutRequest.amount),
          currency: payoutRequest.currency,
        },
      }
    );
  } catch (err) {
    console.warn(
      '[affiliateAdminService] _notifyAffiliateAboutPayout failed:',
      err?.message || err
    );
  }
}

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

    // Charge l'app pour récupérer la config AfribaPay
    const app = await App.findOne({ appId });
    if (!app) {
      throw new AppError(
        `App "${appId}" introuvable.`,
        404,
        ErrorCodes.NOT_FOUND
      );
    }

    // ===== 1. Vérification config webhook (CRITIQUE) =====
    // Sans notifyUrl, AfribaPay ne webhookra jamais et le payout
    // restera stuck à "processing" à vie. Mieux vaut throw maintenant
    // que créer un payout fantôme.
    const notifyUrl = process.env.AFRIBAPAY_PAYOUT_NOTIFY_URL;
    if (!notifyUrl) {
      throw new AppError(
        'AFRIBAPAY_PAYOUT_NOTIFY_URL non configuré dans le .env. ' +
          'Sans cette URL, AfribaPay ne pourra jamais confirmer le ' +
          'paiement et le retrait restera bloqué. Configure cette ' +
          'variable d\'env avant de valider un retrait.',
        500,
        ErrorCodes.INTERNAL_ERROR
      );
    }

    // ===== 2. Appel AfribaPay payout =====
    let afribaResult;
    try {
      afribaResult = await afribaPayPayoutService.triggerPayout(app, {
        operator: pr.operator,
        country: pr.country,
        phoneNumber: pr.phoneNumber,
        amount: pr.amount,
        currency: pr.currency,
        orderId: pr.afribaPayOrderId || `payout-${pr._id}`,
        referenceId: `affiliate-${pr.user}`,
        notifyUrl,
      });
    } catch (err) {
      // Audit la tentative échouée pour traçabilité, sans changer le status
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
      throw new AppError(
        err.message || 'Échec AfribaPay',
        err.statusCode || 502,
        ErrorCodes.OPERATION_FAILED
      );
    }

    // ===== 2. AfribaPay a accepté =====
    // SUCCESS  → paid direct (rare au moment de l'init, vu plus dans le webhook)
    // PENDING  → processing : commissions restent locked, on attend le webhook
    const now = new Date();
    pr.afribaPayTransactionId = afribaResult.transactionId;
    pr.afribaPayProviderId = afribaResult.providerId;
    pr.afribaPayLastResponse = afribaResult.raw;
    pr.attempts.push({
      at: now,
      type: 'admin_action',
      status: afribaResult.status === 'SUCCESS' ? 'paid' : 'processing',
      actor: adminInfo.adminId ? String(adminInfo.adminId) : 'admin',
      payload: {
        action: 'trigger_afribapay',
        afribaStatus: afribaResult.status,
        transactionId: afribaResult.transactionId,
        note: adminInfo.note || null,
      },
      response: afribaResult.raw,
    });

    if (afribaResult.status === 'SUCCESS') {
      pr.status = 'paid';
      pr.paidAt = now;
      await pr.save();

      await Commission.updateMany(
        { _id: { $in: pr.commissionsIncluded }, status: 'locked' },
        { $set: { status: 'paid', paidAt: now } }
      );

      await User.findOneAndUpdate(
        { _id: pr.user, 'affiliate.activePayoutId': pr._id },
        { $unset: { 'affiliate.activePayoutId': '' } }
      );

      // Push notif à l'affilié (fire-and-forget)
      _notifyAffiliateAboutPayout(pr, 'paid');
    } else {
      // PENDING : virement initié, attente confirmation webhook
      pr.status = 'processing';
      await pr.save();
      // Commissions restent 'locked', User.activePayoutId reste set.
      // Le webhook fera la transition finale (paid ou failed).
    }

    return pr;
  }

  /**
   * Traite un webhook AfribaPay payout. Appelé par le controller
   * webhook après vérification HMAC. Le payload contient au moins
   * order_id et status. Met à jour la PayoutRequest correspondante :
   *
   *   SUCCESS  → status='paid' + commissions paid + unlock User
   *   FAILED   → status='failed' + commissions retournent en available
   *              + unlock User + failureReason
   *
   * Idempotent : si la PayoutRequest est déjà paid/failed, on log et
   * on ne refait rien (AfribaPay peut renvoyer le webhook plusieurs fois).
   *
   * @returns {Object} { handled: bool, payoutRequest, refereeChanges }
   *   refereeChanges contient les commissions affectées (pour notif).
   */
  async handlePayoutWebhook(payload, headers) {
    const orderId =
      payload.order_id ||
      payload.orderId ||
      payload.data?.order_id;
    const status = String(
      payload.status || payload.data?.status || ''
    ).toUpperCase();
    const transactionId =
      payload.transaction_id ||
      payload.data?.transaction_id ||
      null;

    if (!orderId) {
      throw new AppError(
        'Webhook AfribaPay : order_id manquant.',
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    const pr = await PayoutRequest.findOne({ afribaPayOrderId: orderId });
    if (!pr) {
      // Pas notre payout (peut être un payin via le même webhook ?)
      return { handled: false, reason: 'PayoutRequest not found' };
    }

    // Idempotence : si déjà finalisé, on log juste l'attempt et on sort
    if (pr.status === 'paid' || pr.status === 'failed') {
      pr.attempts.push({
        at: new Date(),
        type: 'webhook',
        status: pr.status,
        payload,
        error: 'Webhook reçu après finalisation — ignored (idempotent)',
      });
      await pr.save();
      return { handled: true, payoutRequest: pr, idempotent: true };
    }

    const now = new Date();
    pr.webhookReceivedAt = now;
    if (transactionId) pr.afribaPayTransactionId = transactionId;
    pr.afribaPayLastResponse = payload;

    if (status === 'SUCCESS') {
      pr.status = 'paid';
      pr.paidAt = now;
      pr.attempts.push({
        at: now,
        type: 'webhook',
        status: 'paid',
        payload,
      });
      await pr.save();

      // Commissions: locked → paid
      await Commission.updateMany(
        { _id: { $in: pr.commissionsIncluded }, status: 'locked' },
        { $set: { status: 'paid', paidAt: now } }
      );

      // Unlock User
      await User.findOneAndUpdate(
        { _id: pr.user, 'affiliate.activePayoutId': pr._id },
        { $unset: { 'affiliate.activePayoutId': '' } }
      );

      // Push notif à l'affilié (fire-and-forget)
      _notifyAffiliateAboutPayout(pr, 'paid');

      return { handled: true, payoutRequest: pr, finalStatus: 'paid' };
    }

    if (status === 'FAILED') {
      const reason = payload.message || payload.reason || 'AfribaPay FAILED';
      pr.status = 'failed';
      pr.failureReason = reason;
      pr.attempts.push({
        at: now,
        type: 'webhook',
        status: 'failed',
        payload,
        error: reason,
      });
      await pr.save();

      // Commissions retournent en available (l'argent n'est pas parti)
      await Commission.updateMany(
        { _id: { $in: pr.commissionsIncluded }, status: 'locked' },
        { $set: { status: 'available' }, $unset: { payoutRequest: '' } }
      );

      // Unlock User
      await User.findOneAndUpdate(
        { _id: pr.user, 'affiliate.activePayoutId': pr._id },
        { $unset: { 'affiliate.activePayoutId': '' } }
      );

      // Push notif à l'affilié (fire-and-forget)
      _notifyAffiliateAboutPayout(pr, 'failed');

      return { handled: true, payoutRequest: pr, finalStatus: 'failed' };
    }

    // Status non finaux (PENDING ?) : on log juste
    pr.attempts.push({
      at: now,
      type: 'webhook',
      status: pr.status,
      payload,
    });
    await pr.save();
    return { handled: true, payoutRequest: pr, transient: true };
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

    // Push notif à l'affilié (fire-and-forget)
    _notifyAffiliateAboutPayout(pr, 'failed');

    return pr;
  }
}

module.exports = new AffiliateAdminService();
