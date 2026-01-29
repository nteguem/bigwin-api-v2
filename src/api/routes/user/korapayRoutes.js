const express = require('express');
const korapayController = require('../../controllers/user/korapayController');
const userAuth = require('../../middlewares/user/userAuth');

const router = express.Router();

// ===== ROUTES PUBLIQUES (AVANT router.use) =====
router.post('/webhook', korapayController.webhook);
router.get('/callback', korapayController.callback);

// ===== ROUTES PROTÉGÉES (APRÈS) =====
router.use(userAuth.protect); // Authentification pour toutes les routes suivantes

router.post('/initiate', korapayController.initiatePayment);
router.post('/mobile-money', korapayController.initiateMobileMoneyPayment);
router.get('/status/:reference', korapayController.checkTransactionStatus);

module.exports = router;