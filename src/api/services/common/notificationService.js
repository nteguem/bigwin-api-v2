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
    // Garde-fou : en dev/staging (copie de la prod réutilisant les creds
    // OneSignal de prod), on coupe tout envoi pour ne pas spammer les vrais
    // users. Mettre DISABLE_PUSH_NOTIFICATIONS=true. Les appelants attrapent
    // cette erreur (try/catch) et continuent sans push.
    if (process.env.DISABLE_PUSH_NOTIFICATIONS === 'true') {
      throw new AppError(
        'Notifications push désactivées (DISABLE_PUSH_NOTIFICATIONS=true)',
        503
      );
    }

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

    // Étape 1: Récupérer les utilisateurs du/des pays ciblés
    const User = require('../../models/user/User');
    const Device = require('../../models/common/Device');

    // Regex case-insensitive pour matcher les codes pays
    const countryRegexes = normalizedCodes.map(code => new RegExp(`^${code}$`, 'i'));

    const users = await User.find({
      appId: appId,
      countryCode: { $in: countryRegexes }
    }).select('_id countryCode').lean();

    logger.info(`[${appId}] ${users.length} utilisateurs trouvés pour les pays: ${normalizedCodes.join(', ')}`);

    // Map userId -> countryCode pour les stats
    const userCountryMap = {};
    for (const u of users) {
      userCountryMap[u._id.toString()] = (u.countryCode || '').toUpperCase();
    }

    const userIds = users.map(u => u._id);

    // Étape 2: Récupérer les devices actifs avec playerId pour ces utilisateurs
    const baseDeviceQuery = {
      appId: appId,
      isActive: true,
      playerId: { $exists: true, $nin: [null, ''] }
    };

    // D'abord essayer avec les devices liés aux users
    let devices = await Device.find({
      ...baseDeviceQuery,
      user: { $in: userIds }
    }).select('playerId user userType').lean();

    logger.info(`[${appId}] ${devices.length} devices liés aux users trouvés`);

    // Si aucun device lié, fallback: chercher TOUS les devices actifs de l'app
    // car les devices ne sont probablement pas liés aux users
    if (devices.length === 0 && users.length > 0) {
      // Debug: compter les devices de cette app
      const totalAppDevices = await Device.countDocuments(baseDeviceQuery);
      const linkedDevices = await Device.countDocuments({ ...baseDeviceQuery, user: { $ne: null } });
      const unlinkedDevices = await Device.countDocuments({ ...baseDeviceQuery, user: null });

      logger.warn(`[${appId}] Aucun device lié aux users. Debug: ${totalAppDevices} devices total (${linkedDevices} liés, ${unlinkedDevices} non-liés)`);

      // Fallback: envoyer à TOUS les devices actifs de l'app avec playerId
      // puisque les devices ne sont pas liés aux users
      devices = await Device.find(baseDeviceQuery).select('playerId user userType').lean();

      logger.info(`[${appId}] Fallback: utilisation de ${devices.length} devices (tous les devices actifs de l'app)`);
    }

    if (includeGuests && devices.length === 0) {
      // Si includeGuests, inclure aussi les devices sans user
      devices = await Device.find(baseDeviceQuery).select('playerId user userType').lean();
    }

    if (!devices || devices.length === 0) {
      logger.warn(`[${appId}] Aucun device trouvé pour les pays:`, normalizedCodes);
      return {
        id: null,
        recipients: 0,
        successful: 0,
        failed: 0,
        message: `Aucun device trouvé pour les pays: ${normalizedCodes.join(', ')} (${users.length} users, 0 devices)`,
        details: {
          targetCountries: normalizedCodes,
          totalUsers: users.length,
          statsByCountry: {}
        }
      };
    }

    // Extraire les playerIds valides
    const playerIds = devices.map(d => d.playerId).filter(Boolean);

    if (playerIds.length === 0) {
      logger.warn(`[${appId}] Aucun playerId valide trouvé pour les pays:`, normalizedCodes);
      return {
        id: null,
        recipients: 0,
        successful: 0,
        failed: 0,
        message: `Aucun playerId OneSignal trouvé pour les pays: ${normalizedCodes.join(', ')}`,
        details: {
          targetCountries: normalizedCodes,
          totalUsers: users.length,
          totalDevices: devices.length,
          validPlayerIds: 0,
          statsByCountry: {}
        }
      };
    }

    logger.info(`[${appId}] ${playerIds.length} playerIds valides trouvés`);

    // Statistiques par pays
    const statsByCountry = devices.reduce((acc, device) => {
      const userId = device.user ? device.user.toString() : null;
      const country = (userId && userCountryMap[userId]) || 'unknown';
      acc[country] = (acc[country] || 0) + 1;
      return acc;
    }, {});

    logger.info(`[${appId}] Répartition par pays:`, statsByCountry);

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
        details: {
          targetCountries: normalizedCodes,
          totalDevices: devices.length,
          validPlayerIds: playerIds.length,
          totalRecipients: playerIds.length,
          statsByCountry
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
          validPlayerIds: playerIds.length,
          totalRecipients: playerIds.length,
          statsByCountry
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

  /* ──────────────────────────────────────────────────────────────────
   * Ciblage avancé : audience (tous/VIP/free) × pays
   * ────────────────────────────────────────────────────────────────── */

  /**
   * Résout la liste de userIds correspondant à l'audience demandée.
   * audience='all'  : tous les users de l'app (filtrés par pays si fournis)
   * audience='vip'  : users avec souscription active (endDate > now)
   * audience='free' : users SANS souscription active
   *
   * @returns {Array<ObjectId>} liste des userIds
   */
  async _resolveAudienceUserIds(appId, { audience, countryCodes }) {
  const User = require('../../models/user/User');
  const Subscription = require('../../models/common/Subscription');

  const userQuery = { appId };
  if (countryCodes && countryCodes.length > 0) {
    const regexes = countryCodes.map((c) => new RegExp(`^${c}$`, 'i'));
    userQuery.countryCode = { $in: regexes };
  }

  if (audience === 'all') {
    const users = await User.find(userQuery).select('_id').lean();
    return users.map((u) => u._id);
  }

  // VIP / Free : on calcule l'ensemble des users avec souscription active
  // via aggregate (bypasse le hook pre('find') de Subscription).
  const vipUsers = await Subscription.aggregate([
    {
      $match: {
        appId,
        status: 'active',
        endDate: { $gt: new Date() },
      },
    },
    { $group: { _id: '$user' } },
  ]);
  const vipUserIds = new Set(vipUsers.map((u) => String(u._id)));

  if (audience === 'vip') {
    // Intersection : VIP ∩ filtre pays (si fourni)
    if (countryCodes && countryCodes.length > 0) {
      userQuery._id = { $in: Array.from(vipUserIds).map((id) => new (require('mongoose').Types.ObjectId)(id)) };
      const users = await User.find(userQuery).select('_id').lean();
      return users.map((u) => u._id);
    }
    // Pas de filtre pays : juste les userIds VIP
    return Array.from(vipUserIds).map((id) => new (require('mongoose').Types.ObjectId)(id));
  }

  if (audience === 'free') {
    // Soustraction : tous les users - les VIP
    const users = await User.find(userQuery).select('_id').lean();
    return users.map((u) => u._id).filter((id) => !vipUserIds.has(String(id)));
  }

  throw new AppError(`Audience inconnue : ${audience}`, 400);
}

/**
 * Récupère les playerIds OneSignal actifs pour une liste de userIds.
 */
async _resolvePlayerIds(appId, userIds) {
  if (userIds.length === 0) return [];
  const Device = require('../../models/common/Device');
  const devices = await Device.find({
    appId,
    user: { $in: userIds },
    isActive: true,
    playerId: { $exists: true, $nin: [null, ''] },
  }).select('playerId').lean();
  return devices.map((d) => d.playerId).filter(Boolean);
}

/**
 * Compte estimé de l'audience (sans envoyer la notif) pour le compteur live
 * du formulaire admin. Supporte une ou plusieurs apps.
 *
 * @param {String|Array<String>} appIdOrIds
 * @returns {Object} { users, devices, perApp: [{ appId, users, devices }] }
 */
async countAudience(appIdOrIds, { audience = 'all', countryCodes = [] } = {}) {
  const appIds = Array.isArray(appIdOrIds) ? appIdOrIds : [appIdOrIds];
  const perApp = [];
  let totalUsers = 0;
  let totalDevices = 0;

  // Fast path : 'all' sans filtre pays => countDocuments direct (pas de
  // resolution de la liste userIds). Crucial sur grosses bases : evite
  // de fabriquer un Array<ObjectId> de 10k+ entrees, puis un $in massif
  // dans Device.find() qui timeoutait le reverse proxy en 502.
  const isFastAll = audience === 'all' && (!countryCodes || countryCodes.length === 0);

  const User = isFastAll ? require('../../models/user/User') : null;
  const Device = isFastAll ? require('../../models/common/Device') : null;

  for (const appId of appIds) {
    if (isFastAll) {
      const userCount = await User.countDocuments({ appId });
      const deviceCount = await Device.countDocuments({
        appId,
        isActive: true,
        playerId: { $exists: true, $nin: [null, ''] },
      });
      perApp.push({ appId, users: userCount, devices: deviceCount });
      totalUsers += userCount;
      totalDevices += deviceCount;
      continue;
    }
    // Sinon : resolution standard (VIP / Free / pays filtre)
    const userIds = await this._resolveAudienceUserIds(appId, { audience, countryCodes });
    const playerIds = await this._resolvePlayerIds(appId, userIds);
    perApp.push({ appId, users: userIds.length, devices: playerIds.length });
    totalUsers += userIds.length;
    totalDevices += playerIds.length;
  }
  return {
    audience,
    countryCodes,
    users: totalUsers,
    devices: totalDevices,
    perApp,
  };
}

/**
 * Envoi unifié — supporte 1 ou N apps en un seul appel.
 *
 * Quand plusieurs apps : chaque app a sa propre config OneSignal (clé API +
 * app_id), donc on délègue à `_sendUnifiedSingleApp` pour chacune et on
 * agrège les résultats.
 *
 * @param {String|Array<String>} appIdOrIds
 * @param {Object} params
 * @param {Object}  params.notification               - { headings, contents, data, options }
 * @param {Object}  params.targeting
 * @param {String}  params.targeting.audience         - 'all' | 'vip' | 'free'
 * @param {Array}   [params.targeting.countryCodes]   - filtre additionnel
 * @param {Number}  [params.batchSize=2000]
 */
async sendUnified(appIdOrIds, { notification, targeting, batchSize = 2000 }) {
  const appIds = Array.isArray(appIdOrIds) ? appIdOrIds : [appIdOrIds];
  if (appIds.length === 1) {
    return this._sendUnifiedSingleApp(appIds[0], { notification, targeting, batchSize });
  }
  // Multi-app : on agrège
  const perApp = [];
  let requested = 0;
  let queued = 0;
  let failed = 0;
  let recipientsOneSignal = 0;
  const errors = [];
  for (const appId of appIds) {
    try {
      const r = await this._sendUnifiedSingleApp(appId, { notification, targeting, batchSize });
      perApp.push({ appId, ...r });
      requested += r.requested || 0;
      queued += r.queued || 0;
      failed += r.failed || 0;
      recipientsOneSignal += r.recipientsOneSignal || 0;
      if (r.errors?.length) errors.push(...r.errors.map((e) => `[${appId}] ${e}`));
    } catch (err) {
      logger.error(`[${appId}] sendUnified erreur app: ${err.message}`);
      perApp.push({ appId, error: err.message, requested: 0, queued: 0, failed: 0 });
      errors.push(`[${appId}] ${err.message}`);
    }
  }
  return {
    apps: appIds,
    requested,
    queued,
    recipientsOneSignal,
    failed,
    errors,
    perApp,
  };
}

async _sendUnifiedSingleApp(appId, { notification, targeting, batchSize = 2000 }) {
  const audience = targeting?.audience || 'all';
  const countryCodes = (targeting?.countryCodes || []).map((c) => c.toUpperCase());

  // Cas simple : tous + pas de filtre pays → broadcast OneSignal direct
  if (audience === 'all' && countryCodes.length === 0) {
    return this.sendToAll(appId, notification);
  }

  // Cas optimisé : VIP ou Free via OneSignal filters natifs (1 appel API).
  // Nécessite que les tags `is_vip` soient à jour côté OneSignal (cron quotidien
  // de réconciliation + hook Subscription.post('save')).
  // Le filtre par pays utilise le champ natif OneSignal `country` (pas besoin de
  // résoudre les users côté serveur).
  if (audience === 'vip' || audience === 'free') {
    return this._sendViaFilters(appId, { notification, audience, countryCodes });
  }

  // Sinon (audience='all' avec pays seulement) : on résout côté serveur
  const userIds = await this._resolveAudienceUserIds(appId, { audience, countryCodes });
  if (userIds.length === 0) {
    logger.warn(`[${appId}] Audience ${audience} avec pays ${countryCodes.join(',')} : 0 user`);
    return {
      id: null,
      recipients: 0,
      successful: 0,
      failed: 0,
      message: 'Aucun utilisateur correspondant aux critères',
      details: { audience, countryCodes, users: 0, devices: 0 },
    };
  }

  const playerIds = await this._resolvePlayerIds(appId, userIds);
  if (playerIds.length === 0) {
    return {
      id: null,
      recipients: 0,
      successful: 0,
      failed: 0,
      message: 'Aucun device actif (push désactivé) pour cette audience',
      details: { audience, countryCodes, users: userIds.length, devices: 0 },
    };
  }

  logger.info(`[${appId}] sendUnified audience=${audience} countries=${countryCodes.join(',') || 'all'} users=${userIds.length} devices=${playerIds.length}`);

  const config = await this._getConfig(appId);
  const baseData = {
    ...(notification.data || {}),
    targetAudience: audience,
    ...(countryCodes.length > 0 && { targetCountries: countryCodes }),
  };

  // Envoi en 1 lot ou en batches
  if (playerIds.length <= batchSize) {
    const payload = {
      app_id: config.appId,
      include_player_ids: playerIds,
      headings: notification.headings || { en: 'Notification', fr: 'Notification' },
      contents: notification.contents,
      data: baseData,
      ...notification.options,
    };
    const response = await this._makeRequest(config, 'notifications', 'POST', payload);
    logger.info(`[${appId}] sendUnified single batch response`, {
      id: response.id,
      recipients: response.recipients,
      errors: response.errors,
    });
    // Si OneSignal accepte la requête (id présent) mais ne donne pas de
    // 'recipients' fiable, on considère que la notif a été enfilée pour
    // les playerIds envoyés. recipients=0 sans 'id' = vrai échec.
    const requested = playerIds.length;
    const queued = response.id ? requested : 0;
    return {
      id: response.id || null,
      requested,
      queued,
      recipientsOneSignal: response.recipients ?? null,
      failed: requested - queued,
      errors: response.errors || null,
      details: { audience, countryCodes, users: userIds.length, devices: playerIds.length },
    };
  }

  // Envoi par lots
  const batches = [];
  for (let i = 0; i < playerIds.length; i += batchSize) {
    batches.push(playerIds.slice(i, i + batchSize));
  }
  const results = [];
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const payload = {
      app_id: config.appId,
      include_player_ids: batch,
      headings: notification.headings || { en: 'Notification', fr: 'Notification' },
      contents: notification.contents,
      data: { ...baseData, batchNumber: i + 1 },
      ...notification.options,
    };
    try {
      const r = await this._makeRequest(config, 'notifications', 'POST', payload);
      // Log léger pour observer ce que OneSignal renvoie réellement
      if (i === 0) {
        logger.info(`[${appId}] sendUnified batch 1/${batches.length} response`, {
          id: r.id,
          recipients: r.recipients,
          errors: r.errors,
        });
      }
      results.push({ success: true, batchSize: batch.length, ...r });
    } catch (err) {
      logger.error(`[${appId}] Erreur lot ${i + 1}: ${err.message}`);
      results.push({ success: false, error: err.message, batchSize: batch.length });
    }
    if (i < batches.length - 1) await new Promise((r) => setTimeout(r, 500));
  }

  // Comptage : un batch est "queued" s'il a un id de notif (OneSignal a accepté).
  // recipients dans la réponse OneSignal = estimation des reachables, souvent
  // sous-estimée pour les batches synchrones — on ne l'utilise pas pour décider
  // succès/échec, juste comme info.
  const queuedBatches = results.filter((r) => r.success && r.id);
  const failedBatches = results.filter((r) => !r.success);
  const queued = queuedBatches.reduce((s, r) => s + r.batchSize, 0);
  const recipientsSum = queuedBatches.reduce((s, r) => s + (r.recipients || 0), 0);

  return {
    id: queuedBatches[0]?.id || null,
    requested: playerIds.length,
    queued,
    recipientsOneSignal: recipientsSum, // estimation OneSignal (souvent < queued)
    failed: failedBatches.reduce((s, r) => s + r.batchSize, 0),
    batches: results.length,
    queuedBatches: queuedBatches.length,
    failedBatches: failedBatches.length,
    errors: failedBatches.map((r) => r.error).filter(Boolean),
    details: { audience, countryCodes, users: userIds.length, devices: playerIds.length },
  };
}

/**
 * Envoi via OneSignal Filters natifs — 1 appel API, instantané.
 *
 * Utilisé pour les ciblages tag-based (VIP/Free) où les tags `is_vip` ont été
 * pushés en amont par le hook Subscription.post('save') et le cron de
 * réconciliation. Le filtre par pays utilise le champ OneSignal natif.
 *
 * Avantages vs résolution côté serveur :
 *  • 1 appel HTTP au lieu de N batches de 2000
 *  • Pas de timeout 504 (réponse en quelques centaines de ms)
 *  • Plus de query Mongo lourde sur User+Subscription+Device
 *  • OneSignal délivre uniquement aux devices effectivement reachables
 */
async _sendViaFilters(appId, { notification, audience, countryCodes = [] }) {
  const filters = [];

  // Filter VIP : is_vip = 'true'
  // Filter Free : is_vip != 'true' (matche aussi l'absence de tag)
  if (audience === 'vip') {
    filters.push({ field: 'tag', key: 'is_vip', relation: '=', value: 'true' });
  } else if (audience === 'free') {
    filters.push({ field: 'tag', key: 'is_vip', relation: '!=', value: 'true' });
  }

  // Pays via le champ natif OneSignal (détecté automatiquement depuis IP/locale)
  if (countryCodes.length > 0) {
    if (filters.length > 0) {
      filters.push({ operator: 'AND' });
    }
    countryCodes.forEach((cc, idx) => {
      if (idx > 0) filters.push({ operator: 'OR' });
      filters.push({ field: 'country', relation: '=', value: cc });
    });
  }

  const config = await this._getConfig(appId);
  const baseData = {
    ...(notification.data || {}),
    targetAudience: audience,
    ...(countryCodes.length > 0 && { targetCountries: countryCodes }),
  };

  const payload = {
    app_id: config.appId,
    filters,
    headings: notification.headings || { en: 'Notification', fr: 'Notification' },
    contents: notification.contents,
    data: baseData,
    ...notification.options,
  };

  try {
    const response = await this._makeRequest(config, 'notifications', 'POST', payload);
    logger.info(
      `[${appId}] sendViaFilters audience=${audience} countries=${countryCodes.join(',') || 'all'} ` +
      `→ id=${response.id} recipients=${response.recipients}`
    );
    return {
      id: response.id || null,
      requested: response.recipients ?? null,
      queued: response.recipients ?? 0,
      recipientsOneSignal: response.recipients ?? 0,
      failed: 0,
      errors: response.errors || [],
      details: { audience, countryCodes, mode: 'filters' },
    };
  } catch (err) {
    logger.error(`[${appId}] sendViaFilters erreur: ${err.message}`);
    return {
      id: null,
      requested: 0,
      queued: 0,
      recipientsOneSignal: 0,
      failed: 0,
      errors: [err.message],
      details: { audience, countryCodes, mode: 'filters' },
    };
  }
}
}

module.exports = new NotificationService();