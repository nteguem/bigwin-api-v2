const User = require('../../models/user/User');
const authService = require('../../services/common/authService');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const catchAsync = require('../../../utils/catchAsync');

/**
 * Inscription utilisateur
 */
exports.register = catchAsync(async (req, res, next) => {
  const { phone, password, firstName, lastName, email, affiliateCode } = req.body;
  
  // Validation des champs obligatoires
  if (!phone || !password) {
    return next(new AppError('Téléphone et mot de passe requis', 400, ErrorCodes.VALIDATION_ERROR));
  }
  
  // Vérifier si le numéro existe déjà
  const existingUser = await User.findOne({ phone });
  if (existingUser) {
    return next(new AppError('Ce numéro de téléphone est déjà utilisé', 400, ErrorCodes.VALIDATION_ERROR));
  }
  
  // Valider le code affilié si fourni
  let affiliate = null;
  if (affiliateCode) {
    try {
      affiliate = await authService.validateAffiliateCode(affiliateCode);
    } catch (error) {
      return next(error);
    }
  }
  
  // Créer l'utilisateur
  const user = await User.create({
    phone,
    password,
    firstName,
    lastName,
    email,
    referredBy: affiliate?._id
  });
  
  // Générer les tokens
  const tokens = authService.generateTokens(user._id, 'user');
  
  // Sauvegarder le refresh token
  user.refreshTokens.push(tokens.refreshToken);
  await user.save();
  
  // Réponse
  res.status(201).json(authService.formatAuthResponse(user, tokens, 'Inscription réussie'));
});

/**
 * Connexion utilisateur
 */
exports.login = catchAsync(async (req, res, next) => {
  const { phone, password } = req.body;
  
  // Validation des champs
  if (!phone || !password) {
    return next(new AppError('Téléphone et mot de passe requis', 400, ErrorCodes.VALIDATION_ERROR));
  }
  
  // Trouver l'utilisateur avec le mot de passe
  const user = await User.findOne({ phone }).select('+password +refreshTokens');
  
  if (!user || !(await user.comparePassword(password))) {
    return next(new AppError('Téléphone ou mot de passe incorrect', 401, ErrorCodes.AUTH_INVALID_CREDENTIALS));
  }
  
  // Vérifier si le compte est actif
  if (!user.isActive) {
    return next(new AppError('Compte utilisateur désactivé', 401, ErrorCodes.AUTH_ACCOUNT_DISABLED));
  }
  
  // Générer les tokens
  const tokens = authService.generateTokens(user._id, 'user');
  
  // Sauvegarder le refresh token
  user.refreshTokens.push(tokens.refreshToken);
  await user.save();
  
  // Réponse
  res.status(200).json(authService.formatAuthResponse(user, tokens, 'Connexion réussie'));
});

/**
 * Déconnexion utilisateur
 */
exports.logout = catchAsync(async (req, res, next) => {
  const { refreshToken } = req.body;
  
  if (refreshToken && req.user) {
    // Supprimer le refresh token spécifique
    req.user.refreshTokens = req.user.refreshTokens.filter(token => token !== refreshToken);
    await req.user.save();
  }
  
  res.status(200).json({
    success: true,
    message: 'Déconnexion réussie'
  });
});

/**
 * Déconnexion globale (tous les appareils)
 */
exports.logoutAll = catchAsync(async (req, res, next) => {
  // Supprimer tous les refresh tokens
  req.user.refreshTokens = [];
  await req.user.save();
  
  res.status(200).json({
    success: true,
    message: 'Déconnexion de tous les appareils réussie'
  });
});

/**
 * Renouveler le token d'accès
 */
exports.refresh = catchAsync(async (req, res, next) => {
  // req.user et req.refreshToken sont définis par le middleware verifyRefreshToken
  
  // Générer un nouveau token d'accès
  const tokens = authService.generateTokens(req.user._id, 'user');
  
  // Remplacer l'ancien refresh token par le nouveau
  const tokenIndex = req.user.refreshTokens.indexOf(req.refreshToken);
  req.user.refreshTokens[tokenIndex] = tokens.refreshToken;
  await req.user.save();
  
  res.status(200).json({
    success: true,
    message: 'Token renouvelé avec succès',
    data: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken
    }
  });
});

/**
 * Obtenir les informations de l'utilisateur connecté
 */
exports.getMe = catchAsync(async (req, res, next) => {
  // Populer les infos de l'affilié parrain si existant
  const user = await User.findById(req.user._id).populate('referredBy', 'firstName lastName affiliateCode');
  
  res.status(200).json({
    success: true,
    data: {
      user
    }
  });
});

/**
 * Modifier le profil de l'utilisateur connecté
 */
exports.updateMe = catchAsync(async (req, res, next) => {
  const { firstName, lastName, email } = req.body;
  
  // Mettre à jour uniquement les champs autorisés
  const updatedUser = await User.findByIdAndUpdate(
    req.user._id,
    { firstName, lastName, email },
    { new: true, runValidators: true }
  );
  
  res.status(200).json({
    success: true,
    message: 'Profil mis à jour avec succès',
    data: {
      user: updatedUser
    }
  });
});

/**
 * Changer le mot de passe de l'utilisateur connecté
 */
exports.changePassword = catchAsync(async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;
  
  if (!currentPassword || !newPassword) {
    return next(new AppError('Mot de passe actuel et nouveau mot de passe requis', 400, ErrorCodes.VALIDATION_ERROR));
  }
  
  // Récupérer l'utilisateur avec le mot de passe
  const user = await User.findById(req.user._id).select('+password');
  
  // Vérifier le mot de passe actuel
  if (!(await user.comparePassword(currentPassword))) {
    return next(new AppError('Mot de passe actuel incorrect', 400, ErrorCodes.AUTH_INVALID_CREDENTIALS));
  }
  
  // Mettre à jour le mot de passe
  user.password = newPassword;
  await user.save();
  
  res.status(200).json({
    success: true,
    message: 'Mot de passe modifié avec succès'
  });
});