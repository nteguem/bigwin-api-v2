// src/api/services/common/notificationService.js

const axios = require('axios');
const logger = require('../../../utils/logger');
const { AppError } = require('../../../utils/AppError');
const App = require('../../models/common/App');

class NotificationService {
  constructor() {
    // ✅ NOUVELLE URL API (changement novembre 2024)
    this.apiUrl = 'https://api.onesignal.com';
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
          // ✅ NOUVEAU FORMAT D'AUTORISATION (changement novembre 2024)
          'Authorization': `Key ${config.restApiKey}`,
          'Content-Type': 'application/json',
          'accept': 'application/json'
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
}

module.exports = new NotificationService();