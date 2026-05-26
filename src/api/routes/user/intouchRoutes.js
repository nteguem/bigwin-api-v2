// routes/user/intouchRoutes.js
//
// Routes InTouch / TouchPay — montees a /payments/intouch dans routes/index.js.

const express = require('express');
const intouchController = require('../../controllers/user/intouchController');
const userAuth = require('../../middlewares/user/userAuth');

const router = express.Router();

// ---------------------------------------------
//  Route publique — webhook InTouch
// ---------------------------------------------
router.post('/webhook', intouchController.webhook);

// ---------------------------------------------
//  Routes protegees (token utilisateur requis)
// ---------------------------------------------
router.use(userAuth.protect);

router.post('/initiate', intouchController.initiatePayment);
router.get('/status/:transactionId', intouchController.checkStatus);

module.exports = router;
