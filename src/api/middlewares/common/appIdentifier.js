// src/api/middlewares/common/appIdentifier.js

const App = require('../../models/common/App');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

const identifyApp = async (req, res, next) => {
  try {
    console.log('[identifyApp] LIGNE 8 - req.query:', req.query);
    
    const appId = req.headers['x-app-id'];
    
    console.log('[identifyApp] LIGNE 12 - req.query:', req.query);
    
    if (!appId) {
      return next(new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR));
    }
    
    console.log('[identifyApp] LIGNE 18 - req.query:', req.query);
    
    const app = await App.findOne({ 
      appId: appId.toLowerCase(),
      isActive: true 
    }).lean();
    
    console.log('[identifyApp] LIGNE 25 - req.query:', req.query);
    
    if (!app) {
      return next(new AppError(`Application '${appId}' non trouvée ou désactivée`, 404, ErrorCodes.VALIDATION_ERROR));
    }
    
    console.log('[identifyApp] LIGNE 31 - req.query:', req.query);
    
    req.appId = app.appId;
    
    console.log('[identifyApp] LIGNE 35 - req.query:', req.query);
    
    req.app = app;
    
    console.log('[identifyApp] LIGNE 39 - req.query:', req.query);
    
    next();
  } catch (error) {
    next(new AppError('Erreur lors de l\'identification de l\'application', 500, ErrorCodes.INTERNAL_ERROR));
  }
};

const identifyAppOptional = async (req, res, next) => {
  try {
    const appId = req.headers['x-app-id'];
    
    if (!appId) {
      req.appId = null;
      req.app = null;
      return next();
    }
    
    const app = await App.findOne({ 
      appId: appId.toLowerCase(),
      isActive: true 
    }).lean();
    
    if (app) {
      req.appId = app.appId;
      req.app = app;
    } else {
      req.appId = null;
      req.app = null;
    }
    
    next();
  } catch (error) {
    req.appId = null;
    req.app = null;
    next();
  }
};

module.exports = {
  identifyApp,
  identifyAppOptional
};