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

// Top users : meilleurs clients par revenu / nb d'achats
router.get('/top-users', analyticsController.getTopUsers);

// Candidats à relancer (win-back) : churners avec gros revenu cumulé
router.get('/winback-candidates', analyticsController.getWinbackCandidates);

// Détails d'un client (modal latérale) : profil + apps + souscriptions
router.get('/users/:userId/details', analyticsController.getUserDetails);

// Packages disponibles pour une app donnée (pour le form d'offre)
router.get('/apps/:appId/packages', analyticsController.getPackagesByApp);

// Offrir un forfait fidélité à un client (notif personnalisée distincte)
router.post('/users/:userId/loyalty-gift', analyticsController.giveLoyaltyGift);

module.exports = router;
