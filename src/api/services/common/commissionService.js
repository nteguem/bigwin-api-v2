// services/common/commissionService.js

const Subscription = require('../../models/common/Subscription');
const Commission = require('../../models/common/Commission');
const Affiliate = require('../../models/affiliate/Affiliate');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

class CommissionService {
  /**
   * Créer une commission pour un abonnement
   * @param {String} appId - ID de l'application
   */
  async createCommission(appId, subscriptionId) {
    // ⭐ Filtrer par appId
    const subscription = await Subscription.findOne({ _id: subscriptionId, appId })
      .populate('user')
      .populate('package');

    // Vérifier si l'user a un parrain
    if (!subscription.user.referredBy) return null;

    // ⭐ Filtrer par appId
    const affiliate = await Affiliate.findOne({ 
      _id: subscription.user.referredBy, 
      appId 
    }).populate('affiliateType');
    
    if (!affiliate || !affiliate.isActive) return null;

    // Vérifier que l'affilié a un type avec un taux de commission
    if (!affiliate.affiliateType) return null;

    // ⭐ Vérifier si commission existe déjà POUR CETTE APP
    const existingCommission = await Commission.findOne({ appId, subscription: subscriptionId });
    if (existingCommission) return existingCommission;

    // Calculer la commission avec le taux du type
    const commissionRate = affiliate.affiliateType.commissionRate;
    const commissionAmount = (subscription.pricing.amount * commissionRate) / 100;

    // ⭐ Créer l'enregistrement AVEC APPID
    const commission = await Commission.create({
      appId, // ⭐ AJOUT
      affiliate: affiliate._id,
      user: subscription.user._id,
      subscription: subscription._id,
      amount: subscription.pricing.amount,
      currency: subscription.pricing.currency,
      commissionRate,
      commissionAmount,
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear()
    });

    // Mettre à jour le solde en attente
    affiliate.pendingBalance += commissionAmount;
    affiliate.totalEarnings += commissionAmount;
    await affiliate.save();

    return commission;
  }

  /**
   * Calculer les commissions pending d'un affilié pour un mois donné
   * @param {String} appId - ID de l'application
   */
  async calculateAffiliateCommissions(appId, affiliateId, month, year) {
    // ⭐ Filtrer par appId
    const pendingCommissions = await Commission.find({
      appId, // ⭐ AJOUT
      affiliate: affiliateId,
      month,
      year,
      status: 'pending'
    }).sort({ createdAt: -1 });

    // Grouper par devise directement
    const commissionsByCurrency = {};
    let totalCommissions = 0;

    pendingCommissions.forEach(commission => {
      const currency = commission.currency;
      
      if (!commissionsByCurrency[currency]) {
        commissionsByCurrency[currency] = {
          currency,
          totalAmount: 0,
          count: 0,
          commissions: []
        };
      }

      commissionsByCurrency[currency].totalAmount += commission.commissionAmount;
      commissionsByCurrency[currency].count += 1;
      commissionsByCurrency[currency].commissions.push({
        id: commission._id,
        subscriptionId: commission.subscription,
        userId: commission.user,
        amount: commission.amount,
        currency: commission.currency,
        commissionRate: commission.commissionRate,
        commissionAmount: commission.commissionAmount,
        createdAt: commission.createdAt
      });

      totalCommissions++;
    });

    const report = {
      period: { month, year },
      affiliateId,
      totalPending: totalCommissions,
      currencyBreakdown: Object.values(commissionsByCurrency),
      allCommissions: pendingCommissions.map(commission => ({
        id: commission._id,
        subscriptionId: commission.subscription,
        userId: commission.user,
        amount: commission.amount,
        currency: commission.currency,
        commissionRate: commission.commissionRate,
        commissionAmount: commission.commissionAmount,
        createdAt: commission.createdAt
      }))
    };

    console.log(`✅ Traitement réussi: ${totalCommissions} commissions pending`);
    return report;
  }

  /**
   * Obtenir les commissions en attente pour un affilié et un mois
   * @param {String} appId - ID de l'application
   */
  async getPendingAffiliateCommissions(appId, affiliateId, month, year) {
    // ⭐ Filtrer par appId
    const commissions = await Commission.find({
      appId, // ⭐ AJOUT
      affiliate: affiliateId,
      month,
      year,
      status: 'pending'
    })
    .populate('user', 'phone firstName lastName')
    .populate('subscription', 'pricing createdAt')
    .sort({ createdAt: -1 });

    // Grouper par devise
    const totalsByCurrency = {};
    
    commissions.forEach(commission => {
      const currency = commission.currency;
      if (!totalsByCurrency[currency]) {
        totalsByCurrency[currency] = {
          currency,
          totalAmount: 0,
          count: 0
        };
      }
      totalsByCurrency[currency].totalAmount += commission.commissionAmount;
      totalsByCurrency[currency].count += 1;
    });

    return {
      period: { month, year },
      totalsByCurrency: Object.values(totalsByCurrency),
      commissionCount: commissions.length,
      commissions
    };
  }

  /**
   * Valider le paiement des commissions pending d'un affilié
   * @param {String} appId - ID de l'application
   */
  async validateAffiliatePayment(appId, affiliateId, month, year, paymentReference) {
    // ⭐ Filtrer par appId
    const pendingCommissions = await Commission.find({
      appId, // ⭐ AJOUT
      affiliate: affiliateId,
      month,
      year,
      status: 'pending'
    });

    if (pendingCommissions.length === 0) {
      throw new AppError('Aucune commission en attente pour cet affilié et cette période', 404, ErrorCodes.NOT_FOUND);
    }

    // Grouper les paiements par devise
    const paymentsByCurrency = {};
    let totalPaid = 0;

    // Mettre à jour toutes les commissions pending
    for (const commission of pendingCommissions) {
      commission.status = 'paid';
      commission.paidAt = new Date();
      commission.paymentReference = paymentReference;
      await commission.save();

      const currency = commission.currency;
      if (!paymentsByCurrency[currency]) {
        paymentsByCurrency[currency] = {
          currency,
          amount: 0,
          count: 0
        };
      }
      
      paymentsByCurrency[currency].amount += commission.commissionAmount;
      paymentsByCurrency[currency].count += 1;
      totalPaid += commission.commissionAmount;
    }

    // ⭐ Mettre à jour les balances de l'affilié (filtré par appId)
    const affiliate = await Affiliate.findOne({ _id: affiliateId, appId });
    if (affiliate) {
      affiliate.pendingBalance -= totalPaid;
      affiliate.paidBalance += totalPaid;
      await affiliate.save();
    }

    const report = {
      period: { month, year },
      affiliateId,
      paymentReference,
      paidCommissions: pendingCommissions.length,
      paymentsByCurrency: Object.values(paymentsByCurrency),
      totalPaid
    };

    return report;
  }

  /**
   * Annuler des commissions
   * @param {String} appId - ID de l'application
   */
  async cancelCommissions(appId, commissionIds, reason = '') {
    // ⭐ Filtrer par appId
    const commissions = await Commission.find({
      appId, // ⭐ AJOUT
      _id: { $in: commissionIds },
      status: 'pending'
    });

    if (commissions.length === 0) {
      throw new AppError('Aucune commission éligible à l\'annulation', 404, ErrorCodes.NOT_FOUND);
    }

    const report = {
      cancelledCount: commissions.length,
      totalAmount: 0,
      reason
    };

    for (const commission of commissions) {
      commission.status = 'cancelled';
      await commission.save();

      report.totalAmount += commission.commissionAmount;

      // ⭐ Mettre à jour les balances de l'affilié (filtré par appId)
      const affiliate = await Affiliate.findOne({ _id: commission.affiliate, appId });
      if (affiliate) {
        affiliate.pendingBalance -= commission.commissionAmount;
        affiliate.totalEarnings -= commission.commissionAmount;
        await affiliate.save();
      }
    }

    return report;
  }

  /**
   * Obtenir les statistiques globales des commissions
   * @param {String} appId - ID de l'application
   */
  async getCommissionStats(appId) {
    // ⭐ Filtrer par appId
    const stats = await Commission.aggregate([
      { $match: { appId } }, // ⭐ AJOUT
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$commissionAmount' }
        }
      }
    ]);

    // ⭐ Stats par devise POUR CETTE APP
    const currencyStats = await Commission.aggregate([
      { $match: { appId } }, // ⭐ AJOUT
      {
        $group: {
          _id: {
            status: '$status',
            currency: '$currency'
          },
          count: { $sum: 1 },
          totalAmount: { $sum: '$commissionAmount' }
        }
      },
      {
        $sort: { '_id.currency': 1, '_id.status': 1 }
      }
    ]);

    // ⭐ Stats mensuelles POUR CETTE APP
    const monthlyStats = await Commission.aggregate([
      { $match: { appId } }, // ⭐ AJOUT
      {
        $group: {
          _id: {
            year: '$year',
            month: '$month'
          },
          totalCommissions: { $sum: '$commissionAmount' },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id.year': -1, '_id.month': -1 }
      },
      { $limit: 12 }
    ]);

    return {
      overallStats: stats,
      currencyStats,
      monthlyEvolution: monthlyStats.reverse()
    };
  }

  /**
   * Obtenir le rapport détaillé d'une période
   * @param {String} appId - ID de l'application
   */
  async getDetailedReport(appId, month, year) {
    // ⭐ Filtrer par appId
    const commissions = await Commission.find({ appId, month, year })
      .populate({
        path: 'affiliate',
        select: 'affiliateCode firstName lastName',
        populate: {
          path: 'affiliateType',
          select: 'name commissionRate'
        }
      })
      .populate('user', 'phone firstName lastName createdAt')
      .populate({
        path: 'subscription',
        populate: {
          path: 'package',
          select: 'name pricing'
        }
      })
      .sort({ createdAt: -1 });

    // ⭐ Summary POUR CETTE APP
    const summary = await Commission.aggregate([
      { $match: { appId, month, year } }, // ⭐ AJOUT
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$commissionAmount' }
        }
      }
    ]);

    // ⭐ Summary par devise POUR CETTE APP
    const currencySummary = await Commission.aggregate([
      { $match: { appId, month, year } }, // ⭐ AJOUT
      {
        $group: {
          _id: {
            status: '$status',
            currency: '$currency'
          },
          count: { $sum: 1 },
          totalAmount: { $sum: '$commissionAmount' }
        }
      },
      {
        $sort: { '_id.currency': 1, '_id.status': 1 }
      }
    ]);

    return {
      period: { month, year },
      summary,
      currencySummary,
      commissions,
      totalCommissions: commissions.length
    };
  }

  /**
   * Recalculer les balances des affiliés
   * @param {String} appId - ID de l'application
   */
  async recalculateAffiliateBalances(appId) {
    // ⭐ Filtrer par appId
    const affiliates = await Affiliate.find({ appId, isActive: true });
    const report = [];

    for (const affiliate of affiliates) {
      // ⭐ Filtrer par appId
      const commissionStats = await Commission.aggregate([
        { $match: { appId, affiliate: affiliate._id } }, // ⭐ AJOUT
        {
          $group: {
            _id: '$status',
            totalAmount: { $sum: '$commissionAmount' }
          }
        }
      ]);

      let pendingBalance = 0;
      let paidBalance = 0;
      let totalEarnings = 0;

      commissionStats.forEach(stat => {
        if (stat._id === 'pending') pendingBalance = stat.totalAmount;
        if (stat._id === 'paid') paidBalance = stat.totalAmount;
        totalEarnings += stat.totalAmount;
      });

      // Mettre à jour l'affilié
      affiliate.pendingBalance = pendingBalance;
      affiliate.paidBalance = paidBalance;
      affiliate.totalEarnings = totalEarnings;
      await affiliate.save();

      report.push({
        affiliateCode: affiliate.affiliateCode,
        oldBalances: {
          pending: affiliate.pendingBalance,
          paid: affiliate.paidBalance,
          total: affiliate.totalEarnings
        },
        newBalances: {
          pending: pendingBalance,
          paid: paidBalance,
          total: totalEarnings
        }
      });
    }

    return report;
  }
}

module.exports = new CommissionService();