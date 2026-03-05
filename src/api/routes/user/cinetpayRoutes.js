// routes/user/cinetpayRoutes.js
const express = require('express');
const cinetpayController = require('../../controllers/user/cinetpayController');
const userAuth = require('../../middlewares/user/userAuth');

const router = express.Router();

// ---------------------------------------------
//  Routes publiques (callbacks CinetPay)
// ---------------------------------------------

// Webhook — CinetPay notifie ici quand paiement SUCCESS ou FAILED
router.post('/webhook', cinetpayController.webhook);

// Page de retour succes — l'utilisateur est redirige ici apres paiement reussi
router.get('/success', cinetpayController.paymentSuccess);
router.post('/success', cinetpayController.paymentSuccess);

// Page de retour echec — l'utilisateur est redirige ici apres paiement echoue
router.get('/failed', cinetpayController.paymentFailed);
router.post('/failed', cinetpayController.paymentFailed);

// ---------------------------------------------
//  Routes protegees (token utilisateur requis)
// ---------------------------------------------
router.use(userAuth.protect);

// Initier un paiement
router.post('/initiate', cinetpayController.initiatePayment);

// Verifier le statut d'un paiement
router.get('/status/:transactionId', cinetpayController.checkStatus);

module.exports = router;