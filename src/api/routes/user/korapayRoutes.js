// src/api/routes/user/korapayRoutes.js

const express = require('express');
const korapayController = require('../../controllers/user/korapayController');
const userAuth = require('../../middlewares/user/userAuth');

const router = express.Router();

/**
 * Routes publiques pour les callbacks
 */

// Webhook pour les notifications KoraPay (non protégé)
router.post('/webhook', korapayController.webhook);

// Page de retour après paiement (non protégé car l'utilisateur vient de KoraPay)
router.get('/callback', korapayController.callback);

/**
 * Routes protégées (authentification requise)
 */
router.use(userAuth.protect);

// Initier un paiement KoraPay (Checkout)
router.post('/initiate', korapayController.initiatePayment);

// Initier un paiement Mobile Money direct
router.post('/mobile-money', korapayController.initiateMobileMoneyPayment);

// Vérifier le statut d'un paiement
router.get('/status/:reference', korapayController.checkTransactionStatus);

module.exports = router;