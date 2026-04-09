const express = require('express');
const installStatsController = require('../../controllers/admin/installStatsController');
const adminAuth = require('../../middlewares/admin/adminAuth');

const router = express.Router();

router.use(adminAuth.protect);

router.get('/stats', installStatsController.getStats);

module.exports = router;
