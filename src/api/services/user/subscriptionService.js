const Subscription = require('../../models/common/Subscription');
const Package = require('../../models/common/Package');
const User = require('../../models/user/User');
const Category = require('../../models/common/Category');
const commissionService = require('../common/commissionService'); // Import du service commission
const { AppError, ErrorCodes } = require('../../../utils/AppError');

class SubscriptionService {
  /**
   * Créer un abonnement pour un utilisateur
   */
  async createSubscription(userId, packageId, currency, paymentReference = null) {
    // Vérifier que le package existe et est actif
    const packageNew = await Package.findById(packageId);
    if (!packageNew || !packageNew.isActive) {
      throw new AppError('Package non disponible', 404, ErrorCodes.NOT_FOUND);
    }

    // Vérifier que le prix existe pour la devise
     const price = packageNew.pricing.get(currency.toUpperCase());
  if (!price) {
    throw new AppError(`Prix non disponible en ${currency}`, 400, ErrorCodes.VALIDATION_ERROR);
  }
    // Récupérer l'utilisateur
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('Utilisateur non trouvé', 404, ErrorCodes.NOT_FOUND);
    }

    // Calculer les dates
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + packageNew.duration * 24 * 60 * 60 * 1000);

    // Créer l'abonnement
    const subscription = await Subscription.create({
      user: userId,
      package: packageId,
      startDate,
      endDate,
      pricing: {
        amount: price,
        currency
      },
      paymentReference
    });

    // Créer commission si l'utilisateur a un parrain
    if (user.referredBy) {
      await commissionService.createCommission(subscription._id);
    }

    return subscription;
  }

  /**
   * NOUVELLE MÉTHODE : Obtenir les informations complètes d'abonnement d'un utilisateur
   */
  async getUserSubscriptionInfo(userId) {
    const activeSubscriptions = await this.getActiveSubscriptions(userId);
    
    const activePackages = activeSubscriptions.map(subscription => ({
      id: subscription.package._id,
      name: subscription.package.name,
      description: subscription.package.description,
      type: subscription.package.type,
      duration: subscription.package.duration,
      startDate: subscription.startDate,
      endDate: subscription.endDate,
      status: subscription.status,
      pricing: {
        amount: subscription.pricing.amount,
        currency: subscription.pricing.currency
      },
      categories: subscription.package.categories || [],
      subscriptionId: subscription._id
    }));

    return {
      hasActiveSubscription: activeSubscriptions.length > 0,
      activePackages,
      totalActiveSubscriptions: activeSubscriptions.length
    };
  }

  /**
   * Obtenir les abonnements actifs d'un utilisateur
   */
  async getActiveSubscriptions(userId) {
    return await Subscription.find({
      user: userId,
      status: 'active',
      endDate: { $gt: new Date() }
    }).populate('package');
  }

  /**
   * Vérifier si un utilisateur a accès à une catégorie
   * MODIFIÉ : Vérifie les catégories ACTUELLES du package (retrait immédiat)
   */
  async hasAccessToCategory(userId, categoryId) {
    const activeSubscriptions = await this.getActiveSubscriptions(userId);
    
    for (const subscription of activeSubscriptions) {
      // Récupérer le package ACTUEL avec ses catégories ACTUELLES
      const currentPackage = await Package.findById(subscription.package._id);
      
      if (currentPackage && currentPackage.isActive && currentPackage.categories.includes(categoryId)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * MODIFIÉ : Vérifier si un utilisateur a accès à au moins une catégorie VIP
   * Utilise les catégories ACTUELLES des packages (retrait immédiat)
   */
  async hasAnyVipAccess(userId) {
    // Récupérer les abonnements actifs de l'utilisateur
    const activeSubscriptions = await this.getActiveSubscriptions(userId);
    
    if (activeSubscriptions.length === 0) {
      return false;
    }

    // Récupérer les catégories ACTUELLES de chaque package
    const categoryIds = [];
    for (const subscription of activeSubscriptions) {
      // Récupérer le package ACTUEL (pas celui stocké dans l'abonnement)
      const currentPackage = await Package.findById(subscription.package._id);
      
      if (currentPackage && currentPackage.isActive) {
        categoryIds.push(...currentPackage.categories);
      }
    }

    // Supprimer les doublons
    const uniqueCategoryIds = [...new Set(categoryIds.map(id => id.toString()))];

    if (uniqueCategoryIds.length === 0) {
      return false;
    }

    // Vérifier si au moins une de ces catégories est VIP
    const vipCategories = await Category.find({
      _id: { $in: uniqueCategoryIds },
      isVip: true,
      isActive: true
    });

    return vipCategories.length > 0;
  }

  /**
   * MODIFIÉ : Obtenir toutes les catégories VIP auxquelles l'utilisateur a accès
   * Utilise les catégories ACTUELLES des packages (retrait immédiat)
   */
  async getUserVipCategories(userId) {
    const activeSubscriptions = await this.getActiveSubscriptions(userId);
    
    if (activeSubscriptions.length === 0) {
      return [];
    }

    // Récupérer les catégories ACTUELLES de chaque package
    const categoryIds = [];
    for (const subscription of activeSubscriptions) {
      // Récupérer le package ACTUEL (pas celui stocké dans l'abonnement)
      const currentPackage = await Package.findById(subscription.package._id);
      
      if (currentPackage && currentPackage.isActive) {
        categoryIds.push(...currentPackage.categories);
      }
    }

    // Supprimer les doublons
    const uniqueCategoryIds = [...new Set(categoryIds.map(id => id.toString()))];

    if (uniqueCategoryIds.length === 0) {
      return [];
    }

    // Récupérer toutes les catégories VIP auxquelles l'utilisateur a accès
    return await Category.find({
      _id: { $in: uniqueCategoryIds },
      isVip: true,
      isActive: true
    });
  }

  /**
   * Obtenir tous les abonnements d'un utilisateur
   */
  async getUserSubscriptions(userId) {
    return await Subscription.find({ user: userId })
      .populate('package')
      .sort({ createdAt: -1 });
  }

  /**
   * Annuler un abonnement
   */
  async cancelSubscription(subscriptionId, userId) {
    const subscription = await Subscription.findOne({
      _id: subscriptionId,
      user: userId
    });

    if (!subscription) {
      throw new AppError('Abonnement non trouvé', 404, ErrorCodes.NOT_FOUND);
    }

    if (subscription.status !== 'active') {
      throw new AppError('Seuls les abonnements actifs peuvent être annulés', 400, ErrorCodes.VALIDATION_ERROR);
    }

    // Annuler l'abonnement
    await subscription.cancel();

    // Annuler la commission associée via commissionService
    const Commission = require('../../models/common/Commission');
    const commission = await Commission.findOne({ subscription: subscriptionId });
    if (commission && commission.status === 'pending') {
      await commissionService.cancelCommissions([commission._id], 'Abonnement annulé par utilisateur');
    }

    return subscription;
  }

  /**
   * Obtenir les statistiques des abonnements
   */
  async getSubscriptionStats() {
    const stats = await Subscription.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$pricing.amount' }
        }
      }
    ]);

    return stats;
  }
}

module.exports = new SubscriptionService();