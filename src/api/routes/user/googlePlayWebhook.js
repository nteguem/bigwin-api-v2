// src/api/routes/webhooks.routes.js

const express = require('express');
const router = express.Router();
const googlePlayController = require('../../controllers/user/googlePlayController');
const appMiddleware = require('../../middlewares/common/appIdentifier');

/**
 * Webhook RTDN Google Play
 * 
 * Google envoie les notifications à cette URL avec un header personnalisé
 * qui contient l'appId pour identifier quelle app est concernée.
 * 
 * Configuration côté Google Cloud Pub/Sub :
 * - BigWin: Ajouter header X-App-Id: bigwin
 * - WinTips: Ajouter header X-App-Id: wintips
 * 
 * Alternative si Google ne supporte pas les headers custom :
 * - Utiliser des URLs différentes par app
 */

// Méthode 1 : Une seule URL avec header X-App-Id
router.post(
  '/google-play',
  appMiddleware,  // ✅ Extrait X-App-Id du header
  googlePlayController.handleRTDN
);

// Méthode 2 (alternative) : URLs séparées par app
router.post(
  '/google-play/bigwin',
  (req, res, next) => {
    req.appId = 'bigwin';
    next();
  },
  googlePlayController.handleRTDN
);

router.post(
  '/google-play/wintips',
  (req, res, next) => {
    req.appId = 'wintips';
    next();
  },
  googlePlayController.handleRTDN
);

module.exports = router;