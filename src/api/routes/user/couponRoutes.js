const express = require('express');
const couponController = require('../../controllers/user/couponController');
const userAuth = require('../../middlewares/user/userAuth');
const vipAccess = require('../../middlewares/user/checkSubscription');

const router = express.Router();

/**
 * Routes pour les coupons
 * La différenciation free/vip se fait via le paramètre 'isVip' dans la query
 * Exemples d'utilisation :
 * - GET /coupons?isVip=false                    // Coupons gratuits uniquement
 * - GET /coupons?isVip=true                     // Coupons VIP uniquement  
 * - GET /coupons                                // Tous les coupons
 * - GET /coupons?isVip=true&date=2025-07-31     // Coupons VIP pour une date
 * - GET /coupons?isVip=false&category=categoryId&page=1&limit=20
 */

// Middleware d'authentification pour accéder aux coupons
router.use(userAuth.protect);

// Middleware de vérification VIP pour les coupons
// Ce middleware vérifie si l'utilisateur peut accéder aux coupons VIP quand isVip=true
router.use(vipAccess.checkCouponsVipAccess);

// Récupérer tous les coupons (free ou vip selon le paramètre isVip)
router.get('/', couponController.getCoupons);

// Récupérer un coupon spécifique par ID
// La vérification d'accès est faite dans le controller
router.get('/:id', couponController.getCouponById);

module.exports = router;