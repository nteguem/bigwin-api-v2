// src/api/routes/admin/subscriptionRoutes.js

const express = require('express');
const subscriptionController = require('../../controllers/admin/subscriptionController');
const adminAuth = require('../../middlewares/admin/adminAuth');

const router = express.Router();

/**
 * Toutes les routes nécessitent une authentification admin
 */
router.use(adminAuth.protect);

/**
 * Routes principales
 */
router.route('/')
  .get(subscriptionController.getAllSubscriptions);     // GET /api/admin/subscriptions

router.route('/stats')
  .get(subscriptionController.getSubscriptionStats);    // GET /api/admin/subscriptions/stats

module.exports = router;
