// src/api/services/common/oneSignalTagService.js
//
// Pousse les tags OneSignal sur les devices des users (notamment is_vip).
// Permet de cibler les VIP/Free via OneSignal filters côté serveur OneSignal,
// au lieu de résoudre les userIds → playerIds dans notre backend (envoi
// instantané, plus de batches, plus de 504).
//
// Source de vérité = Mongo. OneSignal est un miroir mis à jour par :
//   1) Mongoose hook Subscription.post('save')   → tag immédiat à l'achat
//   2) Cron quotidien de réconciliation         → corrige les drifts (expirations, réinstalls)

const axios = require('axios');
const logger = require('../../../utils/logger');
const App = require('../../models/common/App');
const Device = require('../../models/common/Device');
const Subscription = require('../../models/common/Subscription');

const ONESIGNAL_API = 'https://onesignal.com/api/v1';

// Cache mémoire des configs OneSignal (évite de re-fetch App à chaque appel)
const _configCache = new Map();

async function _getConfig(appId) {
  if (_configCache.has(appId)) return _configCache.get(appId);
  const app = await App.findOne({ appId, isActive: true });
  if (!app) throw new Error(`App ${appId} introuvable`);
  const config = app.getOneSignalConfig();
  if (!config.appId || !config.restApiKey) {
    throw new Error(`Config OneSignal manquante pour ${appId}`);
  }
  _configCache.set(appId, config);
  return config;
}

/**
 * Pousse des tags sur un playerId OneSignal.
 * PUT /players/{player_id}  body: { app_id, tags: { ... } }
 */
async function _pushTagsToPlayer(config, playerId, tags) {
  return axios({
    method: 'PUT',
    url: `${ONESIGNAL_API}/players/${playerId}`,
    headers: {
      Authorization: `Basic ${config.restApiKey}`,
      'Content-Type': 'application/json',
    },
    data: { app_id: config.appId, tags },
    timeout: 10000,
  }).then((r) => r.data);
}

/**
 * Tag un user comme VIP ou non sur OneSignal pour une app donnée.
 * Trouve tous ses devices actifs avec playerId, pousse le tag is_vip.
 *
 * @param {String} userId
 * @param {String} appId
 * @param {Boolean} isVip
 * @returns {Object} { devicesUpdated, errors }
 */
async function tagUserVip(userId, appId, isVip) {
  if (!userId || !appId) return { devicesUpdated: 0, errors: ['userId et appId requis'] };

  const devices = await Device.find({
    appId,
    user: userId,
    isActive: true,
    playerId: { $exists: true, $nin: [null, ''] },
  }).select('playerId').lean();

  if (devices.length === 0) {
    return { devicesUpdated: 0, errors: [] };
  }

  let config;
  try {
    config = await _getConfig(appId);
  } catch (err) {
    return { devicesUpdated: 0, errors: [err.message] };
  }

  const tags = { is_vip: isVip ? 'true' : 'false' };
  const errors = [];
  let updated = 0;

  // Pousser les tags en parallèle (typiquement 1-3 devices par user, jamais des centaines)
  await Promise.all(
    devices.map(async (d) => {
      try {
        await _pushTagsToPlayer(config, d.playerId, tags);
        updated++;
      } catch (err) {
        const detail = err.response?.data?.errors?.join(' ; ') || err.message;
        errors.push(`playerId=${d.playerId} : ${detail}`);
      }
    })
  );

  return { devicesUpdated: updated, errors };
}

/**
 * Réconciliation : aligne les tags OneSignal avec l'état actuel de la BD.
 * Couvre :
 *   • VIPs actifs → push is_vip='true' (idempotent, corrige les réinstalls)
 *   • Récemment expirés (lookbackDays) → push is_vip='false' (corrige les expirations)
 *
 * Ne touche PAS les users qui n'ont jamais eu de subscription :
 *   ils sont matched par OneSignal filter `is_vip != 'true'` (matche aussi l'absence de tag).
 *
 * @param {Object} opts
 * @param {Number} [opts.lookbackDays=7]  - Fenêtre des expirations à rétrograder
 * @param {String} [opts.appId]           - Limiter à une app
 * @param {Boolean} [opts.dryRun=false]   - Ne rien push (pour audit)
 * @param {Number} [opts.concurrency=10]  - Devices traités en parallèle
 * @returns {Object} stats détaillées
 */
async function reconcileTags({ lookbackDays = 7, appId, dryRun = false, concurrency = 10 } = {}) {
  const startTime = Date.now();
  const now = new Date();
  const since = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  // 1) Récupérer la liste des apps cibles
  const appQuery = appId && appId !== 'all' ? { appId, isActive: true } : { isActive: true };
  const apps = await App.find(appQuery).select('appId').lean();
  if (apps.length === 0) {
    return { error: 'Aucune app trouvée', durationMs: Date.now() - startTime };
  }

  const perApp = [];

  for (const app of apps) {
    const aId = app.appId;
    const stats = {
      appId: aId,
      vipUsersFound: 0,
      expiredUsersFound: 0,
      taggedVip: 0,
      taggedFree: 0,
      noDeviceVip: 0,
      noDeviceFree: 0,
      errors: [],
    };

    try {
      // === VIPs actuels (subscription active, endDate > now) ===
      const vipUsers = await Subscription.aggregate([
        {
          $match: {
            appId: aId,
            status: 'active',
            endDate: { $gt: now },
          },
        },
        { $group: { _id: '$user' } },
      ]);
      const vipUserIds = vipUsers.map((v) => v._id);
      stats.vipUsersFound = vipUserIds.length;

      // === Récemment expirés (sub avec endDate dans [since, now], pas d'autre sub active) ===
      const recentlyExpiredCandidates = await Subscription.aggregate([
        {
          $match: {
            appId: aId,
            endDate: { $gte: since, $lte: now },
          },
        },
        { $group: { _id: '$user' } },
      ]);
      const vipSet = new Set(vipUserIds.map(String));
      const expiredUserIds = recentlyExpiredCandidates
        .map((r) => r._id)
        .filter((id) => !vipSet.has(String(id)));
      stats.expiredUsersFound = expiredUserIds.length;

      // === Push les tags en parallèle limité ===
      const queue = [
        ...vipUserIds.map((uid) => ({ uid, isVip: true })),
        ...expiredUserIds.map((uid) => ({ uid, isVip: false })),
      ];

      // Traitement par chunks pour éviter de saturer OneSignal
      for (let i = 0; i < queue.length; i += concurrency) {
        const chunk = queue.slice(i, i + concurrency);
        await Promise.all(
          chunk.map(async ({ uid, isVip }) => {
            if (dryRun) {
              if (isVip) stats.taggedVip++;
              else stats.taggedFree++;
              return;
            }
            const r = await tagUserVip(uid, aId, isVip);
            if (r.devicesUpdated > 0) {
              if (isVip) stats.taggedVip++;
              else stats.taggedFree++;
            } else {
              if (isVip) stats.noDeviceVip++;
              else stats.noDeviceFree++;
            }
            if (r.errors.length > 0) {
              stats.errors.push(...r.errors.slice(0, 2)); // limite verbosité
            }
          })
        );
      }
    } catch (err) {
      logger.error(`[oneSignalTag] Erreur réconciliation ${aId}: ${err.message}`);
      stats.errors.push(`Fatale : ${err.message}`);
    }

    perApp.push(stats);
  }

  const durationMs = Date.now() - startTime;
  const totals = perApp.reduce(
    (acc, s) => ({
      vip: acc.vip + s.taggedVip,
      free: acc.free + s.taggedFree,
      noDevice: acc.noDevice + s.noDeviceVip + s.noDeviceFree,
    }),
    { vip: 0, free: 0, noDevice: 0 }
  );

  logger.info(
    `[oneSignalTag] Réconciliation terminée — apps=${apps.length} ` +
    `vip=${totals.vip} free=${totals.free} no_device=${totals.noDevice} ` +
    `dryRun=${dryRun} duration=${durationMs}ms`
  );

  return { perApp, totals, durationMs };
}

module.exports = {
  tagUserVip,
  reconcileTags,
};
