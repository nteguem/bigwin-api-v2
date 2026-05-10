// src/api/routes/admin/affiliateRoutes.js
//
// Routes admin pour la section Affiliation du backoffice bigwin-admin.
// Auth admin appliquée au moment du `router.use()` dans routes/index.js.
// Scope par app via `identifyApp` (X-App-Id header).

const express = require('express');
const router = express.Router();

const ctrl = require('../../controllers/admin/affiliateAdminController');

// ===== Affiliates =====
router.get('/', ctrl.listAffiliates);
router.get('/payout-requests', ctrl.listPayoutRequests);
router.get('/payout-requests/:payoutId', ctrl.getPayoutRequest);
router.get('/funding-requests', ctrl.listFundingRequests);
router.get('/config', ctrl.getConfig);
router.patch('/config', ctrl.updateConfig);
router.get('/available-countries', ctrl.listAvailableCountries);

// Routes avec :userId — placées APRÈS les routes statiques pour éviter
// que /payout-requests soit matché comme un userId.
router.get('/:userId', ctrl.getAffiliate);
router.post('/:userId/suspend', ctrl.suspendAffiliate);
router.post('/:userId/unsuspend', ctrl.unsuspendAffiliate);

module.exports = router;
