// src/api/routes/admin/giftTierRoutes.js

const express = require('express');
const tierController = require('../../controllers/admin/giftTierController');

const router = express.Router();

router
  .route('/')
  .get(tierController.getAllTiers)
  .post(tierController.createTier);

router
  .route('/:id')
  .get(tierController.getTier)
  .put(tierController.updateTier)
  .delete(tierController.deleteTier);

module.exports = router;
