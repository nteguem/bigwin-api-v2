// src/api/services/user/subscriptionService.js

const Subscription = require('../../models/common/Subscription');
const Package = require('../../models/common/Package');
const User = require('../../models/user/User');
const Category = require('../../models/common/Category');
const GooglePlayTransaction = require('../../models/user/GooglePlayTransaction');
const commissionService = require('../common/commissionService');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

/**
 * SubscriptionService
 * ===================
 * 
 * GESTION DES CATÉGORIES/PACKAGES PARTAGÉS :
 * - Les utilisateurs ayant un package contenant une catégorie VIP partagée ont accès aux tickets de cette catégorie dans TOUTES les apps
 * - Exemple : User de app1 avec package contenant catégorie LIVE (shared) → Accès aux tickets LIVE de app1, app2, app3...
 * - Les packages peuvent être spécifiques (appId = "app1") ou partagés (appId = "shared")
 */

class SubscriptionService {
  /**
   * Créer un abonnement pour un utilisateur (Mobile Money)
   * @param {String} appId - ID de l'application
   */
  async createSubscription(appId, userId, packageId, currency, paymentReference = null) {
    // ⭐ MODIFIÉ : Chercher le package dans l'app OU dans les packages partagés
    const packageNew = await Package.findOne({ 
      _id: packageId, 
      appId: { $in: [appId, "shared"] }, // ← Inclure packages shared
      isActive: true 
    });
    
    if (!packageNew) {
      throw new AppError('Package non disponible', 404, ErrorCodes.NOT_FOUND);
    }

    // Vérifier que le prix existe pour la devise
    const price = packageNew.pricing.get(currency.toUpperCase());
    if (!price) {
      throw new AppError(`Prix non disponible en ${currency}`, 400, ErrorCodes.VALIDATION_ERROR);
    }
    
    // Récupérer l'utilisateur DE CETTE APP
    const user = await User.findOne({ _id: userId, appId });
    if (!user) {
      throw new AppError('Utilisateur non trouvé', 404, ErrorCodes.NOT_FOUND);
    }

    // Calculer les dates
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + packageNew.duration * 24 * 60 * 60 * 1000);

    // Créer l'abonnement AVEC appId
    const subscription = await Subscription.create({
      appId,
      user: userId,
      package: packageId,
      startDate,
      endDate,
      pricing: {
        amount: price,
        currency
      },
      paymentReference,
      paymentProvider: 'MOBILE_MONEY'
    });
    
    // Créer commission si l'utilisateur a un parrain
    if (user.referredBy) {
      await commissionService.createCommission(appId, subscription._id);
    }

    return subscription;
  }

  /**
   * Créer un abonnement Google Play
   * @param {String} appId - ID de l'application
   */
  async createGooglePlaySubscription(appId, userId, packageId, googleTransactionId, purchaseData) {
    // ⭐ MODIFIÉ : Chercher le package dans l'app OU dans les packages partagés
    const packageNew = await Package.findOne({ 
      _id: packageId, 
      appId: { $in: [appId, "shared"] }, // ← Inclure packages shared
      isActive: true 
    });
    
    if (!packageNew) {
      throw new AppError('Package non disponible', 404, ErrorCodes.NOT_FOUND);
    }

    // Récupérer l'utilisateur DE CETTE APP
    const user = await User.findOne({ _id: userId, appId });
    if (!user) {
      throw new AppError('Utilisateur non trouvé', 404, ErrorCodes.NOT_FOUND);
    }

    // Créer l'abonnement AVEC appId
    const subscription = await Subscription.create({
      appId,
      user: userId,
      package: packageId,
      startDate: purchaseData.startDate,
      endDate: purchaseData.endDate,
      pricing: {
        amount: purchaseData.amount,
        currency: purchaseData.currency
      },
      status: 'active',
      paymentProvider: 'GOOGLE_PLAY',
      paymentReference: purchaseData.orderId,
      googlePlayTransaction: googleTransactionId,
      autoRenewing: purchaseData.autoRenewing
    });

    // Créer commission si l'utilisateur a un parrain
    if (user.referredBy) {
      await commissionService.createCommission(appId, subscription._id);
    }

    return subscription;
  }

  /**
   * Obtenir les informations complètes d'abonnement d'un utilisateur
   * @param {String} appId - ID de l'application
   */
  async getUserSubscriptionInfo(appId, userId) {
    const activeSubscriptions = await this.getActiveSubscriptions(appId, userId);
    
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
      subscriptionId: subscription._id,
      paymentProvider: subscription.paymentProvider,
      autoRenewing: subscription.autoRenewing || false
    }));

    return {
      hasActiveSubscription: activeSubscriptions.length > 0,
      activePackages,
      totalActiveSubscriptions: activeSubscriptions.length
    };
  }

  /**
   * Obtenir les abonnements actifs d'un utilisateur
   * @param {String} appId - ID de l'application
   */
  async getActiveSubscriptions(appId, userId) {
    return await Subscription.find({
      appId, // ⭐ AJOUT DE APPID
      user: userId,
      status: 'active',
      $or: [
        // Tous les abonnements qui ne sont PAS Google Play
        {
          $or: [
            { paymentProvider: { $exists: false } },
            { paymentProvider: { $ne: 'GOOGLE_PLAY' } }
          ],
          endDate: { $gt: new Date() }
        },
        // Google Play
        {
          paymentProvider: 'GOOGLE_PLAY'
        }
      ]
    }).populate('package');
  }

  /**
   * Vérifier si un utilisateur a accès à une catégorie (inclut catégories partagées)
   * @param {String} appId - ID de l'application
   */
  async hasAccessToCategory(appId, userId, categoryId) {
    const activeSubscriptions = await this.getActiveSubscriptions(appId, userId);
    
    for (const subscription of activeSubscriptions) {
      // ⭐ MODIFIÉ : Ne pas filtrer par appId pour permettre l'accès aux packages/catégories partagés
      // On récupère le package tel quel (peut être de l'app ou shared)
      const currentPackage = await Package.findOne({ 
        _id: subscription.package._id
        // Pas de filtre appId ici - le package peut être de n'importe quelle app ou shared
      });
      
      if (currentPackage && currentPackage.categories.includes(categoryId)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Vérifier si un utilisateur a accès à au moins une catégorie VIP (inclut VIP partagées)
   * @param {String} appId - ID de l'application
   */
  async hasAnyVipAccess(appId, userId) {
    // Récupérer les abonnements actifs de l'utilisateur POUR CETTE APP
    const activeSubscriptions = await this.getActiveSubscriptions(appId, userId);
    
    if (activeSubscriptions.length === 0) {
      return false;
    }

    // Récupérer les catégories ACTUELLES de chaque package
    const categoryIds = [];
    for (const subscription of activeSubscriptions) {
      // ⭐ MODIFIÉ : Ne pas filtrer par appId
      const currentPackage = await Package.findOne({ 
        _id: subscription.package._id
        // Pas de filtre appId - le package peut contenir des catégories shared
      });
      
      if (currentPackage) {
        categoryIds.push(...currentPackage.categories);
      }
    }

    // Supprimer les doublons
    const uniqueCategoryIds = [...new Set(categoryIds.map(id => id.toString()))];

    if (uniqueCategoryIds.length === 0) {
      return false;
    }

    // ⭐ MODIFIÉ : Vérifier si au moins une catégorie est VIP (app OU shared)
    const vipCategories = await Category.find({
      appId: { $in: [appId, "shared"] }, // ← Inclure catégories VIP shared
      _id: { $in: uniqueCategoryIds },
      isVip: true,
      isActive: true
    });

    return vipCategories.length > 0;
  }

  /**
   * Obtenir toutes les catégories VIP auxquelles l'utilisateur a accès (inclut VIP partagées)
   * @param {String} appId - ID de l'application
   */
  async getUserVipCategories(appId, userId) {
    const activeSubscriptions = await this.getActiveSubscriptions(appId, userId);
    
    if (activeSubscriptions.length === 0) {
      return [];
    }

    // Récupérer les catégories ACTUELLES de chaque package
    const categoryIds = [];
    for (const subscription of activeSubscriptions) {
      // ⭐ MODIFIÉ : Ne pas filtrer par appId
      const currentPackage = await Package.findOne({ 
        _id: subscription.package._id
        // Pas de filtre appId - le package peut contenir des catégories shared
      });
      
      if (currentPackage) {
        categoryIds.push(...currentPackage.categories);
      }
    }

    // Supprimer les doublons
    const uniqueCategoryIds = [...new Set(categoryIds.map(id => id.toString()))];

    if (uniqueCategoryIds.length === 0) {
      return [];
    }

    // ⭐ MODIFIÉ : Récupérer toutes les catégories VIP (app OU shared)
    return await Category.find({
      appId: { $in: [appId, "shared"] }, // ← Inclure catégories VIP shared
      _id: { $in: uniqueCategoryIds },
      isVip: true,
      isActive: true
    });
  }

  /**
   * Obtenir tous les abonnements d'un utilisateur
   * @param {String} appId - ID de l'application
   */
  async getUserSubscriptions(appId, userId) {
    return await Subscription.find({ 
      appId, // ⭐ AJOUT DE APPID
      user: userId 
    })
      .populate('package')
      .sort({ createdAt: -1 });
  }

  /**
   * Annuler un abonnement
   * @param {String} appId - ID de l'application
   */
  async cancelSubscription(appId, subscriptionId, userId) {
    const subscription = await Subscription.findOne({
      appId, // ⭐ AJOUT DE APPID
      _id: subscriptionId,
      user: userId
    });

    if (!subscription) {
      throw new AppError('Abonnement non trouvé', 404, ErrorCodes.NOT_FOUND);
    }

    if (subscription.status !== 'active') {
      throw new AppError('Seuls les abonnements actifs peuvent être annulés', 400, ErrorCodes.VALIDATION_ERROR);
    }

    // Pour Google Play, on ne peut pas annuler depuis notre backend
    if (subscription.paymentProvider === 'GOOGLE_PLAY') {
      throw new AppError('Les abonnements Google Play doivent être annulés depuis Google Play Store', 400, ErrorCodes.VALIDATION_ERROR);
    }

    // Annuler l'abonnement Mobile Money
    await subscription.cancel();

    // Annuler la commission associée via commissionService
    const Commission = require('../../models/common/Commission');
    const commission = await Commission.findOne({ 
      appId, // ⭐ AJOUT DE APPID
      subscription: subscriptionId 
    });
    
    if (commission && commission.status === 'pending') {
      await commissionService.cancelCommissions(appId, [commission._id], 'Abonnement annulé par utilisateur');
    }

    return subscription;
  }

  /**
   * Obtenir les statistiques des abonnements
   * @param {String} appId - ID de l'application
   */
  async getSubscriptionStats(appId) {
    const stats = await Subscription.aggregate([
      { $match: { appId } }, // ⭐ AJOUT DE APPID
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

  /**
   * Vérifier si un utilisateur peut souscrire
   * @param {String} appId - ID de l'application
   */
  async canSubscribe(appId, userId) {
    const activeSubscription = await Subscription.findOne({
      appId, // ⭐ AJOUT DE APPID
      user: userId,
      status: 'active',
      $or: [
        {
          paymentProvider: 'MOBILE_MONEY',
          endDate: { $gt: new Date() }
        },
        {
          paymentProvider: 'GOOGLE_PLAY'
        }
      ]
    });
    
    return !activeSubscription;
  }

  /**
   * Obtenir le type de provider d'un abonnement actif
   * @param {String} appId - ID de l'application
   */
  async getActiveSubscriptionProvider(appId, userId) {
    const subscription = await Subscription.findOne({
      appId, // ⭐ AJOUT DE APPID
      user: userId,
      status: 'active',
      $or: [
        {
          paymentProvider: 'MOBILE_MONEY',
          endDate: { $gt: new Date() }
        },
        {
          paymentProvider: 'GOOGLE_PLAY'
        }
      ]
    });

    return subscription ? subscription.paymentProvider : null;
  }
}

module.exports = new SubscriptionService();