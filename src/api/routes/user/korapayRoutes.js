// src/api/routes/user/korapayRoutes.js

const express = require('express');
const korapayController = require('../../controllers/user/korapayController');
const userAuth = require('../../middlewares/user/userAuth');
const { identifyApp } = require('../../middlewares/common/appIdentifier');

const router = express.Router();

/**
 * Routes publiques (appelées par KoraPay)
 * PAS de middleware identifyApp
 */
router.post('/webhook', korapayController.webhook);
router.get('/callback', korapayController.callback);

/**
 * Routes protégées (authentification requise)
 * AVEC identifyApp + userAuth
 */
router.use(identifyApp); // ⬅️ identifyApp pour les routes suivantes
router.use(userAuth.protect);

// Initier un paiement KoraPay (Checkout)
router.post('/initiate', korapayController.initiatePayment);

// Initier un paiement Mobile Money direct
router.post('/mobile-money', korapayController.initiateMobileMoneyPayment);

// Vérifier le statut d'un paiement
router.get('/status/:reference', korapayController.checkTransactionStatus);

module.exports = router;