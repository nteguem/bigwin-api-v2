/**
 * Routes User pour consultation des catégories
 */
const express = require('express');
const categoryController = require('../../controllers/common/categoryController');
const { checkVipAccessOptional } = require('../../middlewares/user/checkSubscription');
const userAuth = require('../../middlewares/user/userAuth');

const router = express.Router();

// Routes publiques
router.get('/', categoryController.getCategories);

// Routes avec vérification optionnelle d'accès VIP
router.get('/:id', userAuth.protect, checkVipAccessOptional, categoryController.getCategoryById);

module.exports = router;