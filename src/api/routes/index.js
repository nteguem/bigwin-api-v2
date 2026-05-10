// src/api/routes/index.js

/**
 * @fileoverview Point d'entrée des routes API pour le système 
 * Centralise toutes les routes par type d'utilisateur
 */
const express = require('express');
const { identifyApp, identifyAppOptional } = require('../middlewares/common/appIdentifier');
const adminAuth = require('../middlewares/admin/adminAuth');
const { authorize, enforceAppScope, readOnly } = require('../middlewares/admin/rbac');

const router = express.Router();

// Reusable admin-protection chains. Each array is expanded with spread when mounting.
const ADMIN_SUPER     = [adminAuth.protect, authorize('super_admin')];
const ADMIN_PRONO     = [adminAuth.protect, authorize('super_admin', 'pronostiqueur'), enforceAppScope];
const ADMIN_INVESTOR  = [adminAuth.protect, authorize('super_admin', 'investisseur'), enforceAppScope, readOnly];

// On /admin/apps, non-super_admin are read-only.
const appsRoleGuard = (req, res, next) => {
  if (req.admin.role === 'super_admin') return next();
  return readOnly(req, res, next);
};

// ===== ROUTES D'AUTHENTIFICATION =====
const adminAuthRoutes = require('./admin/authRoutes');
const userAuthRoutes = require('./user/authRoutes');

// Admin: appId optionnel (un admin peut gérer plusieurs apps)
router.use('/admin/auth', identifyAppOptional, adminAuthRoutes);

// User: appId OBLIGATOIRE (chaque user appartient à une app)
router.use('/user/auth', identifyApp, userAuthRoutes);

// ===== ROUTES ADMIN =====
const adminAppRoutes = require('./admin/appRoutes');
const adminPackageRoutes = require('./admin/packageRoutes');
const adminCategoryRoutes = require('./admin/categoryRoutes');
const adminTicketRoutes = require('./admin/ticketRoutes');
const adminPredictionRoutes = require('./admin/predictionRoutes');
const adminSportsRoutes = require('./admin/sportsRoutes');
const adminEventRoutes = require('./admin/eventRoutes');
const adminAffiliateRoutes = require('./admin/affiliateRoutes');
const adminFormationRoutes = require('./admin/formationRoutes');
const adminUserRoutes = require('./admin/userRoutes');
const adminDayOffRoutes = require('./admin/dayOffRoutes');
const adminSubscriptionRoutes = require('./admin/subscriptionRoutes');
const adminAdminRoutes = require('./admin/adminRoutes');
const adminGiftRoutes = require('./admin/giftRoutes');
const adminGiftTierRoutes = require('./admin/giftTierRoutes');
const adminUploadRoutes = require('./admin/uploadRoutes');

// RBAC management — super_admin only. Mounted first so it has priority.
router.use('/admin/admins', adminAdminRoutes);

// Apps list — all roles can GET (to resolve their assignedApps); write ops stay super_admin only (enforced in the subroute file or by the matrix).
router.use('/admin/apps', adminAuth.protect, appsRoleGuard, adminAppRoutes);

// Predictions & tickets & sports & events & categories & days-off: super_admin + pronostiqueur
// GET /admin/packages: public (utilisé par les apps Flutter pour lister les packages)
const adminPackageController = require('../controllers/admin/packageController');
router.get('/admin/packages', identifyApp, adminPackageController.getAllPackages);
router.use('/admin/packages',        identifyApp, ...ADMIN_SUPER,  adminPackageRoutes);
router.use('/admin/categories',      identifyApp, ...ADMIN_PRONO,  adminCategoryRoutes);
router.use('/admin/tickets',         identifyApp, ...ADMIN_PRONO,  adminTicketRoutes);
router.use('/admin/predictions',     identifyApp, ...ADMIN_PRONO,  adminPredictionRoutes);
router.use('/admin/sports',          identifyApp, ...ADMIN_PRONO,  adminSportsRoutes);
router.use('/admin/events',          identifyApp, ...ADMIN_PRONO,  adminEventRoutes);
router.use('/admin/day-off',         identifyApp, ...ADMIN_PRONO,  adminDayOffRoutes);

// Users / formations — super_admin only
// Uploads génériques admin (super_admin only — auth dans le subrouter)
router.use('/admin/uploads',         adminUploadRoutes);

// Gift tiers admin — super_admin only, GLOBAL (pas scopé app)
router.use('/admin/gift-tiers',      adminAuth.protect, authorize('super_admin'), adminGiftTierRoutes);

// Gifts admin — super_admin only, scoped à l'app
router.use('/admin/gifts',           identifyApp, ...ADMIN_SUPER,  adminGiftRoutes);

router.use('/admin/formations',      identifyApp, ...ADMIN_SUPER,  adminFormationRoutes);
router.use('/admin/affiliates',      identifyApp, ...ADMIN_SUPER,  adminAffiliateRoutes);
// Users: stats accessible aux investisseurs (read-only, scoped à leurs apps); le reste reste super_admin only
const adminUserController = require('../controllers/admin/userController');
router.get('/admin/users/stats',     identifyAppOptional, adminAuth.protect, authorize('super_admin', 'investisseur'), enforceAppScope, readOnly, adminUserController.getUserStats);
router.use('/admin/users',           identifyApp, ...ADMIN_SUPER,  adminUserRoutes);

// Subscriptions (sales/ventes) — super_admin full, investisseur read-only
// Stats route accepte appId=all pour super_admin (X-App-Id optionnel)
const adminSubscriptionController = require('../controllers/admin/subscriptionController');
router.get('/admin/subscriptions/stats', identifyAppOptional, adminAuth.protect, authorize('super_admin', 'investisseur'), enforceAppScope, readOnly, adminSubscriptionController.getSubscriptionStats);
router.use('/admin/subscriptions',   identifyApp, ...ADMIN_INVESTOR, adminSubscriptionRoutes);

const adminAdmobRoutes = require('./admin/admobRoutes');
router.use('/admin/admob', adminAuth.protect, authorize('super_admin'), adminAdmobRoutes);

const adminInstallStatsRoutes = require('./admin/installStatsRoutes');
router.use('/admin/installs', adminAuth.protect, authorize('super_admin'), adminInstallStatsRoutes);

const adminAcquisitionStatsRoutes = require('./admin/acquisitionStatsRoutes');
router.use('/admin/acquisition', adminAuth.protect, authorize('super_admin'), adminAcquisitionStatsRoutes);

const adminAnalyticsRoutes = require('./admin/analyticsRoutes');
router.use('/admin/analytics', adminAuth.protect, authorize('super_admin'), adminAnalyticsRoutes);

// Logs applicatifs : super_admin only. Pas de filtre X-App-Id au niveau
// route — le super_admin peut consulter tous les tenants. Le filtre par app
// se fait via le query param `?appId=xxx` géré dans le controller.
const adminLogsRoutes = require('./admin/logsRoutes');
router.use('/admin/logs', adminAuth.protect, authorize('super_admin'), adminLogsRoutes);

// ===== ROUTES USER =====
const userSubscriptionRoutes = require('./user/subscriptionRoutes');
const couponRoutes = require('./user/couponRoutes');
const smobilpayRoutes = require('./user/smobilpayRoutes');
const cinetpayRoutes = require('./user/cinetpayRoutes');
const afribaPayRoutes = require('./user/afribaPayRoutes');
const flutterwaveRoutes = require('./user/flutterwaveRoutes');
const userFormationRoutes = require('./user/formationRoutes');
const googlePlayRoutes = require('./user/googlePlayRoutes');
const googlePlayWebhook = require('./user/googlePlayWebhook');
const packageRoutes = require('./user/packageRoutes');
const korapayRoutes = require('./user/korapayRoutes');
const fedapayRoutes = require('./user/fedapayRoutes');
const userGiftRoutes = require('./user/giftRoutes');
const userAffiliateRoutes = require('./user/affiliateRoutes');


// ===== ROUTES DE PAIEMENT =====
// ⚠️ CRITIQUE: Routes de paiement AVANT la route générique /user
router.use('/payments/smobilpay', identifyAppOptional, smobilpayRoutes);
router.use('/payments/cinetpay', identifyAppOptional, cinetpayRoutes);
router.use('/payments/afribapay', identifyAppOptional, afribaPayRoutes);
router.use('/payments/flutterwave', identifyAppOptional, flutterwaveRoutes);
router.use('/payments/korapay', korapayRoutes);
router.use('/payments/fedapay', identifyAppOptional, fedapayRoutes);
// ⚠️ IMPORTANT: Routes spécifiques AVANT la route générique /user
router.use('/user/coupons', identifyApp, couponRoutes);
router.use('/user/formations', identifyApp, userFormationRoutes);
router.use('/user/google-play', identifyApp, googlePlayRoutes);
router.use('/user/packages', identifyApp, packageRoutes);
router.use('/user/gifts', identifyApp, userGiftRoutes);
router.use('/user/affiliate', identifyApp, userAffiliateRoutes);

// Route générique /user EN DERNIER (sinon elle capture toutes les requêtes /user/*)
router.use('/user', identifyApp, userSubscriptionRoutes);

// Webhooks: identifyApp pour savoir quelle app est concernée
router.use('/webhooks', identifyAppOptional, googlePlayWebhook);

// Webhook AfribaPay payout — pas de X-App-Id (l'app est résolue via
// le order_id de la PayoutRequest) et pas d'auth (sécurisé via HMAC).
const afribaPayPayoutWebhookCtrl = require('../controllers/common/afribaPayPayoutWebhookController');
router.post(
  '/webhooks/afribapay/payout',
  afribaPayPayoutWebhookCtrl.handlePayoutWebhook
);

// ===== ROUTES COMMON =====
const deviceRoutes = require('./common/deviceRoutes');
const topicRoutes = require('./common/topicRoutes');
const notificationRoutes = require('./common/notificationRoutes');
const configRoutes = require('./common/configRoutes');
const appInfoRoutes = require('./common/appInfoRoutes');

router.use('/devices', identifyApp, deviceRoutes);
router.use('/topics', identifyApp, topicRoutes);
router.use('/notifications', identifyApp, notificationRoutes);
router.use('/config', configRoutes);

// App info publique : branding + Play Store + support email
// (utilisé par le portail affilié, futur landing page, etc.)
router.use('/app', identifyApp, appInfoRoutes);

/**
 * GET /api/
 * Documentation des endpoints disponibles
 */
router.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'proxidream API v2 - Multi-Tenant',
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
        users: 'GET /admin/users - Gestion des utilisateurs',
        config: 'GET /admin/config - Gestion des configurations pays'
      },
      user: {
        coupons: 'GET /user/coupons - Coupons disponibles',
        subscriptions: 'GET /user/subscriptions - Abonnements',
        packages: 'GET /user/packages - Packages disponibles',
        googlePlay: 'POST /user/google-play/validate - Paiements Google Play'
      },
      common: {
        config: 'POST /config - Obtenir config par IP',
        configByCountry: 'GET /config/:countryCode - Config par code pays'
      },
      payments: {
        smobilpay: 'POST /payments/smobilpay/initiate - Paiement SmobilPay',
        cinetpay: 'POST /payments/cinetpay/initiate - Paiement CinetPay',
        afribapay: 'POST /payments/afribapay/initiate - Paiement AfribaPay',
        flutterwave: 'POST /payments/flutterwave/initiate - Paiement Flutterwave Mobile Money',
        korapay: 'POST /payments/korapay/initiate - Paiement KoraPay' 
      }
    }
  });
});

module.exports = router;