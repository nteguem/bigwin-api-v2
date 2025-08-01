const express = require('express');
const subscriptionController = require('../../controllers/user/subscriptionController');
const packageController = require('../../controllers/user/packageController');
const userAuth = require('../../middlewares/user/userAuth');

const router = express.Router();

/**
 * Routes publiques (consultation packages)
 */
router.get('/packages', packageController.getAvailablePackages);           // GET /api/user/packages
router.get('/packages/recommended', packageController.getRecommendedPackages); // GET /api/user/packages/recommended
router.get('/packages/search', packageController.searchPackages);         // GET /api/user/packages/search
router.get('/packages/compare', packageController.comparePackages);       // GET /api/user/packages/compare
router.get('/packages/category/:categoryId', packageController.getPackagesByCategory); // GET /api/user/packages/category/:categoryId
router.get('/packages/:id', packageController.getPackage);                // GET /api/user/packages/:id

/**
 * Routes protégées (authentification requise)
 */
router.use(userAuth.protect);

// Gestion des abonnements
router.route('/subscriptions')
  .get(subscriptionController.getMySubscriptions)      // GET /api/user/subscriptions
  .post(subscriptionController.purchasePackage);       // POST /api/user/subscriptions

router.get('/subscriptions/active', subscriptionController.getMyActiveSubscriptions); // GET /api/user/subscriptions/active
router.get('/subscriptions/status', subscriptionController.getSubscriptionStatus);    // GET /api/user/subscriptions/status
router.get('/subscriptions/history', subscriptionController.getSubscriptionHistory);  // GET /api/user/subscriptions/history

router.route('/subscriptions/:id')
  .get(subscriptionController.getSubscription)         // GET /api/user/subscriptions/:id
  .delete(subscriptionController.cancelSubscription);  // DELETE /api/user/subscriptions/:id

router.post('/subscriptions/:id/renew', subscriptionController.renewSubscription);    // POST /api/user/subscriptions/:id/renew

// Vérification d'accès
router.get('/access/category/:categoryId', subscriptionController.checkCategoryAccess); // GET /api/user/access/category/:categoryId

module.exports = router;