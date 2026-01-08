// src/api/controllers/admin/userController.js

const userManagementService = require('../../services/admin/userManagementService');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const catchAsync = require('../../../utils/catchAsync');

/**
 * Récupérer tous les utilisateurs avec filtres
 * GET /api/admin/users
 */
exports.getAllUsers = catchAsync(async (req, res, next) => {
  const appId = req.appId;
  
  // 🔍 DEBUG
  console.log('🔍 [UserController] appId reçu:', appId);
  console.log('🔍 [UserController] query params:', req.query);

  // Extraction des filtres depuis query params
  const filters = {
    search: req.query.search,           // Recherche nom/prénom/pseudo/email/téléphone
    country: req.query.country,         // Code pays (ex: CM, FR)
    city: req.query.city,               // Ville
    startDate: req.query.startDate,     // Date de début (ISO format)
    endDate: req.query.endDate,         // Date de fin (ISO format)
    authProvider: req.query.authProvider, // local ou google
    isActive: req.query.isActive,       // true ou false
    hasSubscription: req.query.hasSubscription // true ou false
  };

  // Options de pagination et tri
  const options = {
    page: req.query.page || 1,
    limit: req.query.limit || 20,
    sortBy: req.query.sortBy || 'createdAt',
    sortOrder: req.query.sortOrder || 'desc'
  };

  const result = await userManagementService.getAllUsers(appId, filters, options);

  res.status(200).json({
    success: true,
    data: {
      users: result.users,
      pagination: result.pagination
    }
  });
});

/**
 * Récupérer un utilisateur par ID
 * GET /api/admin/users/:id
 */
exports.getUser = catchAsync(async (req, res, next) => {
  const appId = req.appId;
  const userId = req.params.id;

  const result = await userManagementService.getUserById(appId, userId);

  res.status(200).json({
    success: true,
    data: result
  });
});

/**
 * Mettre à jour un utilisateur
 * PUT /api/admin/users/:id
 */
exports.updateUser = catchAsync(async (req, res, next) => {
  const appId = req.appId;
  const userId = req.params.id;
  const updateData = req.body;

  const user = await userManagementService.updateUser(appId, userId, updateData);

  res.status(200).json({
    success: true,
    message: 'Utilisateur mis à jour avec succès',
    data: { user }
  });
});

/**
 * Activer/Désactiver un utilisateur
 * PATCH /api/admin/users/:id/toggle-status
 */
exports.toggleUserStatus = catchAsync(async (req, res, next) => {
  const appId = req.appId;
  const userId = req.params.id;
  const { isActive } = req.body;

  if (isActive === undefined) {
    return next(new AppError('Le champ isActive est requis', 400, ErrorCodes.VALIDATION_ERROR));
  }

  const user = await userManagementService.toggleUserStatus(appId, userId, isActive);

  res.status(200).json({
    success: true,
    message: `Utilisateur ${isActive ? 'activé' : 'désactivé'} avec succès`,
    data: { user }
  });
});

/**
 * Réinitialiser le mot de passe d'un utilisateur
 * PATCH /api/admin/users/:id/reset-password
 */
exports.resetPassword = catchAsync(async (req, res, next) => {
  const appId = req.appId;
  const userId = req.params.id;
  const { newPassword } = req.body;

  if (!newPassword) {
    return next(new AppError('Le nouveau mot de passe est requis', 400, ErrorCodes.VALIDATION_ERROR));
  }

  if (newPassword.length < 6) {
    return next(new AppError('Le mot de passe doit contenir au moins 6 caractères', 400, ErrorCodes.VALIDATION_ERROR));
  }

  await userManagementService.resetUserPassword(appId, userId, newPassword);

  res.status(200).json({
    success: true,
    message: 'Mot de passe réinitialisé avec succès'
  });
});

/**
 * Supprimer un utilisateur
 * DELETE /api/admin/users/:id
 */
exports.deleteUser = catchAsync(async (req, res, next) => {
  const appId = req.appId;
  const userId = req.params.id;

  await userManagementService.deleteUser(appId, userId);

  res.status(200).json({
    success: true,
    message: 'Utilisateur supprimé avec succès'
  });
});

/**
 * Obtenir les statistiques des utilisateurs
 * GET /api/admin/users/stats
 */
exports.getUserStats = catchAsync(async (req, res, next) => {
  const appId = req.appId;

  const stats = await userManagementService.getUserStats(appId);

  res.status(200).json({
    success: true,
    data: { stats }
  });
});