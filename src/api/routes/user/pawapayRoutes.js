// routes/user/pawapayRoutes.js
//
// Routes pawaPay — montees a /payments/pawapay dans routes/index.js.

const express = require('express');
const pawapayController = require('../../controllers/user/pawapayController');
const userAuth = require('../../middlewares/user/userAuth');

const router = express.Router();

// ---------------------------------------------
//  Route publique — webhook pawaPay
// ---------------------------------------------
router.post('/webhook', pawapayController.webhook);

// ---------------------------------------------
//  Routes protegees (token utilisateur requis)
// ---------------------------------------------
router.use(userAuth.protect);

router.post('/initiate', pawapayController.initiatePayment);
router.get('/status/:depositId', pawapayController.checkStatus);

module.exports = router;
