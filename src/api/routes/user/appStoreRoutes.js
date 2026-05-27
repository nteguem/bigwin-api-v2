const express = require('express');
const router = express.Router();
const appStoreController = require('../../controllers/user/appStoreController');
const userAuth = require('../../middlewares/user/userAuth');

// Toutes les routes nécessitent l'authentification utilisateur.
router.use(userAuth.protect);

// Valider un achat App Store (abonnement auto-renouvelable).
// Body: { signedTransaction, productId, packageId }
router.post('/validate-purchase', appStoreController.validatePurchase);

// Valider un achat App Store one-time (consumable / non-renouvelable).
router.post('/validate-one-time-purchase', appStoreController.validateOneTimePurchase);

// Récupérer les infos App Store d'un package — appleProductId, productType, etc.
router.get('/products/:packageId', appStoreController.getAppleProductInfo);

module.exports = router;
