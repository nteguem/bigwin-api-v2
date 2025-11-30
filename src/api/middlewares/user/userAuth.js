// src/api/middlewares/user/userAuth.js

const User = require('../../models/user/User');
const authService = require('../../services/common/authService');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const catchAsync = require('../../../utils/catchAsync');

/**
 * Middleware de protection des routes user
 */
exports.protect = catchAsync(async (req, res, next) => {
  // 1. Extraire le token
  const authHeader = req.headers.authorization;
  let token;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }
  
  if (!token) {
    return next(new AppError('Token d\'authentification requis', 401, ErrorCodes.AUTH_TOKEN_MISSING));
  }
  
  // 2. Vérifier le token
  const decoded = authService.verifyToken(token, 'user');
  
  // ⭐ 3. Récupérer l'appId de la requête (défini par identifyApp middleware)
  const appId = req.appId;
  
  if (!appId) {
    return next(new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR));
  }
  
  // ⭐ 4. Vérifier si l'utilisateur existe POUR CETTE APP
  const user = await User.findOne({ _id: decoded.id, appId });
  
  if (!user) {
    return next(new AppError('L\'utilisateur n\'existe plus ou n\'appartient pas à cette application', 401, ErrorCodes.AUTH_USER_NOT_FOUND));
  }
  
  // 5. Vérifier si l'utilisateur est actif
  if (!user.isActive) {
    return next(new AppError('Compte utilisateur désactivé', 401, ErrorCodes.AUTH_ACCOUNT_DISABLED));
  }
  
  // 6. Attacher l'utilisateur à la requête
  req.user = user;
  next();
});

/**
 * Middleware pour vérifier les refresh tokens user
 */
exports.verifyRefreshToken = catchAsync(async (req, res, next) => {
  const { refreshToken } = req.body;
  
  if (!refreshToken) {
    return next(new AppError('Refresh token requis', 401, ErrorCodes.AUTH_TOKEN_MISSING));
  }
  
  // Vérifier le refresh token
  const decoded = authService.verifyRefreshToken(refreshToken);
  
  if (decoded.type !== 'user') {
    return next(new AppError('Type de token invalide', 401, ErrorCodes.AUTH_INVALID_TOKEN));
  }
  
  // ⭐ Récupérer l'appId de la requête
  const appId = req.appId;
  
  if (!appId) {
    return next(new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR));
  }
  
  // ⭐ Vérifier si l'utilisateur existe POUR CETTE APP et possède ce refresh token
  const user = await User.findOne({ _id: decoded.id, appId }).select('+refreshTokens');
  
  if (!user || !user.refreshTokens.includes(refreshToken)) {
    return next(new AppError('Refresh token invalide', 401, ErrorCodes.AUTH_INVALID_TOKEN));
  }
  
  if (!user.isActive) {
    return next(new AppError('Compte utilisateur désactivé', 401, ErrorCodes.AUTH_ACCOUNT_DISABLED));
  }
  
  req.user = user;
  req.refreshToken = refreshToken;
  next();
});