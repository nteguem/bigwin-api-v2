// src/api/controllers/common/notificationController.js
const notificationService = require('../../services/common/notificationService');
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

module.exports = {
  send,
  broadcast,
  sendWithFilters,
  checkPlayers,
  getActivePlayers
};