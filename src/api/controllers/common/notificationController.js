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
 * ⭐ MODIFIÉ : Générer des propositions de notifications via IA
 */
const generateNotifications = catchAsync(async (req, res) => {
  const { prompt, context = {}, count = 3 } = req.body;
  
  const appId = req.appId; // ⭐ Récupérer appId

  // ⭐ Vérifier que appId est présent
  if (!appId) {
    throw new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR);
  }

  // Vérifier que le service IA est disponible
  if (!aiNotificationService.isAvailable()) {
    throw new AppError(
      'Service de génération IA non disponible. Vérifiez la configuration GEMINI_API_KEY.',
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

  // ⭐ Passer appId au service IA
  const proposals = await aiNotificationService.generateNotifications(appId, prompt, context, proposalCount);

  res.status(200).json({
    success: true,
    data: {
      proposals,
      meta: {
        appId, // ⭐ Inclure appId dans la réponse
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
        : 'Service de génération IA non configuré. Vérifiez GEMINI_API_KEY.'
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
    message: `Notification envoyée à ${result.details?.validPlayerIds || result.recipients} utilisateur(s) dans ${countryCodes.length} pays`
  });
});

/**
 * Polir un texte brut en notification push bilingue.
 * 1 appel = 1 proposition. Réappel avec attempt > 0 → variation.
 */
const polishNotification = catchAsync(async (req, res) => {
  const { text, type, attempt } = req.body;
  const appId = req.appId;

  if (!appId) throw new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR);
  if (!aiNotificationService.isAvailable()) {
    throw new AppError('Service IA non configuré', 503, ErrorCodes.SERVICE_UNAVAILABLE);
  }
  if (!text || text.trim().length < 5) {
    throw new AppError('Texte requis (min 5 caractères)', 400, ErrorCodes.VALIDATION_ERROR);
  }

  const polished = await aiNotificationService.polishMessage(
    appId,
    text.trim(),
    type || 'general',
    parseInt(attempt) || 0,
  );

  res.status(200).json({
    success: true,
    data: { notification: polished, meta: { appId, type, attempt: parseInt(attempt) || 0 } },
  });
});

/**
 * Compteur live de l'audience pour le formulaire admin.
 * Si query.appIds est fourni (CSV) → multi-app, sinon utilise req.appId (header).
 */
const audienceCount = catchAsync(async (req, res) => {
  const appIdsParam = req.query.appIds
    ? String(req.query.appIds).split(',').filter(Boolean)
    : null;
  const appIdOrIds = appIdsParam && appIdsParam.length > 0 ? appIdsParam : req.appId;
  if (!appIdOrIds) throw new AppError('Header X-App-Id ou query.appIds requis', 400, ErrorCodes.VALIDATION_ERROR);

  const audience = req.query.audience || 'all';
  const countryCodes = req.query.countryCodes
    ? String(req.query.countryCodes).split(',').filter(Boolean)
    : [];

  if (!['all', 'vip', 'free'].includes(audience)) {
    throw new AppError('audience doit être all|vip|free', 400, ErrorCodes.VALIDATION_ERROR);
  }

  const result = await notificationService.countAudience(appIdOrIds, { audience, countryCodes });
  res.status(200).json({ success: true, data: result });
});

/**
 * Envoi unifié — utilisé par le formulaire admin de notifications.
 * Combine audience (all/vip/free) × pays × apps (1 ou N).
 *
 * Si targeting.apps est fourni (array d'appIds) → multi-app. Sinon req.appId.
 */
const sendUnified = catchAsync(async (req, res) => {
  const { notification, targeting } = req.body;

  const targetApps = Array.isArray(targeting?.apps) && targeting.apps.length > 0
    ? targeting.apps
    : null;
  const appIdOrIds = targetApps || req.appId;
  if (!appIdOrIds) throw new AppError('Header X-App-Id ou targeting.apps requis', 400, ErrorCodes.VALIDATION_ERROR);

  if (!notification?.contents?.fr || !notification?.contents?.en) {
    throw new AppError('notification.contents.fr et .en requis', 400, ErrorCodes.VALIDATION_ERROR);
  }
  if (!notification?.headings?.fr || !notification?.headings?.en) {
    throw new AppError('notification.headings.fr et .en requis', 400, ErrorCodes.VALIDATION_ERROR);
  }

  const audience = targeting?.audience || 'all';
  if (!['all', 'vip', 'free'].includes(audience)) {
    throw new AppError('targeting.audience doit être all|vip|free', 400, ErrorCodes.VALIDATION_ERROR);
  }

  const result = await notificationService.sendUnified(appIdOrIds, {
    notification,
    targeting: {
      audience,
      countryCodes: (targeting?.countryCodes || []).map((c) => String(c).toUpperCase()),
    },
  });

  res.status(200).json({ success: true, data: result });
});

module.exports = {
  send,
  broadcast,
  sendWithFilters,
  checkPlayers,
  getActivePlayers,
  generateNotifications, // ⭐ Maintenant multitenant
  checkAIStatus,
  sendToCountries,
  // Nouveaux : flux unifié AI + ciblage avancé
  polishNotification,
  audienceCount,
  sendUnified,
};