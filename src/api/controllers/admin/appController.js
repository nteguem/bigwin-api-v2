// src/api/controllers/admin/appController.js

const App = require('../../models/common/App');
const catchAsync = require('../../../utils/catchAsync');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

/**
 * Obtenir toutes les apps disponibles pour l'admin
 */
exports.getAllApps = catchAsync(async (req, res) => {
  const apps = await App.find({ isActive: true })
    .select('appId name displayName description branding isActive createdAt')
    .sort({ appId: 1 });

  res.status(200).json({
    success: true,
    data: {
      apps,
      count: apps.length
    }
  });
});

/**
 * Obtenir une app spécifique par appId
 */
exports.getApp = catchAsync(async (req, res) => {
  const { appId } = req.params;

  const app = await App.findOne({ appId, isActive: true });

  if (!app) {
    throw new AppError('Application non trouvée', 404, ErrorCodes.NOT_FOUND);
  }

  res.status(200).json({
    success: true,
    data: {
      app
    }
  });
});

/**
 * Obtenir les statistiques d'une app
 */
exports.getAppStats = catchAsync(async (req, res) => {
  const { appId } = req.params;

  const app = await App.findOne({ appId, isActive: true });

  if (!app) {
    throw new AppError('Application non trouvée', 404, ErrorCodes.NOT_FOUND);
  }

  // Compter les ressources de cette app
  const User = require('../../models/user/User');
  const Affiliate = require('../../models/affiliate/Affiliate');
  const Package = require('../../models/common/Package');
  const Category = require('../../models/common/Category');
  const Ticket = require('../../models/common/Ticket');
  const Subscription = require('../../models/common/Subscription');

  const [
    usersCount,
    affiliatesCount,
    packagesCount,
    categoriesCount,
    ticketsCount,
    subscriptionsCount
  ] = await Promise.all([
    User.countDocuments({ appId }),
    Affiliate.countDocuments({ appId }),
    Package.countDocuments({ appId }),
    Category.countDocuments({ appId }),
    Ticket.countDocuments({ appId }),
    Subscription.countDocuments({ appId, status: 'active' })
  ]);

  res.status(200).json({
    success: true,
    data: {
      appId: app.appId,
      name: app.displayName,
      stats: {
        users: usersCount,
        affiliates: affiliatesCount,
        packages: packagesCount,
        categories: categoriesCount,
        tickets: ticketsCount,
        activeSubscriptions: subscriptionsCount
      }
    }
  });
});

/**
 * Créer une nouvelle app (super admin uniquement)
 */
exports.createApp = catchAsync(async (req, res) => {
  const app = await App.create(req.body);

  res.status(201).json({
    success: true,
    message: 'Application créée avec succès',
    data: {
      app
    }
  });
});

/**
 * Mettre à jour une app
 */
exports.updateApp = catchAsync(async (req, res) => {
  const { appId } = req.params;

  // Empêcher la modification de l'appId
  delete req.body.appId;

  const app = await App.findOneAndUpdate(
    { appId },
    req.body,
    { 
      new: true, 
      runValidators: true 
    }
  );

  if (!app) {
    throw new AppError('Application non trouvée', 404, ErrorCodes.NOT_FOUND);
  }

  res.status(200).json({
    success: true,
    message: 'Application mise à jour avec succès',
    data: {
      app
    }
  });
});

/**
 * Désactiver une app (soft delete)
 */
exports.deactivateApp = catchAsync(async (req, res) => {
  const { appId } = req.params;

  const app = await App.findOneAndUpdate(
    { appId },
    { isActive: false },
    { new: true }
  );

  if (!app) {
    throw new AppError('Application non trouvée', 404, ErrorCodes.NOT_FOUND);
  }

  res.status(200).json({
    success: true,
    message: 'Application désactivée avec succès',
    data: {
      app
    }
  });
});

/**
 * Réactiver une app
 */
exports.activateApp = catchAsync(async (req, res) => {
  const { appId } = req.params;

  const app = await App.findOneAndUpdate(
    { appId },
    { isActive: true },
    { new: true }
  );

  if (!app) {
    throw new AppError('Application non trouvée', 404, ErrorCodes.NOT_FOUND);
  }

  res.status(200).json({
    success: true,
    message: 'Application réactivée avec succès',
    data: {
      app
    }
  });
});