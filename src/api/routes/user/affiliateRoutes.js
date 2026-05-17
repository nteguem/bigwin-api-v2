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
router.get('/eligible-countries', affiliateController.listEligibleCountries);

// Porte publicitaire avant activation (regarder N pubs récompensées).
// Compteur cumulatif côté serveur : l'user peut quitter et reprendre.
router.get('/ad-gate', affiliateController.getAdGateProgress);
router.post('/ad-gate/start', affiliateController.startAdGate);
router.post('/payout-method', affiliateController.setPayoutMethod);
router.get('/link', affiliateController.getShareLink);
router.get('/referrals', affiliateController.listReferrals);
router.get('/referrals/:id', affiliateController.getReferralDetail);
router.get('/commissions', affiliateController.listCommissions);
router.get('/commissions/:id', affiliateController.getCommissionDetail);
router.post('/payout', affiliateController.requestPayout);
router.get('/payouts', affiliateController.listPayouts);
router.get('/payouts/:id', affiliateController.getPayoutDetail);

module.exports = router;
