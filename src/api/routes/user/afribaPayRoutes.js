// routes/user/afribaPayRoutes.js
const express = require('express');
const afribaPayController = require('../../controllers/user/afribaPayController');
const userAuth = require('../../middlewares/user/userAuth');

const router = express.Router();

/**
 * Routes publiques
 */
// Récupérer les pays et opérateurs
router.get('/countries', afribaPayController.getCountries);

// Vérifier si OTP requis 
router.get('/check-otp', afribaPayController.checkOtpRequirement);

/**
 * Webhook (non protégé par userAuth, mais identifyApp est appliqué au niveau parent)
 */
router.post('/webhook', afribaPayController.webhook);

/**
 * Routes protégées (authentification requise)
 */
router.use(userAuth.protect);

// Étape 1 du flow 2-step pour les wallets (Coris, LigdiCash…) :
// envoie un OTP au téléphone du user
router.post('/request-otp', afribaPayController.requestOtp);

// Initier un paiement AfribaPay (étape 2 pour wallet, étape unique sinon)
router.post('/initiate', afribaPayController.initiatePayment);

// Vérifier le statut d'un paiement
router.get('/status/:orderId', afribaPayController.checkStatus);

module.exports = router;