// src/api/routes/user/giftRoutes.js

const express = require('express');
const rateLimit = require('express-rate-limit');
const giftController = require('../../controllers/user/giftController');
const userAuth = require('../../middlewares/user/userAuth');

const router = express.Router();

router.use(userAuth.protect);

// Rate limit défensif sur /generate : double protection (la principale est le
// rate-limit métier `gift.rateLimitPerWeek`). Évite qu'un bug client ou une
// attaque ne provoque une explosion de la facture Gemini.
// 8 req / minute / user — largement suffisant pour la régénération légitime.
const generateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  // Le user est authentifié à ce stade → on rate-limit par user, pas par IP.
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Trop de générations IA d\'affilée. Réessaie dans 1 minute.',
    },
  },
});

// Catalogue + solde
router.get('/', giftController.getCatalog); // GET /user/gifts
router.get('/me/balance', giftController.getBalance); // GET /user/gifts/me/balance

// Détail unlock + génération
router.get('/:id/me', giftController.getMyUnlock); // GET /user/gifts/:id/me
router.post('/:id/unlock', giftController.unlock); // POST /user/gifts/:id/unlock
router.get('/:id/content', giftController.getContent); // GET /user/gifts/:id/content (static only)
router.post('/:id/generate', generateLimiter, giftController.generate); // POST /user/gifts/:id/generate (ai only)

// Avis utilisateurs (reviews) — accessibles à tout user authentifié.
// La règle "doit avoir débloqué pour reviewer" est appliquée dans le
// service, pas via middleware (pour permettre les avis sur freeTeasers).
//
// Rate-limit léger sur POST pour éviter le spam : un user qui éditerait
// son avis 100x en 1 minute est suspect.
const reviewSubmitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Trop d\'avis envoyés.' },
  },
});

router.get('/:id/reviews', giftController.listReviews); // liste paginée
router.get('/:id/reviews/aggregate', giftController.getReviewsAggregate); // moyenne + distribution
router.get('/:id/reviews/me', giftController.getMyReview); // mon avis
router.post('/:id/reviews', reviewSubmitLimiter, giftController.submitReview); // upsert
router.delete('/:id/reviews/me', giftController.deleteMyReview); // supprimer mon avis

module.exports = router;
