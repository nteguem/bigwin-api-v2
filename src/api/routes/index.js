/**
 * @fileoverview Point d'entrée des routes API pour le système BigWin
 * Centralise toutes les routes par type d'utilisateur
 */
const express = require('express');

const router = express.Router();

// ===== ROUTES D'AUTHENTIFICATION =====
const adminAuthRoutes = require('./admin/authRoutes');
const affiliateAuthRoutes = require('./affiliate/authRoutes');
const userAuthRoutes = require('./user/authRoutes');

router.use('/admin/auth', adminAuthRoutes);
router.use('/affiliate/auth', affiliateAuthRoutes);
router.use('/user/auth', userAuthRoutes);

// ===== ROUTES ADMIN =====
const adminPackageRoutes = require('./admin/packageRoutes');
const adminCategoryRoutes = require('./admin/categoryRoutes');
const adminTicketRoutes = require('./admin/ticketRoutes');
const adminPredictionRoutes = require('./admin/predictionRoutes');
const adminSportsRoutes = require('./admin/sportsRoutes');
const adminEventRoutes = require('./admin/eventRoutes');
const adminAffiliateRoutes = require('./admin/affiliateRoutes');
const adminCommissionRoutes = require('./admin/commissionRoutes');
const adminAffiliateTypeRoutes = require('./admin/affiliateTypeRoutes');

router.use('/admin/packages', adminPackageRoutes);
router.use('/admin/categories', adminCategoryRoutes);
router.use('/admin/tickets', adminTicketRoutes);
router.use('/admin/predictions', adminPredictionRoutes);
router.use('/admin/sports', adminSportsRoutes);
router.use('/admin/events', adminEventRoutes);
router.use('/admin/affiliates', adminAffiliateRoutes);
router.use('/admin/commissions', adminCommissionRoutes);
router.use('/admin/affiliate-types', adminAffiliateTypeRoutes);

// ===== ROUTES AFFILIATE =====
const affiliateDashboardRoutes = require('./affiliate/dashboardRoutes');

router.use('/affiliate/dashboard', affiliateDashboardRoutes);

// ===== ROUTES USER =====
const userSubscriptionRoutes = require('./user/subscriptionRoutes');
const couponRoutes = require('./user/couponRoutes');
const smobilpayRoutes = require('./user/smobilpayRoutes');
const cinetpayRoutes = require('./user/cinetpayRoutes');
const afribaPayRoutes = require('./user/afribaPayRoutes');

router.use('/user/coupons', couponRoutes);
router.use('/user', userSubscriptionRoutes); // Inclut packages + subscriptions
// ===== ROUTES COMMON =====
const deviceRoutes = require('./common/deviceRoutes');

router.use('/devices', deviceRoutes);
// ===== POINT D'ENTRÉE API =====
// Routes de paiement Smobilpay
router.use('/payments/smobilpay', smobilpayRoutes);
// Routes de paiement CinetPay
router.use('/payments/cinetpay', cinetpayRoutes);
// Routes de paiement AfribaPay
router.use('/payments/afribapay', afribaPayRoutes);
module.exports = router;
/**
 * GET /api/
 * Documentation des endpoints disponibles
 */
router.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'BigWin API v2',
    version: '2.0.0',
  });
});

module.exports = router;