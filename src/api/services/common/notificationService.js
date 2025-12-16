// src/api/services/common/notificationService.js

const axios = require('axios');
const logger = require('../../../utils/logger');
const { AppError } = require('../../../utils/AppError');
const App = require('../../models/common/App');

class NotificationService {
  constructor() {
    this.apiUrl = 'https://onesignal.com/api/v1';
    this.configCache = new Map(); // Cache des configs par appId
  }

  /**
   * Récupérer la config OneSignal pour une app spécifique
   */
  async _getConfig(appId) {
    // Vérifier le cache
    if (this.configCache.has(appId)) {
      return this.configCache.get(appId);
    }

    // Récupérer depuis la DB
    const app = await App.findOne({ appId, isActive: true });
    
    if (!app) {
      throw new AppError(`Application ${appId} non trouvée ou inactive`, 404);
    }

    const config = app.getOneSignalConfig();
    
    if (!config.appId || !config.restApiKey) {
      throw new AppError(
        `Configuration OneSignal manquante pour l'application ${appId}`,
        500
      );
    }

    // Mettre en cache
    this.configCache.set(appId, config);
    
    return config;
  }

  /**
   * Envoyer une notification à des utilisateurs spécifiques via playerIds
   * @param {String} appId - ID de l'application
   * @param {Array|String} playerIds - Player IDs OneSignal
   * @param {Object} notification - Contenu de la notification
   */
  async sendToUsers(appId, playerIds, notification) {
    try {
      const config = await this._getConfig(appId);
      
      const payload = {
        app_id: config.appId,
        include_player_ids: Array.isArray(playerIds) ? playerIds : [playerIds],
        headings: notification.headings || { en: "Notification", fr: "Notification" },
        contents: notification.contents,
        data: notification.data || {},
        ...notification.options
      };

      const response = await this._makeRequest(config, 'notifications', 'POST', payload);
      
      logger.info(`[${appId}] Notification envoyée à ${playerIds.length} utilisateur(s)`, {
        notificationId: response.id,
        recipients: response.recipients
      });

      return response;
    } catch (error) {
      logger.error(`[${appId}] Erreur envoi notification utilisateurs:`, {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });
      
      const errorMessage = error.response?.data?.errors 
        ? JSON.stringify(error.response.data.errors)
        : error.message;
      
      throw new AppError(`Échec envoi notification: ${errorMessage}`, 500);
    }
  }

  /**
   * Envoyer une notification à tous les utilisateurs d'une app
   * @param {String} appId - ID de l'application
   * @param {Object} notification - Contenu de la notification
   */
  async sendToAll(appId, notification) {
    try {
      const config = await this._getConfig(appId);
      
      const payload = {
        app_id: config.appId,
        included_segments: ['All'],
        headings: notification.headings || { en: "Notification", fr: "Notification" },
        contents: notification.contents,
        data: notification.data || {},
        ...notification.options
      };

      logger.info(`[${appId}] Tentative d'envoi broadcast avec payload:`, payload);

      const response = await this._makeRequest(config, 'notifications', 'POST', payload);
      
      logger.info(`[${appId}] Notification broadcast envoyée`, {
        notificationId: response.id,
        recipients: response.recipients
      });

      return response;
    } catch (error) {
      logger.error(`[${appId}] Erreur envoi notification broadcast:`, {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });
      
      const errorMessage = error.response?.data?.errors 
        ? JSON.stringify(error.response.data.errors)
        : error.message;
      
      throw new AppError(`Échec envoi notification broadcast: ${errorMessage}`, 500);
    }
  }

  /**
   * Envoyer une notification avec des filtres personnalisés
   * @param {String} appId - ID de l'application
   * @param {Array} filters - Filtres OneSignal
   * @param {Object} notification - Contenu de la notification
   */
  async sendWithFilters(appId, filters, notification) {
    try {
      const config = await this._getConfig(appId);
      
      const payload = {
        app_id: config.appId,
        filters: filters,
        headings: notification.headings || { en: "Notification", fr: "Notification" },
        contents: notification.contents,
        data: notification.data || {},
        ...notification.options
      };

      const response = await this._makeRequest(config, 'notifications', 'POST', payload);
      
      logger.info(`[${appId}] Notification avec filtres envoyée`, {
        notificationId: response.id,
        recipients: response.recipients,
        filters: filters
      });

      return response;
    } catch (error) {
      logger.error(`[${appId}] Erreur envoi notification avec filtres:`, {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });
      
      const errorMessage = error.response?.data?.errors 
        ? JSON.stringify(error.response.data.errors)
        : error.message;
      
      throw new AppError(`Échec envoi notification avec filtres: ${errorMessage}`, 500);
    }
  }

  /**
   * Récupérer les statistiques de l'app OneSignal
   * @param {String} appId - ID de l'application
   */
  async getAppStats(appId) {
    try {
      const config = await this._getConfig(appId);
      const response = await this._makeRequest(config, `apps/${config.appId}`, 'GET');
      
      return {
        totalUsers: response.players,
        messagableUsers: response.messagable_players,
        name: response.name,
        updatedAt: response.updated_at
      };
    } catch (error) {
      logger.error(`[${appId}] Erreur récupération stats OneSignal:`, error);
      throw new AppError('Échec récupération statistiques', 500);
    }
  }

  /**
   * Récupérer l'historique des notifications
   * @param {String} appId - ID de l'application
   */
  async getNotificationHistory(appId, limit = 50, offset = 0) {
    try {
      const config = await this._getConfig(appId);
      const response = await this._makeRequest(
        config,
        `notifications?app_id=${config.appId}&limit=${limit}&offset=${offset}`, 
        'GET'
      );
      
      return response.notifications.map(notif => ({
        id: notif.id,
        contents: notif.contents,
        headings: notif.headings,
        recipients: notif.recipients,
        successful: notif.successful,
        failed: notif.failed,
        createdAt: notif.queued_at,
        completedAt: notif.completed_at
      }));
    } catch (error) {
      logger.error(`[${appId}] Erreur récupération historique notifications:`, error);
      throw new AppError('Échec récupération historique', 500);
    }
  }

  /**
   * Vérifier si des player_ids sont valides/actifs
   * @param {String} appId - ID de l'application
   */
  async checkPlayerIds(appId, playerIds) {
    try {
      const config = await this._getConfig(appId);
      const playerArray = Array.isArray(playerIds) ? playerIds : [playerIds];
      const results = [];
      
      for (const playerId of playerArray) {
        try {
          const response = await this._makeRequest(
            config,
            `players/${playerId}?app_id=${config.appId}`, 
            'GET'
          );
          results.push({
            playerId,
            valid: true,
            subscribed: response.notification_types > 0,
            lastActive: response.last_active,
            createdAt: response.created_at,
            deviceType: response.device_type,
            appVersion: response.app_version
          });
        } catch (error) {
          results.push({
            playerId,
            valid: false,
            error: error.response?.data?.errors || error.message
          });
        }
      }
      
      return results;
    } catch (error) {
      logger.error(`[${appId}] Erreur vérification player IDs:`, error);
      throw new AppError('Échec vérification player IDs', 500);
    }
  }

  /**
   * Récupérer la liste des utilisateurs actifs
   * @param {String} appId - ID de l'application
   */
  async getActivePlayers(appId, limit = 300, offset = 0) {
    try {
      const config = await this._getConfig(appId);
      const response = await this._makeRequest(
        config,
        `players?app_id=${config.appId}&limit=${limit}&offset=${offset}`, 
        'GET'
      );
      
      return response.players.map(player => ({
        id: player.id,
        subscribed: player.notification_types > 0,
        lastActive: player.last_active,
        createdAt: player.created_at,
        deviceType: player.device_type,
        appVersion: player.app_version
      }));
    } catch (error) {
      logger.error(`[${appId}] Erreur récupération players actifs:`, error);
      throw new AppError('Échec récupération players actifs', 500);
    }
  }

  /**
   * Méthode privée pour faire les requêtes à l'API OneSignal
   * @param {Object} config - Configuration OneSignal de l'app
   */
  async _makeRequest(config, endpoint, method = 'GET', data = null) {
    try {
      const axiosConfig = {
        method,
        url: `${this.apiUrl}/${endpoint}`,
        headers: {
          'Authorization': `Basic ${config.restApiKey}`,
          'Content-Type': 'application/json'
        }
      };

      if (data && (method === 'POST' || method === 'PUT')) {
        axiosConfig.data = data;
      }

      const response = await axios(axiosConfig);
      return response.data;
    } catch (error) {
      logger.error('Erreur requête OneSignal API:', {
        endpoint,
        method,
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });
      throw error;
    }
  }

  /**
   * Vider le cache de configuration (utile si config change en DB)
   */
  clearConfigCache(appId = null) {
    if (appId) {
      this.configCache.delete(appId);
    } else {
      this.configCache.clear();
    }
  }

  // Méthodes d'alias pour la compatibilité
  async send(appId, playerIds, notification) {
    return this.sendToUsers(appId, playerIds, notification);
  }

  async broadcast(appId, notification) {
    return this.sendToAll(appId, notification);
  }

/**
 * Envoyer une notification à tous les utilisateurs de pays spécifiques
 * @param {String} appId - ID de l'application
 * @param {Array<String>} countryCodes - Codes pays ISO (ex: ["SN", "CM", "CI"])
 * @param {Object} notification - Contenu de la notification
 * @param {Object} options - Options supplémentaires
 * @param {Boolean} options.includeGuests - Inclure les users non enregistrés (défaut: false)
 * @param {Number} options.batchSize - Taille des lots pour l'envoi (défaut: 2000)
 */
async sendToCountries(appId, countryCodes, notification, options = {}) {
  try {
    const config = await this._getConfig(appId);
    const { includeGuests = false, batchSize = 2000 } = options;

    // Validation des codes pays
    if (!Array.isArray(countryCodes) || countryCodes.length === 0) {
      throw new AppError('countryCodes doit être un tableau non vide', 400);
    }

    // Normaliser les codes pays (uppercase)
    const normalizedCodes = countryCodes.map(code => code.toUpperCase());

    logger.info(`[${appId}] Récupération des playerIds pour les pays:`, normalizedCodes);

    // Récupérer les playerIds via agrégation MongoDB
    const Device = require('../../models/common/Device');
    const User = require('../../models/user/User');

    const pipeline = [
      // Étape 1: Filtrer les devices actifs de l'app
      {
        $match: {
          appId: appId,
          isActive: true,
          fcmToken: { $exists: true, $ne: null, $ne: '' }
        }
      },
      // Étape 2: Joindre avec la collection User
      {
        $lookup: {
          from: 'users',
          localField: 'user',
          foreignField: '_id',
          as: 'userData'
        }
      },
      // Étape 3: Dérouler le tableau userData
      {
        $unwind: {
          path: '$userData',
          preserveNullAndEmptyArrays: !includeGuests
        }
      },
      // Étape 4: Filtrer par countryCode
      {
        $match: includeGuests 
          ? {
              $or: [
                { 'userData.countryCode': { $in: normalizedCodes } },
                { 'userData': { $exists: false } }
              ]
            }
          : { 'userData.countryCode': { $in: normalizedCodes } }
      },
      // Étape 5: Projeter les infos nécessaires
      {
        $project: {
          _id: 1,
          playerId: '$fcmToken',
          countryCode: '$userData.countryCode',
          userType: 1,
          userId: '$user'
        }
      }
    ];

    const devices = await Device.aggregate(pipeline);

    if (!devices || devices.length === 0) {
      logger.warn(`[${appId}] Aucun device trouvé pour les pays:`, normalizedCodes);
      return {
        id: null,
        recipients: 0,
        successful: 0,
        failed: 0,
        invalidTokens: 0,
        message: `Aucun utilisateur trouvé pour les pays: ${normalizedCodes.join(', ')}`,
        details: {
          targetCountries: normalizedCodes,
          statsByCountry: {}
        }
      };
    }

    logger.info(`[${appId}] ${devices.length} devices trouvés, filtrage des playerIds valides...`);

    // Regex pour valider les UUIDs OneSignal (format standard UUID v4)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    // Séparer les playerIds valides et invalides
    const validDevices = [];
    const invalidDevices = [];

    devices.forEach(device => {
      if (uuidRegex.test(device.playerId)) {
        validDevices.push(device);
      } else {
        invalidDevices.push(device);
      }
    });

    // Logger les tokens invalides pour debug/nettoyage futur
    if (invalidDevices.length > 0) {
      logger.warn(`[${appId}] ${invalidDevices.length} tokens invalides détectés (anciens FCM tokens):`, {
        sample: invalidDevices.slice(0, 3).map(d => ({
          deviceId: d._id,
          token: d.playerId.substring(0, 50) + '...',
          country: d.countryCode
        })),
        total: invalidDevices.length
      });
    }

    if (validDevices.length === 0) {
      logger.warn(`[${appId}] Aucun playerId OneSignal valide trouvé pour les pays:`, normalizedCodes);
      return {
        id: null,
        recipients: 0,
        successful: 0,
        failed: 0,
        invalidTokens: invalidDevices.length,
        message: `Aucun playerId OneSignal valide trouvé. ${invalidDevices.length} anciens FCM tokens détectés.`,
        details: {
          targetCountries: normalizedCodes,
          totalDevices: devices.length,
          validDevices: 0,
          invalidDevices: invalidDevices.length,
          statsByCountry: devices.reduce((acc, device) => {
            const country = device.countryCode || 'unknown';
            acc[country] = (acc[country] || 0) + 1;
            return acc;
          }, {})
        }
      };
    }

    const playerIds = validDevices.map(d => d.playerId);

    logger.info(`[${appId}] ${playerIds.length} playerIds valides (${invalidDevices.length} invalides ignorés)`);

    // Statistiques par pays (seulement les valides)
    const statsByCountry = validDevices.reduce((acc, device) => {
      const country = device.countryCode || 'unknown';
      acc[country] = (acc[country] || 0) + 1;
      return acc;
    }, {});

    logger.info(`[${appId}] Répartition par pays (playerIds valides):`, statsByCountry);

    // Envoi par lots si trop de playerIds (limite OneSignal: 2000 par requête)
    if (playerIds.length <= batchSize) {
      // Envoi simple
      const payload = {
        app_id: config.appId,
        include_player_ids: playerIds,
        headings: notification.headings || { en: "Notification", fr: "Notification" },
        contents: notification.contents,
        data: {
          ...notification.data,
          targetCountries: normalizedCodes
        },
        ...notification.options
      };

      const response = await this._makeRequest(config, 'notifications', 'POST', payload);
      
      logger.info(`[${appId}] Notification envoyée aux pays ${normalizedCodes.join(', ')}`, {
        notificationId: response.id,
        recipients: response.recipients,
        statsByCountry
      });

      return {
        ...response,
        successful: response.recipients || playerIds.length,
        failed: playerIds.length - (response.recipients || playerIds.length),
        invalidTokens: invalidDevices.length,
        details: {
          targetCountries: normalizedCodes,
          totalDevices: devices.length,
          validDevices: validDevices.length,
          invalidDevices: invalidDevices.length,
          totalRecipients: playerIds.length,
          statsByCountry,
          invalidTokensSample: invalidDevices.slice(0, 5).map(d => ({
            deviceId: d._id.toString(),
            countryCode: d.countryCode,
            tokenPreview: d.playerId.substring(0, 50) + '...'
          }))
        }
      };
    } else {
      // Envoi par lots
      logger.info(`[${appId}] Envoi par lots (${batchSize} playerIds par lot)...`);
      
      const batches = [];
      for (let i = 0; i < playerIds.length; i += batchSize) {
        batches.push(playerIds.slice(i, i + batchSize));
      }

      const results = [];
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        logger.info(`[${appId}] Envoi du lot ${i + 1}/${batches.length} (${batch.length} playerIds)`);

        const payload = {
          app_id: config.appId,
          include_player_ids: batch,
          headings: notification.headings || { en: "Notification", fr: "Notification" },
          contents: notification.contents,
          data: {
            ...notification.data,
            targetCountries: normalizedCodes,
            batchNumber: i + 1
          },
          ...notification.options
        };

        try {
          const response = await this._makeRequest(config, 'notifications', 'POST', payload);
          results.push({
            success: true,
            ...response
          });
        } catch (error) {
          logger.error(`[${appId}] Erreur sur le lot ${i + 1}:`, error.message);
          results.push({
            success: false,
            error: error.message,
            batchSize: batch.length
          });
        }

        // Petit délai entre les lots pour éviter le rate limiting
        if (i < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      const successfulBatches = results.filter(r => r.success);
      const failedBatches = results.filter(r => !r.success);
      const totalRecipients = successfulBatches.reduce((sum, r) => sum + (r.recipients || 0), 0);

      logger.info(`[${appId}] Tous les lots traités`, {
        successful: successfulBatches.length,
        failed: failedBatches.length,
        totalRecipients
      });

      return {
        id: successfulBatches[0]?.id || null,
        recipients: totalRecipients,
        successful: totalRecipients,
        failed: playerIds.length - totalRecipients,
        invalidTokens: invalidDevices.length,
        batches: results.length,
        successfulBatches: successfulBatches.length,
        failedBatches: failedBatches.length,
        batchResults: results.map((r, idx) => ({
          batchNumber: idx + 1,
          success: r.success,
          id: r.id,
          recipients: r.recipients,
          error: r.error
        })),
        details: {
          targetCountries: normalizedCodes,
          totalDevices: devices.length,
          validDevices: validDevices.length,
          invalidDevices: invalidDevices.length,
          totalRecipients: playerIds.length,
          statsByCountry,
          invalidTokensSample: invalidDevices.slice(0, 5).map(d => ({
            deviceId: d._id.toString(),
            countryCode: d.countryCode,
            tokenPreview: d.playerId.substring(0, 50) + '...'
          }))
        }
      };
    }

  } catch (error) {
    logger.error(`[${appId}] Erreur envoi notification par pays:`, {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      countryCodes
    });
    
    const errorMessage = error.response?.data?.errors 
      ? JSON.stringify(error.response.data.errors)
      : error.message;
    
    throw new AppError(`Échec envoi notification par pays: ${errorMessage}`, 500);
  }
}
}

module.exports = new NotificationService();