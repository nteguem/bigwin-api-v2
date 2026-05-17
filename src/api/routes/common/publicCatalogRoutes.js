// src/api/routes/common/publicCatalogRoutes.js
//
// ⚠️ ROUTES PUBLIQUES LECTURE SEULE — V1.
// Voir publicCatalogController.js pour le contexte.

const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/common/publicCatalogController');

router.get('/categories', ctrl.listAllCategories);

module.exports = router;
