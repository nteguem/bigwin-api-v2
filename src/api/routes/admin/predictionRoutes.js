/**
 * Routes Admin pour gestion des prédictions
 */
const express = require('express');
const predictionController = require('../../controllers/common/predictionController');
const adminAuth = require('../../middlewares/admin/adminAuth');

const router = express.Router();

// Protection admin sur toutes les routes
router.use(adminAuth.protect);

// CRUD complet pour admin
router.route('/')
  .get(predictionController.getPredictions)
  .post(predictionController.createPrediction);

router.route('/bulk')
  .post(predictionController.addPredictionsToTicket);

// Correction manuelle pour une date spécifique
// POST /admin/predictions/correct/2026-03-23?forceApi=true
router.route('/correct/:date')
  .post(predictionController.correctByDate);

router.route('/:id')
  .get(predictionController.getPredictionById)
  .put(predictionController.updatePrediction)
  .delete(predictionController.deletePrediction);

module.exports = router;