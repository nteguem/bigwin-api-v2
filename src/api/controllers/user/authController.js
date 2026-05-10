// src/api/controllers/user/authController.js

const User = require('../../models/user/User');
const authService = require('../../services/common/authService');
const googleAuthService = require('../../services/common/googleAuthService');
const subscriptionService = require('../../services/user/subscriptionService');
const deviceService = require('../../services/common/deviceService');
const affiliateService = require('../../services/affiliate/affiliateService');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const catchAsync = require('../../../utils/catchAsync');
const logger = require('../../../core/logger');

const SERVICE = 'auth';

/**
 * Inscription utilisateur avec génération automatique d'email
 */
exports.register = catchAsync(async (req, res, next) => {
  const { phoneNumber, countryCode, dialCode, password, pseudo, city, deviceId, firebaseAppInstanceId, acquisitionSource, acquisitionGclid, affiliateCode } = req.body;

  // ⭐ RÉCUPÉRER APPID depuis req
  const appId = req.appId;

  // Validation des champs obligatoires
  if (!phoneNumber || !password) {
    return next(new AppError('Téléphone et mot de passe requis', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // Vérifier si le numéro existe déjà POUR CETTE APP
  const existingUser = await User.findOne({ appId, phoneNumber });
  if (existingUser) {
    return next(new AppError('Ce numéro de téléphone est déjà utilisé', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // Générer l'email automatiquement avec vérification d'unicité POUR CETTE APP
  const generatedEmail = await generateUniqueUserEmail(appId, phoneNumber, pseudo, countryCode);

  // Construire l'objet acquisition uniquement si le mobile a envoyé une source
  // valide (sinon laisser null pour les anciens clients pré-sprint tracking)
  const acquisition = acquisitionSource && ['google_ads', 'organique'].includes(acquisitionSource)
    ? {
        source: acquisitionSource,
        gclid: acquisitionGclid || null,
        capturedAt: new Date()
      }
    : undefined;

  // Créer l'utilisateur AVEC APPID
  const user = await User.create({
    appId,
    phoneNumber,
    email: generatedEmail,
    password,
    pseudo,
    dialCode,
    countryCode,
    city,
    authProvider: 'local',
    emailVerified: false,
    firebaseAppInstanceId: firebaseAppInstanceId || null,
    ...(acquisition && { acquisition })
  });

  // Capture du code de parrainage si fourni — ne casse jamais le signup,
  // crée silencieusement un Referral en self_ref / country_mismatch /
  // signed_up selon les règles métier.
  if (affiliateCode) {
    try {
      await affiliateService.createReferralAtSignup(user, affiliateCode);
    } catch (err) {
      logger.warn('affiliate referral failed at signup', {
        service: SERVICE,
        category: 'affiliateReferral',
        userId: user._id,
        error: err.message,
      });
    }
  }
  
  // Générer les tokens
  const tokens = authService.generateTokens(user._id, 'user');
  
  // Sauvegarder le refresh token
  user.refreshTokens.push(tokens.refreshToken);
  await user.save();
  
  // Lier le device au user
  let device = null;
  if (deviceId) {
    try {
      device = await deviceService.linkDeviceToUser(appId, deviceId, user._id);
    } catch (error) {
      req.log.error('device link failed', {
        service: SERVICE,
        category: 'deviceLink',
        message: error.message,
        stack: error.stack,
      });
    }
  }
  
  // Vérifier s'il a un abonnement actif (normalement false pour un nouveau user)
  const subscriptionInfo = await subscriptionService.getUserSubscriptionInfo(appId, user._id, req.query?.lang || 'fr');
  
  // Réponse avec l'info d'abonnement et device
  const response = authService.formatAuthResponse(user, tokens, 'Inscription réussie');
  response.data.hasActiveSubscription = subscriptionInfo.hasActiveSubscription;
  response.data.activePackages = subscriptionInfo.activePackages;
  response.data.device = device;
  
  res.status(201).json(response);
});

// Fonction pour générer automatiquement un email utilisateur avec vérification d'unicité
async function generateUniqueUserEmail(appId, phoneNumber, pseudo, countryCode) {
  const cleanPhone = phoneNumber.replace(/[^\d]/g, '');
  const domain = "bigwinpronos.com";
  let baseEmail = `user${cleanPhone}@${domain}`;
  let finalEmail = baseEmail;
  let counter = 1;
  
  // Vérifier l'unicité POUR CETTE APP
  while (await User.findOne({ appId, email: finalEmail })) {
    finalEmail = `user${cleanPhone}${counter}@${domain}`;
    counter++;
  }
  
  return finalEmail;
}

/**
 * Connexion utilisateur classique (téléphone + mot de passe)
 */
exports.login = catchAsync(async (req, res, next) => {
  const { phoneNumber, password, deviceId, firebaseAppInstanceId, acquisitionSource, acquisitionGclid } = req.body;
  
  // ⭐ RÉCUPÉRER APPID depuis req
  const appId = req.appId;
  
  // Validation des champs
  if (!phoneNumber || !password) {
    return next(new AppError('Téléphone et mot de passe requis', 400, ErrorCodes.VALIDATION_ERROR));
  }
  
  // Trouver l'utilisateur avec le mot de passe POUR CETTE APP
  const user = await User.findOne({ appId, phoneNumber }).select('+password +refreshTokens');
  if (!user || !(await user.comparePassword(password))) {
    return next(new AppError('Téléphone ou mot de passe incorrect', 401, ErrorCodes.AUTH_INVALID_CREDENTIALS));
  }
  
  // Vérifier si le compte est actif
  if (!user.isActive) {
    return next(new AppError('Compte utilisateur désactivé', 401, ErrorCodes.AUTH_ACCOUNT_DISABLED));
  }
  
  // Générer les tokens
  const tokens = authService.generateTokens(user._id, 'user');

  // Sauvegarder le refresh token + firebaseAppInstanceId si fourni par le mobile
  user.refreshTokens.push(tokens.refreshToken);
  if (firebaseAppInstanceId) {
    user.firebaseAppInstanceId = firebaseAppInstanceId;
  }
  // Acquisition : premier capture wins. On set uniquement si jamais set.
  // Ça gère les users existants qui se reconnectent avec une app à jour :
  // ils sont taggés à leur 1er login post-update au lieu d'être perdus.
  if (
    acquisitionSource &&
    ['google_ads', 'organique'].includes(acquisitionSource) &&
    (!user.acquisition || !user.acquisition.source)
  ) {
    user.acquisition = {
      source: acquisitionSource,
      gclid: acquisitionGclid || null,
      capturedAt: new Date()
    };
  }
  await user.save();

  // Lier le device au user
  let device = null;
  if (deviceId) {
    try {
      device = await deviceService.linkDeviceToUser(appId, deviceId, user._id);
    } catch (error) {
      req.log.error('device link failed', {
        service: SERVICE,
        category: 'deviceLink',
        message: error.message,
        stack: error.stack,
      });
    }
  }

  // Vérifier s'il a un abonnement actif
  const subscriptionInfo = await subscriptionService.getUserSubscriptionInfo(appId, user._id, req.query?.lang || 'fr');

  // Réponse avec l'info d'abonnement et device
  const response = authService.formatAuthResponse(user, tokens, 'Connexion réussie');
  response.data.hasActiveSubscription = subscriptionInfo.hasActiveSubscription;
  response.data.activePackages = subscriptionInfo.activePackages;
  response.data.device = device;
  
  req.log.info('login success', {
    service: SERVICE,
    category: 'login',
    userId: String(user._id),
  });

  res.status(200).json(response);
});

/**
 * Authentification avec Google (login + register combiné)
 */
exports.googleAuth = catchAsync(async (req, res, next) => {
  const { idToken, city, countryCode, deviceId, firebaseAppInstanceId, acquisitionSource, acquisitionGclid, affiliateCode } = req.body;

  // ⭐ RÉCUPÉRER APPID depuis req
  const appId = req.appId;

  // Validation
  if (!idToken) {
    return next(new AppError('Token Google requis', 400, ErrorCodes.VALIDATION_ERROR));
  }

  try {
    // 1. Vérifier et décoder le token Google - ⭐ PASSER APPID
    const googleData = await googleAuthService.verifyGoogleToken(appId, idToken);
    req.log.info('google auth: token verified', {
      service: SERVICE,
      category: 'googleAuth',
      email: googleData.email,
    });

    // 2. Créer ou récupérer l'utilisateur POUR CETTE APP - ⭐ PASSER APPID
    const { user, isNewUser } = await googleAuthService.findOrCreateGoogleUser(appId, googleData, {
      city,
      countryCode,
      acquisitionSource,
      acquisitionGclid
    });

    // Si nouvel user + code affilié fourni → créer le Referral
    if (isNewUser && affiliateCode) {
      try {
        await affiliateService.createReferralAtSignup(user, affiliateCode);
      } catch (err) {
        req.log?.warn?.('affiliate referral failed at google signup', {
          service: SERVICE,
          userId: user._id,
          error: err.message,
        });
      }
    }
    
    // 3. Vérifier si le compte est actif
    if (!user.isActive) {
      return next(new AppError('Compte utilisateur désactivé', 401, ErrorCodes.AUTH_ACCOUNT_DISABLED));
    }
    
    // 4. Générer les tokens JWT de votre app
    const tokens = authService.generateTokens(user._id, 'user');
    
    // 5. Sauvegarder le refresh token + firebaseAppInstanceId si fourni
    if (!user.refreshTokens) {
      user.refreshTokens = [];
    }
    user.refreshTokens.push(tokens.refreshToken);
    if (firebaseAppInstanceId) {
      user.firebaseAppInstanceId = firebaseAppInstanceId;
    }
    // Acquisition : premier capture wins (cas d'un user Google existant qui
    // se reconnecte avec une app à jour mais n'avait pas été taggé à la
    // création). Pour un nouveau user, le service l'a déjà set à la création.
    if (
      !isNewUser &&
      acquisitionSource &&
      ['google_ads', 'organique'].includes(acquisitionSource) &&
      (!user.acquisition || !user.acquisition.source)
    ) {
      user.acquisition = {
        source: acquisitionSource,
        gclid: acquisitionGclid || null,
        capturedAt: new Date()
      };
    }
    await user.save();
    
    // 6. Lier le device si fourni
    let device = null;
    if (deviceId) {
      try {
        device = await deviceService.linkDeviceToUser(appId, deviceId, user._id);
      } catch (error) {
        req.log.error('device link failed', {
        service: SERVICE,
        category: 'deviceLink',
        message: error.message,
        stack: error.stack,
      });
      }
    }
    
    // 7. Vérifier l'abonnement
    const subscriptionInfo = await subscriptionService.getUserSubscriptionInfo(appId, user._id, req.query?.lang || 'fr');
    
    // 8. Préparer la réponse
    const message = isNewUser 
      ? `Bienvenue ${user.firstName || user.pseudo} ! Votre compte a été créé avec succès.`
      : `Bon retour ${user.firstName || user.pseudo} !`;
    
    // 9. Formater et envoyer la réponse
    const response = {
      success: true,
      message,
      data: {
        user: {
          id: user._id,
          email: user.email,
          pseudo: user.pseudo,
          firstName: user.firstName,
          lastName: user.lastName,
          profilePicture: user.profilePicture,
          authProvider: user.authProvider,
          emailVerified: user.emailVerified,
          city: user.city,
          countryCode: user.countryCode,
          isNewUser
        },
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        hasActiveSubscription: subscriptionInfo.hasActiveSubscription,
        activePackages: subscriptionInfo.activePackages,
        device
      }
    };
    
    res.status(isNewUser ? 201 : 200).json(response);
    
  } catch (error) {
    req.log.error('google auth: failed', {
      service: SERVICE,
      category: 'googleAuth',
      message: error.message,
      stack: error.stack,
    });

    if (error.message && error.message.includes('Token used too late')) {
      return next(new AppError('Token Google expiré, veuillez vous reconnecter', 401, ErrorCodes.AUTH_INVALID_TOKEN));
    }
    
    if (error instanceof AppError) {
      return next(error);
    }
    
    return next(new AppError('Erreur lors de l\'authentification Google', 500, ErrorCodes.INTERNAL_ERROR));
  }
});

/**
 * Déconnexion utilisateur
 */
exports.logout = catchAsync(async (req, res, next) => {
  const { refreshToken } = req.body;
  
  if (refreshToken && req.user) {
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
  // ⭐ RÉCUPÉRER APPID depuis req
  const appId = req.appId;
  
  // Générer un nouveau token d'accès
  const tokens = authService.generateTokens(req.user._id, 'user');
  
  // Remplacer l'ancien refresh token par le nouveau
  const tokenIndex = req.user.refreshTokens.indexOf(req.refreshToken);
  req.user.refreshTokens[tokenIndex] = tokens.refreshToken;
  await req.user.save();
  
  // Vérifier s'il a un abonnement actif lors du refresh
  const subscriptionInfo = await subscriptionService.getUserSubscriptionInfo(appId, req.user._id, req.query?.lang || 'fr');
  
  res.status(200).json({
    success: true,
    message: 'Token renouvelé avec succès',
    data: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      hasActiveSubscription: subscriptionInfo.hasActiveSubscription,
      activePackages: subscriptionInfo.activePackages
    }
  });
});

/**
 * Obtenir les informations de l'utilisateur connecté
 */
exports.getMe = catchAsync(async (req, res, next) => {
  // ⭐ RÉCUPÉRER APPID depuis req
  const appId = req.appId;

  const user = await User.findById(req.user._id);

  // Vérifier s'il a un abonnement actif
  const subscriptionInfo = await subscriptionService.getUserSubscriptionInfo(appId, req.user._id, req.query?.lang || 'fr');
  
  res.status(200).json({
    success: true,
    data: {
      user,
      hasActiveSubscription: subscriptionInfo.hasActiveSubscription,
      activePackages: subscriptionInfo.activePackages
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

/**
 * Réinitialisation du mot de passe utilisateur
 */
exports.resetPassword = catchAsync(async (req, res, next) => {
  const { phoneNumber, pseudo, newPassword } = req.body;

  // ⭐ RÉCUPÉRER APPID depuis req
  const appId = req.appId;

  // Validation des champs obligatoires
  if (!phoneNumber || !pseudo || !newPassword) {
    return next(new AppError('Téléphone, pseudo et nouveau mot de passe requis', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // Validation longueur mot de passe
  if (newPassword.length < 6) {
    return next(new AppError('Le mot de passe doit contenir au moins 6 caractères', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // Trouver l'utilisateur avec phoneNumber ET pseudo POUR CETTE APP
  const user = await User.findOne({ 
    appId,
    phoneNumber, 
    pseudo 
  });

  if (!user) {
    return next(new AppError('Aucun compte trouvé avec ce numéro de téléphone et ce pseudo', 404, ErrorCodes.AUTH_USER_NOT_FOUND));
  }

  // Vérifier si le compte est actif
  if (!user.isActive) {
    return next(new AppError('Compte utilisateur désactivé', 401, ErrorCodes.AUTH_ACCOUNT_DISABLED));
  }

  // Mettre à jour le mot de passe
  user.password = newPassword;
  
  // Invalider tous les refresh tokens existants pour forcer une nouvelle connexion
  user.refreshTokens = [];
  
  await user.save();

  res.status(200).json({
    success: true,
    message: 'Mot de passe réinitialisé avec succès. Veuillez vous reconnecter.'
  });
});