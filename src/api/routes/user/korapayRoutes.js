// src/api/routes/user/korapayRoutes.js

const express = require('express');
const korapayController = require('../../controllers/user/korapayController');
const userAuth = require('../../middlewares/user/userAuth');

const router = express.Router();

/**
 * Routes publiques (appelées par KoraPay)
 * PAS de middleware du tout
 */
router.post('/webhook', korapayController.webhook);
router.get('/callback', korapayController.callback);

/**
 * Routes protégées (authentification requise)
 * identifyApp extrait l'appId du header X-App-Id
 * userAuth vérifie le token
 */
const { identifyApp } = require('../../middlewares/common/appIdentifier');
router.use(identifyApp); // Pour les 3 routes suivantes
router.use(userAuth.protect);

router.post('/initiate', korapayController.initiatePayment);
router.post('/mobile-money', korapayController.initiateMobileMoneyPayment);
router.get('/status/:reference', korapayController.checkTransactionStatus);

module.exports = router;