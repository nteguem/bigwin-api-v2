// src/api/services/user/subscriptionService.js

const Subscription = require('../../models/common/Subscription');
const Package = require('../../models/common/Package');
const User = require('../../models/user/User');
const Category = require('../../models/common/Category');
const GooglePlayTransaction = require('../../models/user/GooglePlayTransaction');
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


    return subscription;
  }

  /**
   * Obtenir les informations complètes d'abonnement d'un utilisateur
   * @param {String} appId - ID de l'application
   *
   * Note : on filtre les souscriptions dont le package a été supprimé en BD
   * (populate('package') renvoie alors null). Sans ce filtre, l'accès
   * `subscription.package._id` provoquait un crash sur tous les endpoints
   * qui appellent cette méthode (login, /me, register, refresh).
   */
  async getUserSubscriptionInfo(appId, userId, lang = 'fr') {
    const activeSubscriptions = await this.getActiveSubscriptions(appId, userId);

    const validSubscriptions = activeSubscriptions.filter(sub => sub.package);
    if (validSubscriptions.length !== activeSubscriptions.length) {
      console.warn(
        `[SubscriptionService] App ${appId} / User ${userId} : ${activeSubscriptions.length - validSubscriptions.length} souscription(s) orpheline(s) ignorée(s) (package supprimé)`
      );
    }

    const activePackages = validSubscriptions.map(subscription => ({
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
      categories: (subscription.package.categories || []).map(cat => {
        if (cat && cat.name && typeof cat.name === 'object') {
          return {
            ...(cat.toObject ? cat.toObject() : cat),
            name: cat.name[lang] || cat.name.fr || cat.name,
            description: cat.description ? (cat.description[lang] || cat.description.fr || cat.description) : null
          };
        }
        return cat;
      }),
      subscriptionId: subscription._id,
      paymentProvider: subscription.paymentProvider,
      autoRenewing: subscription.autoRenewing || false
    }));

    return {
      hasActiveSubscription: validSubscriptions.length > 0,
      activePackages,
      totalActiveSubscriptions: validSubscriptions.length
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
      // Skip subscriptions orphelines (Package hard-deleted en BD)
      if (!subscription.package) continue;

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
      // Skip subscriptions orphelines
      if (!subscription.package) continue;

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

    // Multi-app : categorie VIP accessible si appIds contient l'app OU shared.
    const vipCategories = await Category.find({
      $or: [
        { appIds: appId },
        { appId: 'shared' },
      ],
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
      // Skip subscriptions orphelines
      if (!subscription.package) continue;

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

    // Multi-app : recuperer toutes les categories VIP accessibles depuis cette app.
    return await Category.find({
      $or: [
        { appIds: appId },
        { appId: 'shared' },
      ],
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

    // Clawback affiliation : annule la commission liée si elle existe.
    // Silencieux : si ça échoue on log mais on ne casse pas l'annulation
    // de l'abonnement (l'affiliation est secondaire).
    try {
      const affiliateService = require('../affiliate/affiliateService');
      await affiliateService.cancelCommissionForSubscription(
        subscription,
        'subscription_cancelled'
      );
    } catch (err) {
      console.warn(
        '[subscriptionService] cancelCommissionForSubscription failed:',
        err?.message || err
      );
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