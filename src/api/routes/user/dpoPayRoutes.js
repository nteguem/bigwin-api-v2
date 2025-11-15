// routes/user/dpoPayRoutes.js
const express = require('express');
const dpoPayController = require('../../controllers/user/dpoPayController');
const userAuth = require('../../middlewares/user/userAuth');

const router = express.Router();

/**
 * Routes publiques (callbacks DPO)
 */
// Redirection après paiement réussi
router.get('/success', dpoPayController.handleRedirect);

// Redirection si annulation
router.get('/cancel', dpoPayController.handleCancel);

/**
 * Routes protégées (authentification requise)
 */
router.use(userAuth.protect);

// Initier un paiement DPO Pay
router.post('/initiate', dpoPayController.initiatePayment);

// Vérifier le statut d'un paiement
router.get('/status/:orderId', dpoPayController.checkStatus);

module.exports = router;