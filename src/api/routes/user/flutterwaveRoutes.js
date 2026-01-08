// routes/user/flutterwaveRoutes.js
const express = require('express');
const flutterwaveController = require('../../controllers/user/flutterwaveController');
const userAuth = require('../../middlewares/user/userAuth');

const router = express.Router();

/**
 * Routes publiques pour les callbacks
 */

// Webhook pour les notifications Flutterwave (non protégé)
router.post('/webhook', flutterwaveController.webhook);

/**
 * Routes protégées (authentification requise)
 */
router.use(userAuth.protect);

// Initier un paiement Flutterwave Mobile Money
router.post('/initiate', flutterwaveController.initiatePayment);

// Vérifier le statut d'un paiement
router.get('/status/:transactionId', flutterwaveController.checkStatus);

// Obtenir les réseaux disponibles pour une devise
router.get('/networks/:currency', flutterwaveController.getAvailableNetworks);

// Obtenir toutes les devises supportées
router.get('/currencies', flutterwaveController.getSupportedCurrencies);

module.exports = router;