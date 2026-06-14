// src/api/routes/admin/globalConfigRoutes.js
//
// Config GLOBALE (feature flags transverses). Montée en super_admin only et
// SANS identifyApp (le singleton n'est pas scopé à une app) dans routes/index.js.

const express = require('express');
const router = express.Router();
const globalConfigController = require('../../controllers/admin/globalConfigController');

router.get('/', globalConfigController.getGlobalConfig);
router.patch('/weekly-report', globalConfigController.updateWeeklyReport);

module.exports = router;
