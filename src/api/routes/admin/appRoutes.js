// src/api/routes/admin/appRoutes.js

const express = require('express');
const router = express.Router();
const appController = require('../../controllers/admin/appController');
const { protect } = require('../../middlewares/admin/adminAuth');

// Toutes les routes nécessitent l'authentification admin
router.use(protect);

// Routes CRUD
router.get('/', appController.getAllApps);
router.get('/:appId', appController.getApp);
router.get('/:appId/stats', appController.getAppStats);
router.post('/', appController.createApp);
router.patch('/:appId', appController.updateApp);

// Routes activation/désactivation
router.patch('/:appId/deactivate', appController.deactivateApp);
router.patch('/:appId/activate', appController.activateApp);

module.exports = router;