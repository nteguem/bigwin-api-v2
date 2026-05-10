// src/api/routes/common/appInfoRoutes.js
//
// Route publique exposant les infos non-sensibles de l'app courante
// (X-App-Id). Pas d'auth requis — les portails web s'en servent pour
// récupérer le branding.

const express = require('express');
const router = express.Router();
const appInfoController = require('../../controllers/common/appInfoController');

router.get('/info', appInfoController.getAppInfo);

module.exports = router;
