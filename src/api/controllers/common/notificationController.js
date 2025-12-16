// src/api/controllers/common/notificationController.js
const notificationService = require('../../services/common/notificationService');
const aiNotificationService = require('../../services/common/aiNotificationService');
const catchAsync = require('../../../utils/catchAsync');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

/**
 * Endpoint de base : Envoyer à des playerIds
 */
const send = catchAsync(async (req, res) => {
  const { playerIds, notification } = req.body;

  const appId = req.appId;

  // Vérifier que appId est présent
  if (!appId) {
    throw new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR);
  }
  
  if (!playerIds || !notification?.contents) {
    throw new AppError('playerIds et notification.contents requis', 400, ErrorCodes.VALIDATION_ERROR);
  }
  
  const result = await notificationService.sendToUsers(appId, playerIds, notification);
  
  res.status(200).json({
    success: true,
    data: result
  });
});

/**
 * Endpoint de base : Broadcast
 */
const broadcast = catchAsync(async (req, res) => {
  const { notification } = req.body;

  const appId = req.appId;

  // Vérifier que appId est présent
  if (!appId) {
    throw new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR);
  }
  
  if (!notification?.contents) {
    throw new AppError('notification.contents requis', 400, ErrorCodes.VALIDATION_ERROR);
  }
  
  const result = await notificationService.sendToAll(appId, notification);
  
  res.status(200).json({
    success: true,
    data: result
  });
});

/**
 * Endpoint de base : Envoyer avec filtres
 */
const sendWithFilters = catchAsync(async (req, res) => {
  const { filters, notification } = req.body;

  const appId = req.appId;

  // Vérifier que appId est présent
  if (!appId) {
    throw new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR);
  }
  
  if (!filters || !notification?.contents) {
    throw new AppError('filters et notification.contents requis', 400, ErrorCodes.VALIDATION_ERROR);
  }
  
  const result = await notificationService.sendWithFilters(appId, filters, notification);
  
  res.status(200).json({
    success: true,
    data: result
  });
});

/**
 * Vérifier si des player IDs sont valides
 */
const checkPlayers = catchAsync(async (req, res) => {
  const { playerIds } = req.body;

  const appId = req.appId;

  // Vérifier que appId est présent
  if (!appId) {
    throw new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR);
  }
  
  if (!playerIds) {
    throw new AppError('playerIds requis', 400, ErrorCodes.VALIDATION_ERROR);
  }
  
  const result = await notificationService.checkPlayerIds(appId, playerIds);
  
  res.status(200).json({
    success: true,
    data: result
  });
});

/**
 * Récupérer la liste des utilisateurs actifs
 */
const getActivePlayers = catchAsync(async (req, res) => {
  const { limit = 50, offset = 0 } = req.query;

  const appId = req.appId;

  // Vérifier que appId est présent
  if (!appId) {
    throw new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR);
  }
  
  const result = await notificationService.getActivePlayers(appId, parseInt(limit), parseInt(offset));
  
  res.status(200).json({
    success: true,
    data: result,
    count: result.length
  });
});

/**
 * NOUVEAU : Générer des propositions de notifications via IA
 */
const generateNotifications = catchAsync(async (req, res) => {
  const { prompt, context = {}, count = 3 } = req.body;

  // Vérifier que le service IA est disponible
  if (!aiNotificationService.isAvailable()) {
    throw new AppError(
      'Service de génération IA non disponible. Vérifiez la configuration ANTHROPIC_API_KEY.',
      503,
      ErrorCodes.SERVICE_UNAVAILABLE
    );
  }

  // Validation du prompt
  if (!prompt || typeof prompt !== 'string') {
    throw new AppError('Le champ "prompt" est requis et doit être une chaîne de caractères', 400, ErrorCodes.VALIDATION_ERROR);
  }

  if (prompt.trim().length < 10) {
    throw new AppError('La description doit contenir au moins 10 caractères', 400, ErrorCodes.VALIDATION_ERROR);
  }

  if (prompt.length > 1000) {
    throw new AppError('La description ne doit pas dépasser 1000 caractères', 400, ErrorCodes.VALIDATION_ERROR);
  }

  // Validation du count
  const proposalCount = Math.min(Math.max(parseInt(count) || 3, 1), 3);

  // Générer les propositions
  const proposals = await aiNotificationService.generateNotifications(prompt, context, proposalCount);

  res.status(200).json({
    success: true,
    data: {
      proposals,
      meta: {
        prompt: prompt,
        context: context,
        count: proposals.length,
        generatedAt: new Date().toISOString()
      }
    }
  });
});

/**
 * NOUVEAU : Vérifier si le service IA est disponible
 */
const checkAIStatus = catchAsync(async (req, res) => {
  const isAvailable = aiNotificationService.isAvailable();

  res.status(200).json({
    success: true,
    data: {
      available: isAvailable,
      message: isAvailable 
        ? 'Service de génération IA disponible' 
        : 'Service de génération IA non configuré. Vérifiez ANTHROPIC_API_KEY.'
    }
  });
});

/**
 * Endpoint : Envoyer une notification à des pays spécifiques
 */
const sendToCountries = catchAsync(async (req, res) => {
  const { countryCodes, notification, options } = req.body;

  const appId = req.appId;

  // Vérifier que appId est présent
  if (!appId) {
    throw new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR);
  }
  
  if (!countryCodes || !Array.isArray(countryCodes) || countryCodes.length === 0) {
    throw new AppError('countryCodes requis (tableau de codes pays ISO)', 400, ErrorCodes.VALIDATION_ERROR);
  }

  if (!notification?.contents) {
    throw new AppError('notification.contents requis', 400, ErrorCodes.VALIDATION_ERROR);
  }
  
  const result = await notificationService.sendToCountries(appId, countryCodes, notification, options);
  
  res.status(200).json({
    success: true,
    data: result,
    message: `Notification envoyée à ${result.recipients} utilisateur(s) dans ${countryCodes.length} pays`
  });
});

module.exports = {
  send,
  broadcast,
  sendWithFilters,
  checkPlayers,
  getActivePlayers,
  generateNotifications,
  checkAIStatus,
  sendToCountries
};