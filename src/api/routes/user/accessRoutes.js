// src/api/routes/user/accessRoutes.js
//
// Déblocage de tickets free par visionnage de pubs récompensées.
// Monté sous /user/access avec identifyApp (au niveau de routes/index.js).

const express = require('express');
const accessController = require('../../controllers/user/accessController');
const userAuth = require('../../middlewares/user/userAuth');

const router = express.Router();

// Toutes ces routes exigent un utilisateur authentifié.
router.use(userAuth.protect);

// POST /user/access/ticket/:ticketId/unlock  { durationMinutes: number|null }
router.post('/ticket/:ticketId/unlock', accessController.unlockTicket);

// GET /user/access/ticket/:ticketId  → état courant (polling après chaque pub)
router.get('/ticket/:ticketId', accessController.getTicketAccessState);

module.exports = router;
