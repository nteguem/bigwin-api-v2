/**
 * Routes User pour consultation des tickets
 */
const express = require('express');
const ticketController = require('../../controllers/common/ticketController');
const { checkVipAccess, checkTicketAccess } = require('../../middlewares/user/checkSubscription');
const userAuth = require('../../middlewares/user/userAuth');

const router = express.Router();

// Protection user sur toutes les routes
router.use(userAuth.protect);

// Liste des tickets avec vérification catégorie
router.get('/', checkVipAccess, ticketController.getTickets);

// Détails ticket avec vérification d'accès
router.get('/:id', checkTicketAccess, ticketController.getTicketById);

module.exports = router;