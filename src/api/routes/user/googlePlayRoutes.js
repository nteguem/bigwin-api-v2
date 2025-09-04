// const express = require('express');
// const {
//   verifyPurchase,
//   verifySubscription,
//   handleWebhook,
//   getUserTransactions,
//   getActiveSubscriptions,
//   getGooglePlayPackages
// } = require('../../controllers/user/googlePlayController');
// const userAuth = require('../../middlewares/user/userAuth');

// const router = express.Router();

// // Routes publiques
// router.get('/packages', getGooglePlayPackages); // Packages disponibles pour Google Play
// router.post('/webhook', handleWebhook); // Webhook Google Play (non protégé)

// // Routes protégées
// router.use(userAuth);

// router.post('/verify-purchase', verifyPurchase); // Produits uniques
// router.post('/verify-subscription', verifySubscription); // Abonnements
// router.get('/transactions', getUserTransactions);
// router.get('/active-subscriptions', getActiveSubscriptions);

// module.exports = router;