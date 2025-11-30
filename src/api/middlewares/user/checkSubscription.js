// src/api/middlewares/user/checkSubscription.js

const Category = require('../../models/common/Category');
const subscriptionService = require('../../services/user/subscriptionService');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const catchAsync = require('../../../utils/catchAsync');

/**
 * Middleware pour vérifier l'accès aux contenus VIP
 * Utilise req.user (défini par userAuth) et categoryId depuis params ou body
 */
exports.checkVipAccess = catchAsync(async (req, res, next) => {
  // ⭐ Récupérer appId
  const appId = req.appId;
  
  if (!appId) {
    return next(new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR));
  }
  
  // Récupérer categoryId depuis les paramètres ou le body
  const categoryId = req.params.categoryId || req.body.categoryId || req.query.categoryId;
  
  if (!categoryId) {
    return next(new AppError('ID de catégorie requis', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // ⭐ Récupérer la catégorie POUR CETTE APP
  const category = await Category.findOne({ _id: categoryId, appId });
  
  if (!category) {
    return next(new AppError('Catégorie non trouvée', 404, ErrorCodes.NOT_FOUND));
  }

  // Si la catégorie est gratuite, autoriser l'accès
  if (!category.isVip) {
    return next();
  }

  // Pour les catégories VIP, vérifier l'abonnement
  if (!req.user) {
    return next(new AppError('Authentification requise pour accéder au contenu VIP', 401, ErrorCodes.AUTH_TOKEN_MISSING));
  }

  // ⭐ Vérifier si l'utilisateur a un abonnement actif pour cette catégorie DANS CETTE APP
  const hasAccess = await subscriptionService.hasAccessToCategory(appId, req.user._id, categoryId);
  
  if (!hasAccess) {
    return next(new AppError('Abonnement VIP requis pour accéder à ce contenu', 403, ErrorCodes.SUBSCRIPTION_REQUIRED));
  }

  // Attacher la catégorie à la requête pour usage ultérieur
  req.category = category;
  next();
});

/**
 * Middleware pour vérifier l'accès aux tickets VIP
 * Utilise le ticket pour récupérer la catégorie
 */
exports.checkTicketAccess = catchAsync(async (req, res, next) => {
  // ⭐ Récupérer appId
  const appId = req.appId;
  
  if (!appId) {
    return next(new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR));
  }
  
  const ticketId = req.params.ticketId || req.params.id;
  
  if (!ticketId) {
    return next(new AppError('ID de ticket requis', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // ⭐ Récupérer le ticket avec sa catégorie POUR CETTE APP
  const Ticket = require('../../models/common/Ticket');
  const ticket = await Ticket.findOne({ _id: ticketId, appId }).populate('category');
  
  if (!ticket) {
    return next(new AppError('Ticket non trouvé', 404, ErrorCodes.NOT_FOUND));
  }

  // Si la catégorie est gratuite, autoriser l'accès
  if (!ticket.category.isVip) {
    req.ticket = ticket;
    return next();
  }

  // Pour les catégories VIP, vérifier l'abonnement
  if (!req.user) {
    return next(new AppError('Authentification requise pour accéder au contenu VIP', 401, ErrorCodes.AUTH_TOKEN_MISSING));
  }

  // ⭐ Vérifier si l'utilisateur a un abonnement actif pour cette catégorie DANS CETTE APP
  const hasAccess = await subscriptionService.hasAccessToCategory(appId, req.user._id, ticket.category._id);
  
  if (!hasAccess) {
    return next(new AppError('Abonnement VIP requis pour accéder à ce contenu', 403, ErrorCodes.SUBSCRIPTION_REQUIRED));
  }

  // Attacher le ticket à la requête
  req.ticket = ticket;
  next();
});

/**
 * Middleware pour vérifier l'accès VIP pour les coupons
 */
exports.checkCouponsVipAccess = catchAsync(async (req, res, next) => {
  const { isVip } = req.query;
  
  // Si on ne demande pas les coupons VIP, pas de vérification nécessaire
  if (isVip !== 'true') {
    return next();
  }

  // ⭐ Récupérer appId
  const appId = req.appId;
  
  if (!appId) {
    return next(new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // Pour les coupons VIP, l'utilisateur doit être authentifié
  if (!req.user) {
    return next(new AppError('Authentification requise pour accéder aux coupons VIP', 401, ErrorCodes.AUTH_TOKEN_MISSING));
  }

  // ⭐ Vérifier si l'utilisateur a au moins un abonnement VIP actif DANS CETTE APP
  const hasVipAccess = await subscriptionService.hasAnyVipAccess(appId, req.user._id);
  
  if (!hasVipAccess) {
    return next(new AppError('Abonnement VIP requis pour accéder aux coupons VIP', 403, ErrorCodes.SUBSCRIPTION_REQUIRED));
  }

  // L'utilisateur a accès aux coupons VIP
  next();
});

/**
 * Middleware optionnel - ne bloque pas mais indique le statut d'accès
 */
exports.checkVipAccessOptional = catchAsync(async (req, res, next) => {
  // ⭐ Récupérer appId
  const appId = req.appId;
  
  const categoryId = req.params.categoryId || req.body.categoryId || req.query.categoryId;
  
  if (!categoryId || !appId) {
    req.hasVipAccess = false;
    return next();
  }

  // ⭐ Rechercher catégorie POUR CETTE APP
  const category = await Category.findOne({ _id: categoryId, appId });
  
  if (!category) {
    req.hasVipAccess = false;
    return next();
  }

  // Si gratuite ou pas d'user, pas d'accès VIP
  if (!category.isVip || !req.user) {
    req.hasVipAccess = !category.isVip;
    req.category = category;
    return next();
  }

  // ⭐ Vérifier l'abonnement DANS CETTE APP
  const hasAccess = await subscriptionService.hasAccessToCategory(appId, req.user._id, categoryId);
  
  req.hasVipAccess = hasAccess;
  req.category = category;
  next();
});

/**
 * Middleware pour empêcher les doubles souscriptions
 */
exports.checkNoActiveSubscription = catchAsync(async (req, res, next) => {
  // ⭐ Récupérer appId
  const appId = req.appId;
  
  if (!appId) {
    return next(new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR));
  }
  
  if (!req.user) {
    return next(new AppError('Authentification requise', 401, ErrorCodes.AUTH_TOKEN_MISSING));
  }

  // ⭐ Vérifier si peut souscrire DANS CETTE APP
  const canSubscribe = await subscriptionService.canSubscribe(appId, req.user._id);
  
  if (!canSubscribe) {
    return next(new AppError('Vous avez déjà un abonnement actif', 400, ErrorCodes.VALIDATION_ERROR));
  }

  next();
});