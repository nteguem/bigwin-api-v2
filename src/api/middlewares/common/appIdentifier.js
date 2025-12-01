// src/api/middlewares/common/appIdentifier.js

const App = require('../../models/common/App');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

const identifyApp = async (req, res, next) => {
  try {
    const appId = req.headers['x-app-id'];
    
    if (!appId) {
      return next(new AppError(
        'Header X-App-Id requis',
        400,
        ErrorCodes.VALIDATION_ERROR
      ));
    }
    
    const app = await App.findOne({ 
      appId: appId.toLowerCase(),
      isActive: true 
    }).lean();
    
    if (!app) {
      return next(new AppError(
        `Application '${appId}' non trouvée ou désactivée`,
        404,
        ErrorCodes.VALIDATION_ERROR
      ));
    }
    
    req.appId = app.appId;
    req.currentApp = app; // ⭐ CHANGÉ: req.app → req.currentApp (req.app est réservé par Express)
    
    next();
  } catch (error) {
    next(new AppError(
      'Erreur lors de l\'identification de l\'application',
      500,
      ErrorCodes.INTERNAL_ERROR
    ));
  }
};

const identifyAppOptional = async (req, res, next) => {
  try {
    const appId = req.headers['x-app-id'];
    
    if (!appId) {
      req.appId = null;
      req.currentApp = null; // ⭐ CHANGÉ
      return next();
    }
    
    const app = await App.findOne({ 
      appId: appId.toLowerCase(),
      isActive: true 
    }).lean();
    
    if (app) {
      req.appId = app.appId;
      req.currentApp = app; // ⭐ CHANGÉ
    } else {
      req.appId = null;
      req.currentApp = null; // ⭐ CHANGÉ
    }
    
    next();
  } catch (error) {
    req.appId = null;
    req.currentApp = null; // ⭐ CHANGÉ
    next();
  }
};

module.exports = {
  identifyApp,
  identifyAppOptional
};