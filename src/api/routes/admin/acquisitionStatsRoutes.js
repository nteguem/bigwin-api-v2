const express = require('express');
const acquisitionStatsController = require('../../controllers/admin/acquisitionStatsController');
const adminAuth = require('../../middlewares/admin/adminAuth');

const router = express.Router();

router.use(adminAuth.protect);

router.get('/stats', acquisitionStatsController.getStats);

module.exports = router;
