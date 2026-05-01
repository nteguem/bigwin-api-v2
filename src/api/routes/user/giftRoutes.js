// src/api/routes/user/giftRoutes.js

const express = require('express');
const giftController = require('../../controllers/user/giftController');
const userAuth = require('../../middlewares/user/userAuth');

const router = express.Router();

router.use(userAuth.protect);

// Catalogue + solde
router.get('/', giftController.getCatalog); // GET /user/gifts
router.get('/me/balance', giftController.getBalance); // GET /user/gifts/me/balance

// Détail unlock + génération
router.get('/:id/me', giftController.getMyUnlock); // GET /user/gifts/:id/me
router.post('/:id/unlock', giftController.unlock); // POST /user/gifts/:id/unlock
router.get('/:id/content', giftController.getContent); // GET /user/gifts/:id/content (static only)
router.post('/:id/generate', giftController.generate); // POST /user/gifts/:id/generate (ai only)

module.exports = router;
