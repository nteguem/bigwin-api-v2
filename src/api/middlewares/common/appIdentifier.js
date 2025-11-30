// src/api/middlewares/common/appIdentifier.js

const App = require('../../models/common/App');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

/**
 * Middleware pour identifier l'application à partir du header X-App-Id
 * Ajoute req.appId et req.app à la requête
 */
const identifyApp = async (req, res, next) => {
  try {
    // Récupérer l'appId depuis le header
    const appId = req.headers['x-app-id'];
    
    // Si pas d'appId fourni
    if (!appId) {
      return next(new AppError(
        'Header X-App-Id requis',
        400,
        ErrorCodes.VALIDATION_ERROR
      ));
    }
    
    // Vérifier que l'app existe et est active
    const app = await App.findOne({ 
      appId: appId.toLowerCase(),
      isActive: true 
    });
    
    if (!app) {
      return next(new AppError(
        `Application '${appId}' non trouvée ou désactivée`,
        404,
        ErrorCodes.VALIDATION_ERROR
      ));
    }
    
    // Ajouter à la requête
    req.appId = app.appId;
    req.app = app;
    
    next();
  } catch (error) {
    next(new AppError(
      'Erreur lors de l\'identification de l\'application',
      500,
      ErrorCodes.INTERNAL_ERROR
    ));
  }
};

/**
 * Middleware optionnel - n'échoue pas si X-App-Id est absent
 * Utile pour les routes qui peuvent fonctionner sans app (ex: routes admin)
 */
const identifyAppOptional = async (req, res, next) => {
  try {
    const appId = req.headers['x-app-id'];
    
    if (!appId) {
      // Pas d'appId, on continue sans erreur
      req.appId = null;
      req.app = null;
      return next();
    }
    
    const app = await App.findOne({ 
      appId: appId.toLowerCase(),
      isActive: true 
    });
    
    if (app) {
      req.appId = app.appId;
      req.app = app;
    } else {
      req.appId = null;
      req.app = null;
    }
    
    next();
  } catch (error) {
    // En cas d'erreur, on continue quand même
    req.appId = null;
    req.app = null;
    next();
  }
};

module.exports = {
  identifyApp,
  identifyAppOptional
};