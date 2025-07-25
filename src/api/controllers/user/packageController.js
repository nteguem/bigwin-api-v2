const Package = require('../../models/common/Package');
const subscriptionService = require('../../services/user/subscriptionService');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const catchAsync = require('../../../utils/catchAsync');

/**
 * Obtenir tous les packages disponibles (user)
 */
exports.getAvailablePackages = catchAsync(async (req, res, next) => {
  const packages = await Package.find({ isActive: true })
    .populate('categories', 'name description isVip')
    .sort({ 'pricing.XAF': 1 }); // Tri par prix croissant

  res.status(200).json({
    success: true,
    data: {
      packages,
      count: packages.length
    }
  });
});

/**
 * Obtenir un package spécifique
 */
exports.getPackage = catchAsync(async (req, res, next) => {
  const package = await Package.findOne({ 
    _id: req.params.id, 
    isActive: true 
  }).populate('categories', 'name description isVip');

  if (!package) {
    return next(new AppError('Package non trouvé ou non disponible', 404, ErrorCodes.NOT_FOUND));
  }

  // Vérifier si l'utilisateur a déjà ce package (optionnel)
  let userHasPackage = false;
  if (req.user) {
    const activeSubscriptions = await subscriptionService.getActiveSubscriptions(req.user._id);
    userHasPackage = activeSubscriptions.some(sub => 
      sub.package._id.toString() === package._id.toString()
    );
  }

  res.status(200).json({
    success: true,
    data: {
      package,
      userHasPackage
    }
  });
});

/**
 * Obtenir les packages par catégorie
 */
exports.getPackagesByCategory = catchAsync(async (req, res, next) => {
  const { categoryId } = req.params;

  const packages = await Package.find({ 
    isActive: true,
    categories: categoryId
  }).populate('categories', 'name description isVip')
    .sort({ 'pricing.XAF': 1 });

  res.status(200).json({
    success: true,
    data: {
      packages,
      count: packages.length
    }
  });
});

/**
 * Obtenir les packages recommandés
 */
exports.getRecommendedPackages = catchAsync(async (req, res, next) => {
  // Logique simple : packages les plus populaires ou récents
  const packages = await Package.find({ isActive: true })
    .populate('categories', 'name description isVip')
    .sort({ createdAt: -1 })
    .limit(3);

  res.status(200).json({
    success: true,
    data: {
      packages,
      count: packages.length
    }
  });
});

/**
 * Comparer plusieurs packages
 */
exports.comparePackages = catchAsync(async (req, res, next) => {
  const { packageIds } = req.query; // ?packageIds=id1,id2,id3

  if (!packageIds) {
    return next(new AppError('IDs des packages requis', 400, ErrorCodes.VALIDATION_ERROR));
  }

  const ids = packageIds.split(',');
  
  if (ids.length > 5) {
    return next(new AppError('Maximum 5 packages à comparer', 400, ErrorCodes.VALIDATION_ERROR));
  }

  const packages = await Package.find({ 
    _id: { $in: ids },
    isActive: true
  }).populate('categories', 'name description isVip');

  // Créer un tableau de comparaison structuré
  const comparison = packages.map(pkg => ({
    id: pkg._id,
    name: pkg.name,
    pricing: pkg.pricing,
    duration: pkg.duration,
    categories: pkg.categories,
    features: pkg.features,
    pricePerDay: {
      XAF: Math.round(pkg.pricing.XAF / pkg.duration),
      ...(pkg.pricing.EUR && { EUR: Math.round((pkg.pricing.EUR / pkg.duration) * 100) / 100 }),
      ...(pkg.pricing.USD && { USD: Math.round((pkg.pricing.USD / pkg.duration) * 100) / 100 })
    }
  }));

  res.status(200).json({
    success: true,
    data: {
      comparison,
      count: comparison.length
    }
  });
});

/**
 * Rechercher des packages
 */
exports.searchPackages = catchAsync(async (req, res, next) => {
  const { q, minPrice, maxPrice, currency = 'XAF' } = req.query;

  // Construire les filtres
  const filters = { isActive: true };

  // Recherche textuelle
  if (q) {
    filters.$or = [
      { name: { $regex: q, $options: 'i' } },
      { description: { $regex: q, $options: 'i' } },
      { features: { $in: [new RegExp(q, 'i')] } }
    ];
  }

  // Filtres de prix
  if (minPrice || maxPrice) {
    const priceField = `pricing.${currency}`;
    filters[priceField] = {};
    
    if (minPrice) filters[priceField].$gte = parseFloat(minPrice);
    if (maxPrice) filters[priceField].$lte = parseFloat(maxPrice);
  }

  const packages = await Package.find(filters)
    .populate('categories', 'name description isVip')
    .sort({ 'pricing.XAF': 1 });

  res.status(200).json({
    success: true,
    data: {
      packages,
      count: packages.length,
      filters: {
        searchTerm: q,
        minPrice,
        maxPrice,
        currency
      }
    }
  });
});