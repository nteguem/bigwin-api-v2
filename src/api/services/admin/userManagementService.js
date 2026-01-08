// src/api/services/admin/userManagementService.js

const User = require('../../models/user/User');
const Subscription = require('../../models/common/Subscription');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

class UserManagementService {
  /**
   * Récupérer tous les utilisateurs avec filtres avancés
   * @param {String} appId - ID de l'application
   * @param {Object} filters - Filtres de recherche
   * @param {Object} options - Options de pagination et tri
   */
  async getAllUsers(appId, filters = {}, options = {}) {
    const {
      search,
      country,
      city,
      startDate,
      endDate,
      authProvider,
      isActive,
      hasSubscription
    } = filters;

    const {
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = options;

    // 🔍 DEBUG
    console.log('📊 [UserService] getAllUsers - appId:', appId);
    console.log('📊 [UserService] filters:', filters);

    // Construction de la query MongoDB
    const query = { appId };
    
    // 🔍 DEBUG - Compter TOUS les users
    const totalInDb = await User.countDocuments({});
    const totalForApp = await User.countDocuments({ appId });
    console.log('📊 [UserService] Total users dans DB:', totalInDb);
    console.log('📊 [UserService] Total users pour appId:', totalForApp);

    // Filtre de recherche (nom, prénom, pseudo, email, téléphone)
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { pseudo: searchRegex },
        { email: searchRegex },
        { phoneNumber: searchRegex }
      ];
    }

    // Filtre par pays
    if (country) {
      query.countryCode = country.toUpperCase();
    }

    // Filtre par ville
    if (city) {
      query.city = new RegExp(city, 'i');
    }

    // Filtre par intervalle de dates
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }

    // Filtre par type d'authentification
    if (authProvider) {
      query.authProvider = authProvider;
    }

    // Filtre par statut actif/inactif
    if (isActive !== undefined) {
      query.isActive = isActive === 'true' || isActive === true;
    }

    // Calcul de la pagination
    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    // 🔍 DEBUG - Afficher la query finale
    console.log('📊 [UserService] Query MongoDB finale:', JSON.stringify(query));

    // Exécution de la requête avec population
    const users = await User.find(query)
      .populate('referredBy', 'firstName lastName affiliateCode')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Compter le total
    const total = await User.countDocuments(query);

    // Si filtre par abonnement, on doit vérifier chaque user
    let filteredUsers = users;
    if (hasSubscription !== undefined && hasSubscription !== '' && hasSubscription !== null) {
      const shouldHaveSub = hasSubscription === 'true' || hasSubscription === true;
      
      const usersWithSubStatus = await Promise.all(
        users.map(async (user) => {
          const activeSub = await Subscription.findOne({
            appId,
            userId: user._id,
            status: 'active',
            endDate: { $gt: new Date() }
          });
          return {
            ...user,
            hasActiveSubscription: !!activeSub
          };
        })
      );

      filteredUsers = usersWithSubStatus.filter(
        u => u.hasActiveSubscription === shouldHaveSub
      );
    } else {
      // Ajouter l'info d'abonnement même sans filtre
      filteredUsers = await Promise.all(
        users.map(async (user) => {
          const activeSub = await Subscription.findOne({
            appId,
            userId: user._id,
            status: 'active',
            endDate: { $gt: new Date() }
          });
          return {
            ...user,
            hasActiveSubscription: !!activeSub
          };
        })
      );
    }

    return {
      users: filteredUsers,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Récupérer un utilisateur par ID
   * @param {String} appId - ID de l'application
   * @param {String} userId - ID de l'utilisateur
   */
  async getUserById(appId, userId) {
    const user = await User.findOne({ _id: userId, appId })
      .populate('referredBy', 'firstName lastName affiliateCode email')
      .lean();

    if (!user) {
      throw new AppError('Utilisateur non trouvé', 404, ErrorCodes.NOT_FOUND);
    }

    // Récupérer les abonnements actifs
    const activeSubscriptions = await Subscription.find({
      appId,
      userId,
      status: 'active',
      endDate: { $gt: new Date() }
    }).populate('packageId', 'name price');

    // Récupérer l'historique des abonnements
    const subscriptionHistory = await Subscription.find({
      appId,
      userId
    })
      .populate('packageId', 'name price')
      .sort({ createdAt: -1 })
      .limit(10);

    return {
      user,
      activeSubscriptions,
      subscriptionHistory
    };
  }

  /**
   * Mettre à jour un utilisateur
   * @param {String} appId - ID de l'application
   * @param {String} userId - ID de l'utilisateur
   * @param {Object} updateData - Données à mettre à jour
   */
  async updateUser(appId, userId, updateData) {
    const allowedUpdates = [
      'firstName',
      'lastName',
      'pseudo',
      'email',
      'city',
      'countryCode',
      'isActive'
    ];

    const updates = {};
    Object.keys(updateData).forEach(key => {
      if (allowedUpdates.includes(key)) {
        updates[key] = updateData[key];
      }
    });

    const user = await User.findOneAndUpdate(
      { _id: userId, appId },
      updates,
      { new: true, runValidators: true }
    ).populate('referredBy', 'firstName lastName affiliateCode');

    if (!user) {
      throw new AppError('Utilisateur non trouvé', 404, ErrorCodes.NOT_FOUND);
    }

    return user;
  }

  /**
   * Activer/Désactiver un utilisateur
   * @param {String} appId - ID de l'application
   * @param {String} userId - ID de l'utilisateur
   * @param {Boolean} isActive - Statut actif/inactif
   */
  async toggleUserStatus(appId, userId, isActive) {
    const user = await User.findOneAndUpdate(
      { _id: userId, appId },
      { isActive },
      { new: true }
    );

    if (!user) {
      throw new AppError('Utilisateur non trouvé', 404, ErrorCodes.NOT_FOUND);
    }

    return user;
  }

  /**
   * Réinitialiser le mot de passe d'un utilisateur
   * @param {String} appId - ID de l'application
   * @param {String} userId - ID de l'utilisateur
   * @param {String} newPassword - Nouveau mot de passe
   */
  async resetUserPassword(appId, userId, newPassword) {
    const user = await User.findOne({ _id: userId, appId });

    if (!user) {
      throw new AppError('Utilisateur non trouvé', 404, ErrorCodes.NOT_FOUND);
    }

    if (user.authProvider !== 'local') {
      throw new AppError(
        'Impossible de réinitialiser le mot de passe pour un compte Google',
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    user.password = newPassword;
    user.refreshTokens = []; // Déconnecter l'utilisateur de tous les appareils
    await user.save();

    return user;
  }

  /**
   * Supprimer un utilisateur
   * @param {String} appId - ID de l'application
   * @param {String} userId - ID de l'utilisateur
   */
  async deleteUser(appId, userId) {
    const user = await User.findOneAndDelete({ _id: userId, appId });

    if (!user) {
      throw new AppError('Utilisateur non trouvé', 404, ErrorCodes.NOT_FOUND);
    }

    // Supprimer les abonnements liés
    await Subscription.deleteMany({ appId, userId });

    return user;
  }

  /**
   * Obtenir les statistiques des utilisateurs
   * @param {String} appId - ID de l'application
   */
  async getUserStats(appId) {
    const totalUsers = await User.countDocuments({ appId });
    const activeUsers = await User.countDocuments({ appId, isActive: true });
    const inactiveUsers = await User.countDocuments({ appId, isActive: false });
    
    const localUsers = await User.countDocuments({ 
      appId, 
      authProvider: 'local' 
    });
    
    const googleUsers = await User.countDocuments({ 
      appId, 
      authProvider: 'google' 
    });

    // Utilisateurs avec abonnement actif
    const activeSubscriptions = await Subscription.countDocuments({
      appId,
      status: 'active',
      endDate: { $gt: new Date() }
    });

    // Nouveaux utilisateurs (7 derniers jours)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const newUsersLastWeek = await User.countDocuments({
      appId,
      createdAt: { $gte: sevenDaysAgo }
    });

    // Nouveaux utilisateurs (30 derniers jours)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const newUsersLastMonth = await User.countDocuments({
      appId,
      createdAt: { $gte: thirtyDaysAgo }
    });

    // Répartition par pays (top 10)
    const usersByCountry = await User.aggregate([
      { $match: { appId } },
      { $group: { _id: '$countryCode', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    return {
      totalUsers,
      activeUsers,
      inactiveUsers,
      localUsers,
      googleUsers,
      usersWithActiveSubscription: activeSubscriptions,
      newUsersLastWeek,
      newUsersLastMonth,
      usersByCountry
    };
  }
}

module.exports = new UserManagementService();