const Package = require('../../models/common/Package');
const Category = require('../../models/common/Category');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const catchAsync = require('../../../utils/catchAsync');

/**
 * Obtenir tous les packages (admin)
 */
exports.getAllPackages = catchAsync(async (req, res, next) => {
  const packages = await Package.find()
    .populate('categories', 'name isVip')
    .sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    data: {
      packages,
      count: packages.length
    }
  });
});

/**
 * Obtenir un package par ID
 */
exports.getPackage = catchAsync(async (req, res, next) => {
  const package = await Package.findById(req.params.id)
    .populate('categories', 'name description isVip');

  if (!package) {
    return next(new AppError('Package non trouvé', 404, ErrorCodes.NOT_FOUND));
  }

  res.status(200).json({
    success: true,
    data: {
      package
    }
  });
});

/**
 * Créer un nouveau package
 */
exports.createPackage = catchAsync(async (req, res, next) => {
  const { name, description, pricing, duration, categories, features } = req.body;

  // Validation des champs obligatoires
  if (!name || !pricing?.XAF || !duration) {
    return next(new AppError('Nom, prix en XAF et durée sont requis', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // Vérifier que les catégories existent
  if (categories && categories.length > 0) {
    const existingCategories = await Category.find({ _id: { $in: categories } });
    if (existingCategories.length !== categories.length) {
      return next(new AppError('Une ou plusieurs catégories sont invalides', 400, ErrorCodes.VALIDATION_ERROR));
    }
  }

  const package = await Package.create({
    name,
    description,
    pricing,
    duration,
    categories: categories || [],
    features: features || []
  });

  // Populer les catégories pour la réponse
  await package.populate('categories', 'name isVip');

  res.status(201).json({
    success: true,
    message: 'Package créé avec succès',
    data: {
      package
    }
  });
});

/**
 * Modifier un package
 */
exports.updatePackage = catchAsync(async (req, res, next) => {
  const { name, description, pricing, duration, categories, features, isActive } = req.body;

  // Vérifier que le package existe
  let package = await Package.findById(req.params.id);
  if (!package) {
    return next(new AppError('Package non trouvé', 404, ErrorCodes.NOT_FOUND));
  }

  // Vérifier les catégories si fournies
  if (categories && categories.length > 0) {
    const existingCategories = await Category.find({ _id: { $in: categories } });
    if (existingCategories.length !== categories.length) {
      return next(new AppError('Une ou plusieurs catégories sont invalides', 400, ErrorCodes.VALIDATION_ERROR));
    }
  }

  // Mettre à jour les champs
  const updateData = {};
  if (name !== undefined) updateData.name = name;
  if (description !== undefined) updateData.description = description;
  if (pricing !== undefined) updateData.pricing = pricing;
  if (duration !== undefined) updateData.duration = duration;
  if (categories !== undefined) updateData.categories = categories;
  if (features !== undefined) updateData.features = features;
  if (isActive !== undefined) updateData.isActive = isActive;

  package = await Package.findByIdAndUpdate(
    req.params.id,
    updateData,
    { new: true, runValidators: true }
  ).populate('categories', 'name isVip');

  res.status(200).json({
    success: true,
    message: 'Package mis à jour avec succès',
    data: {
      package
    }
  });
});

/**
 * Supprimer un package
 */
exports.deletePackage = catchAsync(async (req, res, next) => {
  const package = await Package.findById(req.params.id);

  if (!package) {
    return next(new AppError('Package non trouvé', 404, ErrorCodes.NOT_FOUND));
  }

  // Vérifier s'il y a des abonnements actifs
  const Subscription = require('../../models/user/Subscription');
  const activeSubscriptions = await Subscription.countDocuments({
    package: req.params.id,
    status: 'active'
  });

  if (activeSubscriptions > 0) {
    return next(new AppError('Impossible de supprimer un package avec des abonnements actifs', 400, ErrorCodes.VALIDATION_ERROR));
  }

  await Package.findByIdAndDelete(req.params.id);

  res.status(200).json({
    success: true,
    message: 'Package supprimé avec succès'
  });
});

/**
 * Activer/désactiver un package
 */
exports.togglePackageStatus = catchAsync(async (req, res, next) => {
  const package = await Package.findById(req.params.id);

  if (!package) {
    return next(new AppError('Package non trouvé', 404, ErrorCodes.NOT_FOUND));
  }

  package.isActive = !package.isActive;
  await package.save();

  res.status(200).json({
    success: true,
    message: `Package ${package.isActive ? 'activé' : 'désactivé'} avec succès`,
    data: {
      package
    }
  });
});

/**
 * Obtenir les statistiques des packages
 */
exports.getPackageStats = catchAsync(async (req, res, next) => {
  const stats = await Package.aggregate([
    {
      $group: {
        _id: '$isActive',
        count: { $sum: 1 },
        avgPrice: { $avg: '$pricing.XAF' }
      }
    }
  ]);

  const totalPackages = await Package.countDocuments();
  
  res.status(200).json({
    success: true,
    data: {
      totalPackages,
      stats
    }
  });
});