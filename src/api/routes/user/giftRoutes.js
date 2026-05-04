// src/api/routes/user/giftRoutes.js

const express = require('express');
const rateLimit = require('express-rate-limit');
const giftController = require('../../controllers/user/giftController');
const userAuth = require('../../middlewares/user/userAuth');

const router = express.Router();

// Le catalog et les reviews en LECTURE sont navigables sans auth — on
// veut que les non-connectés puissent découvrir les cadeaux. Le gate
// de login est appliqué côté mobile au moment de l'action (unlock,
// ouvrir contenu, laisser un avis). `userAuth.optional` attache `req.user`
// si un token valide est présent, sinon le laisse à null.
//
// Pour les actions sensibles (unlock, balance, content, generate, write
// reviews), on applique `userAuth.protect` per-route plus bas.

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

// Catalogue : public (auth optionnel). Les statuts unlocked/available
// nécessitent un user, sinon tout est `free` ou `locked`.
router.get('/', userAuth.optional, giftController.getCatalog); // GET /user/gifts

// Tier d'accès courant : strictement personnel → auth obligatoire.
// Remplace l'ancien /me/balance — renvoie le tier max accessible via
// les subs actives.
router.get('/me/tier', userAuth.protect, giftController.getMyTierAccess);

// Détail unlock + génération — toutes ces actions ciblent le user courant
// donc auth obligatoire.
router.get('/:id/me', userAuth.protect, giftController.getMyUnlock);
router.post('/:id/unlock', userAuth.protect, giftController.unlock);
router.get('/:id/content', userAuth.protect, giftController.getContent); // déclenche aussi readCount++
router.post('/:id/generate', userAuth.protect, generateLimiter, giftController.generate);

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

// Lecture des avis : public (un visiteur doit voir les avis pour se
// décider). `userAuth.optional` permet quand même de connaître le user
// si auth présent (utile pour signaler "votre avis" plus tard).
router.get('/:id/reviews', userAuth.optional, giftController.listReviews);
router.get('/:id/reviews/aggregate', userAuth.optional, giftController.getReviewsAggregate);

// Écriture / suppression d'avis : auth obligatoire.
router.get('/:id/reviews/me', userAuth.protect, giftController.getMyReview);
router.post('/:id/reviews', userAuth.protect, reviewSubmitLimiter, giftController.submitReview);
router.delete('/:id/reviews/me', userAuth.protect, giftController.deleteMyReview);

module.exports = router;
