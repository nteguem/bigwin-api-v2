// src/api/routes/user/fedapayRoutes.js

const express = require('express');
const fedapayController = require('../../controllers/user/fedapayController');
const userAuth = require('../../middlewares/user/userAuth');

const router = express.Router();

/**
 * Routes publiques
 */
router.post('/webhook', fedapayController.webhook);
router.get('/success', fedapayController.paymentSuccess);
router.post('/success', fedapayController.paymentSuccess);

/**
 * Routes protégées
 */
router.use(userAuth.protect);

router.post('/initiate', fedapayController.initiatePayment);
router.get('/status/:transactionId', fedapayController.checkStatus);

module.exports = router;