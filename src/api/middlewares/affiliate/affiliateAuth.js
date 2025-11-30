// src/api/middlewares/affiliate/affiliateAuth.js

const Affiliate = require('../../models/affiliate/Affiliate');
const authService = require('../../services/common/authService');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const catchAsync = require('../../../utils/catchAsync');

/**
 * Middleware de protection des routes affiliate
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
  const decoded = authService.verifyToken(token, 'affiliate');
  
  // ⭐ 3. Récupérer l'appId de la requête (défini par identifyApp middleware)
  const appId = req.appId;
  
  if (!appId) {
    return next(new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR));
  }
  
  // ⭐ 4. Vérifier si l'affilié existe POUR CETTE APP
  const affiliate = await Affiliate.findOne({ _id: decoded.id, appId });
  
  if (!affiliate) {
    return next(new AppError('L\'affilié n\'existe plus ou n\'appartient pas à cette application', 401, ErrorCodes.AUTH_USER_NOT_FOUND));
  }
  
  // 5. Vérifier si l'affilié est actif
  if (!affiliate.isActive) {
    return next(new AppError('Compte affilié désactivé', 401, ErrorCodes.AUTH_ACCOUNT_DISABLED));
  }
  
  // 6. Attacher l'affilié à la requête
  req.affiliate = affiliate;
  next();
});

/**
 * Middleware pour vérifier les refresh tokens affilié
 */
exports.verifyRefreshToken = catchAsync(async (req, res, next) => {
  const { refreshToken } = req.body;
  
  if (!refreshToken) {
    return next(new AppError('Refresh token requis', 401, ErrorCodes.AUTH_TOKEN_MISSING));
  }
  
  // Vérifier le refresh token
  const decoded = authService.verifyRefreshToken(refreshToken);
  
  if (decoded.type !== 'affiliate') {
    return next(new AppError('Type de token invalide', 401, ErrorCodes.AUTH_INVALID_TOKEN));
  }
  
  // ⭐ Récupérer l'appId de la requête
  const appId = req.appId;
  
  if (!appId) {
    return next(new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR));
  }
  
  // ⭐ Vérifier si l'affilié existe POUR CETTE APP et possède ce refresh token
  const affiliate = await Affiliate.findOne({ _id: decoded.id, appId }).select('+refreshTokens');
  
  if (!affiliate || !affiliate.refreshTokens.includes(refreshToken)) {
    return next(new AppError('Refresh token invalide', 401, ErrorCodes.AUTH_INVALID_TOKEN));
  }
  
  if (!affiliate.isActive) {
    return next(new AppError('Compte affilié désactivé', 401, ErrorCodes.AUTH_ACCOUNT_DISABLED));
  }
  
  req.affiliate = affiliate;
  req.refreshToken = refreshToken;
  next();
});