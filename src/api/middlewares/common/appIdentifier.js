// src/api/middlewares/common/appIdentifier.js

const App = require('../../models/common/App');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
// src/api/middlewares/common/appIdentifier.js

const identifyApp = async (req, res, next) => {
  try {
    const appId = req.headers['x-app-id'];
    
    if (!appId) {
      return next(new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR));
    }
    
    const app = await App.findOne({ 
      appId: appId.toLowerCase(),
      isActive: true 
    }).lean();
    
    if (!app) {
      return next(new AppError(`Application '${appId}' non trouvée ou désactivée`, 404, ErrorCodes.VALIDATION_ERROR));
    }
    
    req.appId = app.appId;
    
    // ⭐ SOLUTION : NE PAS ATTACHER L'OBJET COMPLET
    // req.app = app;  // ❌ RETIRE CETTE LIGNE
    
    // ✅ OU attache une copie propre
    req.app = { ...app };
    
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
      req.app = { ...app }; // ✅ COPIE
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