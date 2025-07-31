const express = require('express');
const couponController = require('../../controllers/user/couponController');
// const userAuth = require('../../middlewares/user/userAuth');
const router = express.Router();

/**
 * Routes pour les coupons
 * La différenciation free/vip se fait via le paramètre 'type' dans la query
 * Exemples d'utilisation :
 * - GET /coupons?type=free
 * - GET /coupons?type=vip
 * - GET /coupons?type=vip&date=2025-07-31
 * - GET /coupons?type=free&category=categoryId&page=1&limit=20
 */

// Middleware d'authentification pour accéder aux coupons
// router.use(userAuth.protect);

// TODO: Ajouter ici votre middleware de vérification d'abonnement VIP
// Ce middleware vérifiera le paramètre 'type' et l'abonnement de l'utilisateur
// router.use(vipSubscriptionMiddleware);

// Récupérer tous les coupons (free ou vip selon le paramètre type)
router.get('/', couponController.getCoupons);

// Récupérer un coupon spécifique par ID
router.get('/:id', couponController.getCouponById);

module.exports = router;