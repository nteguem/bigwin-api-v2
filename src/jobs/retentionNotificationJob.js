// jobs/retentionNotificationJob.js
// Notifications automatiques de rétention utilisateurs
// Scénarios : bienvenue J+1, inactivité 3j, expiration J-3, J-1, win-back J+1

const cron = require('node-cron');
const App = require('../api/models/common/App');
const User = require('../api/models/user/User');
const Device = require('../api/models/common/Device');
const Subscription = require('../api/models/common/Subscription');
const notificationService = require('../api/services/common/notificationService');
const logger = require('../utils/logger');

// ─── Helpers ───────────────────────────────────────────────

/**
 * Récupérer les playerIds actifs pour une liste d'userIds (batch, 1 seule query)
 */
const getPlayerIdsByUsers = async (appId, userIds) => {
  if (!userIds.length) return [];

  const devices = await Device.find({
    appId,
    user: { $in: userIds },
    isActive: true,
    playerId: { $exists: true, $ne: null },
  }).select('playerId').lean();

  // Dédupliquer les playerIds
  const uniqueIds = [...new Set(devices.map(d => d.playerId).filter(Boolean))];
  return uniqueIds;
};

/**
 * Envoyer une notification de rétention en batch (max 2000 playerIds par appel OneSignal)
 */
const sendRetention = async (appId, playerIds, notification) => {
  if (!playerIds.length) return 0;

  const BATCH = 2000;
  let sent = 0;
  for (let i = 0; i < playerIds.length; i += BATCH) {
    const batch = playerIds.slice(i, i + BATCH);
    try {
      await notificationService.sendToUsers(appId, batch, notification);
      sent += batch.length;
    } catch (err) {
      logger.error(`[RETENTION] Erreur envoi batch (${appId}):`, err.message);
    }
  }
  return sent;
};

/**
 * Récupérer toutes les apps actives avec OneSignal configuré
 */
const getActiveApps = async () => {
  return App.find({
    isActive: true,
    'oneSignal.appId': { $exists: true, $ne: null },
    'oneSignal.restApiKey': { $exists: true, $ne: null },
  }).lean();
};

// ─── Scénario 1 : Bienvenue J+1 après inscription ─────────

const welcomeJ1 = async () => {
  logger.info('[RETENTION] Début : Bienvenue J+1');

  const apps = await getActiveApps();
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const dayBefore = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  for (const app of apps) {
    try {
      // Utilisateurs inscrits il y a 24-48h (1 seule query)
      const users = await User.find({
        appId: app.appId,
        isActive: true,
        createdAt: { $gte: dayBefore, $lt: yesterday },
      }).select('_id').lean();

      if (!users.length) continue;

      // 1 seule query pour tous les playerIds
      const playerIds = await getPlayerIdsByUsers(app.appId, users.map(u => u._id));
      if (!playerIds.length) continue;

      const sent = await sendRetention(app.appId, playerIds, {
        headings: {
          fr: '👋 Bienvenue parmi nous !',
          en: '👋 Welcome aboard!',
        },
        contents: {
          fr: 'Découvrez vos premiers pronostics gratuits du jour. Nos experts ont préparé des analyses pour vous !',
          en: 'Check out your first free predictions of the day. Our experts have prepared analyses for you!',
        },
        data: {
          type: 'retention_welcome',
          action: 'view_predictions',
        },
        options: {
          android_accent_color: '10B981',
          small_icon: 'ic_notification',
          priority: 7,
        },
      });

      logger.info(`[RETENTION] Bienvenue J+1 — ${app.appId}: ${users.length} users, ${sent} notifiés`);
    } catch (err) {
      logger.error(`[RETENTION] Erreur bienvenue J+1 (${app.appId}):`, err.message);
    }
  }
};

// ─── Scénario 2 : Inactivité 3 jours ──────────────────────

const inactivity3d = async () => {
  logger.info('[RETENTION] Début : Inactivité 3 jours');

  const apps = await getActiveApps();
  const now = new Date();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000);

  for (const app of apps) {
    try {
      // 1 seule query — Device a déjà playerId, pas besoin de passer par User
      const devices = await Device.find({
        appId: app.appId,
        isActive: true,
        user: { $exists: true, $ne: null },
        playerId: { $exists: true, $ne: null },
        lastActiveAt: { $gte: fourDaysAgo, $lt: threeDaysAgo },
      }).select('playerId').lean();

      const playerIds = [...new Set(devices.map(d => d.playerId).filter(Boolean))];
      if (!playerIds.length) continue;

      const sent = await sendRetention(app.appId, playerIds, {
        headings: {
          fr: '🔥 Vous nous manquez !',
          en: '🔥 We miss you!',
        },
        contents: {
          fr: 'Nos pronostics du jour sont prêts ! Ne manquez pas les meilleures opportunités de la journée.',
          en: "Today's predictions are ready! Don't miss the best opportunities of the day.",
        },
        data: {
          type: 'retention_inactivity',
          action: 'view_predictions',
        },
        options: {
          android_accent_color: 'F59E0B',
          small_icon: 'ic_notification',
          priority: 7,
        },
      });

      logger.info(`[RETENTION] Inactivité 3j — ${app.appId}: ${sent} notifiés`);
    } catch (err) {
      logger.error(`[RETENTION] Erreur inactivité 3j (${app.appId}):`, err.message);
    }
  }
};

// ─── Scénario 3 : Expiration VIP J-3 ──────────────────────

const expirationJ3 = async () => {
  logger.info('[RETENTION] Début : Expiration VIP J-3');

  const apps = await getActiveApps();
  const now = new Date();
  const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const in2Days = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

  for (const app of apps) {
    try {
      // Pre-hook find() ajoute endDate > now, compatible car in2Days > now
      const subscriptions = await Subscription.find({
        appId: app.appId,
        status: 'active',
        autoRenewing: { $ne: true },
        endDate: { $gt: in2Days, $lte: in3Days },
      }).select('user').lean();

      if (!subscriptions.length) continue;

      // 1 seule query batch pour les playerIds
      const userIds = subscriptions.map(s => s.user);
      const playerIds = await getPlayerIdsByUsers(app.appId, userIds);
      if (!playerIds.length) continue;

      const sent = await sendRetention(app.appId, playerIds, {
        headings: {
          fr: '⏳ Votre VIP expire dans 3 jours',
          en: '⏳ Your VIP expires in 3 days',
        },
        contents: {
          fr: 'Renouvelez maintenant pour continuer à profiter de tous vos pronostics premium sans interruption.',
          en: 'Renew now to keep enjoying all your premium predictions without interruption.',
        },
        data: {
          type: 'retention_expiring',
          daysLeft: 3,
          action: 'view_subscription',
        },
        options: {
          android_accent_color: 'F59E0B',
          small_icon: 'ic_notification',
          priority: 8,
        },
      });

      logger.info(`[RETENTION] Expiration J-3 — ${app.appId}: ${subscriptions.length} subs, ${sent} notifiés`);
    } catch (err) {
      logger.error(`[RETENTION] Erreur expiration J-3 (${app.appId}):`, err.message);
    }
  }
};

// ─── Scénario 4 : Expiration VIP J-1 (urgence) ────────────

const expirationJ1 = async () => {
  logger.info('[RETENTION] Début : Expiration VIP J-1');

  const apps = await getActiveApps();
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  for (const app of apps) {
    try {
      const subscriptions = await Subscription.find({
        appId: app.appId,
        status: 'active',
        autoRenewing: { $ne: true },
        endDate: { $gt: now, $lte: tomorrow },
      }).select('user').lean();

      if (!subscriptions.length) continue;

      const userIds = subscriptions.map(s => s.user);
      const playerIds = await getPlayerIdsByUsers(app.appId, userIds);
      if (!playerIds.length) continue;

      const sent = await sendRetention(app.appId, playerIds, {
        headings: {
          fr: '🚨 Dernier jour VIP !',
          en: '🚨 Last day of VIP!',
        },
        contents: {
          fr: 'Votre abonnement expire demain. Renouvelez maintenant pour ne rien manquer !',
          en: 'Your subscription expires tomorrow. Renew now so you don\'t miss anything!',
        },
        data: {
          type: 'retention_expiring_urgent',
          daysLeft: 1,
          action: 'view_subscription',
        },
        options: {
          android_accent_color: 'EF4444',
          small_icon: 'ic_notification',
          priority: 10,
        },
      });

      logger.info(`[RETENTION] Expiration J-1 — ${app.appId}: ${subscriptions.length} subs, ${sent} notifiés`);
    } catch (err) {
      logger.error(`[RETENTION] Erreur expiration J-1 (${app.appId}):`, err.message);
    }
  }
};

// ─── Scénario 5 : Win-back J+1 après expiration ───────────

const winbackJ1 = async () => {
  logger.info('[RETENTION] Début : Win-back J+1');

  const apps = await getActiveApps();
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const dayBefore = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  for (const app of apps) {
    try {
      // Bypass le pre-hook Mongoose find() qui force endDate > now
      // car ici on cherche des abonnements EXPIRÉS (endDate dans le passé)
      const expiredSubs = await Subscription.collection.find({
        appId: app.appId,
        status: 'expired',
        endDate: { $gte: dayBefore, $lt: yesterday },
      }).project({ user: 1 }).toArray();

      if (!expiredSubs.length) continue;

      // Vérifier qu'ils n'ont pas déjà re-souscrit (1 query batch)
      const userIds = expiredSubs.map(s => s.user);
      const activeResubs = await Subscription.find({
        appId: app.appId,
        user: { $in: userIds },
        status: 'active',
      }).select('user').lean();

      const resubUserIds = new Set(activeResubs.map(s => s.user.toString()));
      const targetUserIds = userIds.filter(uid => !resubUserIds.has(uid.toString()));

      if (!targetUserIds.length) continue;

      // 1 seule query batch pour les playerIds
      const playerIds = await getPlayerIdsByUsers(app.appId, targetUserIds);
      if (!playerIds.length) continue;

      const sent = await sendRetention(app.appId, playerIds, {
        headings: {
          fr: '😢 Vos pronostics VIP vous attendent',
          en: '😢 Your VIP predictions are waiting',
        },
        contents: {
          fr: 'Votre abonnement a expiré. Revenez profiter de nos pronostics premium et ne manquez plus aucune opportunité !',
          en: 'Your subscription has expired. Come back and enjoy our premium predictions — don\'t miss any more opportunities!',
        },
        data: {
          type: 'retention_winback',
          action: 'view_subscription',
        },
        options: {
          android_accent_color: '8B5CF6',
          small_icon: 'ic_notification',
          priority: 8,
        },
      });

      logger.info(`[RETENTION] Win-back J+1 — ${app.appId}: ${expiredSubs.length} expirés, ${targetUserIds.length} ciblés, ${sent} notifiés`);
    } catch (err) {
      logger.error(`[RETENTION] Erreur win-back J+1 (${app.appId}):`, err.message);
    }
  }
};

// ─── Cron Jobs ─────────────────────────────────────────────

// 9h UTC = 10h Cameroun — bon moment pour les notifs du matin
const morningJob = cron.schedule('0 9 * * *', async () => {
  logger.info('[RETENTION] === Cycle matin (9h UTC) ===');
  await welcomeJ1();
  await inactivity3d();
  await expirationJ3();
}, { scheduled: false });

// 18h UTC = 19h Cameroun — rappels urgents en soirée
const eveningJob = cron.schedule('0 18 * * *', async () => {
  logger.info('[RETENTION] === Cycle soir (18h UTC) ===');
  await expirationJ1();
  await winbackJ1();
}, { scheduled: false });

// ─── Export ────────────────────────────────────────────────

module.exports = {
  start: () => {
    logger.info('[RETENTION] Démarrage des jobs de rétention');
    morningJob.start();
    eveningJob.start();
  },

  stop: () => {
    logger.info('[RETENTION] Arrêt des jobs de rétention');
    morningJob.stop();
    eveningJob.stop();
  },

  // Exécution manuelle pour test
  runAllNow: async () => {
    logger.info('[RETENTION] Exécution manuelle de tous les scénarios');
    await welcomeJ1();
    await inactivity3d();
    await expirationJ3();
    await expirationJ1();
    await winbackJ1();
    logger.info('[RETENTION] Exécution manuelle terminée');
  },

  // Exécution individuelle pour test
  runWelcome: welcomeJ1,
  runInactivity: inactivity3d,
  runExpirationJ3: expirationJ3,
  runExpirationJ1: expirationJ1,
  runWinback: winbackJ1,
};
