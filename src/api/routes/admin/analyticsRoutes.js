const express = require('express');
const analyticsController = require('../../controllers/admin/analyticsController');
const adminAuth = require('../../middlewares/admin/adminAuth');

const router = express.Router();

router.use(adminAuth.protect);

// Géographie : top pays multi-angles (revenu, ventes, users, conversion, croissance)
router.get('/geo', analyticsController.getGeo);

// Transactions : performance par PSP / pays / opérateur (succès vs échecs)
router.get('/transactions', analyticsController.getTransactions);

// Pronostics : qualité produit (win rate, volume, par sport, par catégorie)
router.get('/predictions', analyticsController.getPredictions);

// Mini-stat pronos pour le dashboard (léger)
router.get('/predictions/dashboard-mini', analyticsController.getPredictionsDashboardMini);

module.exports = router;
