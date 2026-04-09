const express = require('express');
const admobController = require('../../controllers/admin/admobController');
const adminAuth = require('../../middlewares/admin/adminAuth');

const router = express.Router();

router.use(adminAuth.protect);

router.get('/stats', admobController.getStats);

module.exports = router;
