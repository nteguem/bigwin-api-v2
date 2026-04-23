// src/api/routes/admin/logsRoutes.js
//
// Routes admin pour la consultation des logs applicatifs depuis le backoffice.
// L'accès est restreint à super_admin — les logs peuvent contenir du contexte
// sensible cross-tenant (stack traces, IDs utilisateurs, métadonnées partielles)
// même si les clés sensibles (password/token/otp…) sont déjà masquées à
// l'écriture par le transport Mongo.
const express = require('express');
const logsController = require('../../controllers/admin/logsController');

const router = express.Router();

// Ordre important : les routes spécifiques AVANT la route dynamique :id pour
// ne pas que `/stats` ou `/services` soient captées comme un ObjectId.
router.get('/stats', logsController.stats);
router.get('/services', logsController.services);
router.get('/:id', logsController.getById);
router.get('/', logsController.list);

module.exports = router;
