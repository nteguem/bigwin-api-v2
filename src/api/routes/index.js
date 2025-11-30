// src/api/routes/index.js

/**
 * @fileoverview Point d'entrée des routes API pour le système BigWin
 * Centralise toutes les routes par type d'utilisateur
 */
const express = require('express');
const { identifyApp, identifyAppOptional } = require('../middlewares/common/appIdentifier');

const router = express.Router();

// ===== ROUTES D'AUTHENTIFICATION =====
const adminAuthRoutes = require('./admin/authRoutes');
const affiliateAuthRoutes = require('./affiliate/authRoutes');
const userAuthRoutes = require('./user/authRoutes');

// Admin: appId optionnel (un admin peut gérer plusieurs apps)
router.use('/admin/auth', identifyAppOptional, adminAuthRoutes);

// Affiliate & User: appId OBLIGATOIRE (chaque affilié/user appartient à une app)
router.use('/affiliate/auth', identifyApp, affiliateAuthRoutes);
router.use('/user/auth', identifyApp, userAuthRoutes);

// ===== ROUTES ADMIN =====
const adminAppRoutes = require('./admin/appRoutes'); // ⭐ NOUVEAU
const adminPackageRoutes = require('./admin/packageRoutes');
const adminCategoryRoutes = require('./admin/categoryRoutes');
const adminTicketRoutes = require('./admin/ticketRoutes');
const adminPredictionRoutes = require('./admin/predictionRoutes');
const adminSportsRoutes = require('./admin/sportsRoutes');
const adminEventRoutes = require('./admin/eventRoutes');
const adminAffiliateRoutes = require('./admin/affiliateRoutes');
const adminCommissionRoutes = require('./admin/commissionRoutes');
const adminAffiliateTypeRoutes = require('./admin/affiliateTypeRoutes');
const adminFormationRoutes = require('./admin/formationRoutes'); 

// ⭐ NOUVEAU : Routes apps (pas besoin de identifyApp car l'admin liste toutes les apps)
router.use('/admin/apps', adminAppRoutes);

// Admin routes: identifyApp pour savoir sur quelle app il travaille
router.use('/admin/packages', identifyApp, adminPackageRoutes);
router.use('/admin/categories', identifyApp, adminCategoryRoutes);
router.use('/admin/tickets', identifyApp, adminTicketRoutes);
router.use('/admin/predictions', identifyApp, adminPredictionRoutes);
router.use('/admin/sports', identifyApp, adminSportsRoutes);
router.use('/admin/events', identifyApp, adminEventRoutes);
router.use('/admin/affiliates', identifyApp, adminAffiliateRoutes);
router.use('/admin/commissions', identifyApp, adminCommissionRoutes);
router.use('/admin/affiliate-types', identifyApp, adminAffiliateTypeRoutes);
router.use('/admin/formations', identifyApp, adminFormationRoutes);

// ===== ROUTES AFFILIATE =====
const affiliateDashboardRoutes = require('./affiliate/dashboardRoutes');

router.use('/affiliate/dashboard', identifyApp, affiliateDashboardRoutes);

// ===== ROUTES USER =====
const userSubscriptionRoutes = require('./user/subscriptionRoutes');
const couponRoutes = require('./user/couponRoutes');
const smobilpayRoutes = require('./user/smobilpayRoutes');
const cinetpayRoutes = require('./user/cinetpayRoutes');
const afribaPayRoutes = require('./user/afribaPayRoutes');
const userFormationRoutes = require('./user/formationRoutes');
const googlePlayRoutes = require('./user/googlePlayRoutes');
const googlePlayWebhook = require('./user/googlePlayWebhook');

router.use('/user/coupons', identifyApp, couponRoutes);
router.use('/user/formations', identifyApp, userFormationRoutes);
router.use('/user', identifyApp, userSubscriptionRoutes);
router.use('/user/google-play', identifyApp, googlePlayRoutes);

// Webhooks: identifyApp pour savoir quelle app est concernée
router.use('/webhooks', identifyApp, googlePlayWebhook);

// ===== ROUTES COMMON =====
const deviceRoutes = require('./common/deviceRoutes');
const topicRoutes = require('./common/topicRoutes');
const notificationRoutes = require('./common/notificationRoutes');

router.use('/devices', identifyApp, deviceRoutes);
router.use('/topics', identifyApp, topicRoutes);
router.use('/notifications', identifyApp, notificationRoutes);

// ===== ROUTES DE PAIEMENT =====
// Routes de paiement: identifyApp OBLIGATOIRE
router.use('/payments/smobilpay', identifyApp, smobilpayRoutes);
router.use('/payments/cinetpay', identifyApp, cinetpayRoutes);
router.use('/payments/afribapay', identifyApp, afribaPayRoutes);

/**
 * GET /api/
 * Documentation des endpoints disponibles
 */
router.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'BigWin API v2 - Multi-Tenant',
    version: '2.0.0',
    multiTenant: true,
    info: {
      appId: req.appId || 'non spécifié',
      note: 'Ajoutez le header X-App-Id pour identifier votre application'
    },
    endpoints: {
      admin: {
        apps: 'GET /admin/apps - Liste des applications',
        packages: 'GET /admin/packages - Gestion des packages',
        categories: 'GET /admin/categories - Gestion des catégories',
        tickets: 'GET /admin/tickets - Gestion des tickets',
        affiliates: 'GET /admin/affiliates - Gestion des affiliés'
      },
      user: {
        coupons: 'GET /user/coupons - Coupons disponibles',
        subscriptions: 'GET /user/subscriptions - Abonnements',
        googlePlay: 'POST /user/google-play/validate - Paiements Google Play'
      },
      affiliate: {
        dashboard: 'GET /affiliate/dashboard - Tableau de bord affilié'
      }
    }
  });
});

module.exports = router;