// src/api/routes/user/affiliateRoutes.js
//
// Routes affiliation côté user. Auth user obligatoire (userAuth.protect).
// Le payout request a son propre fichier (payoutRoutes.js — Phase 1.5).

const express = require('express');
const router = express.Router();

const userAuth = require('../../middlewares/user/userAuth');
const affiliateController = require('../../controllers/user/affiliateController');

router.use(userAuth.protect);

router.post('/activate', affiliateController.activate);
router.get('/me', affiliateController.getMe);
router.post('/payout-method', affiliateController.updatePayoutMethod);
router.get('/link', affiliateController.getShareLink);
router.get('/referrals', affiliateController.listReferrals);
router.get('/commissions', affiliateController.listCommissions);

module.exports = router;
