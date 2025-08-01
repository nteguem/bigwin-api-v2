const Package = require('../../models/common/Package');
const subscriptionService = require('../../services/user/subscriptionService');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const catchAsync = require('../../../utils/catchAsync');

/**
 * Obtenir tous les packages disponibles (user) - VERSION CORRIGÉE
 */
exports.getAvailablePackages = catchAsync(async (req, res, next) => {
  const { currency } = req.query;  
  const packages = await Package.find({ isActive: true })
    .populate('categories', 'name description isVip')
    .sort({ 'pricing.XAF': 1 });  
  let result = packages;
  
  if (currency) {    
    // Filtrer d'abord les packages qui ont la devise
    const packagesWithCurrency = packages.filter(pkg => {
      // Gérer le cas où pricing est un Map
      let hasCurrency = false;
      if (pkg.pricing instanceof Map) {
        hasCurrency = pkg.pricing.has(currency);
      } else if (pkg.pricing && typeof pkg.pricing === 'object') {
        hasCurrency = pkg.pricing[currency] !== undefined;
      }
            return hasCurrency;
    });
      
    // Puis transformer pour ne garder que la devise demandée
    result = packagesWithCurrency.map(pkg => {
      const packageData = pkg.toJSON();
      
      // Gérer le cas où pricing est un Map dans les données JSON
      if (packageData.pricing instanceof Map) {
        packageData.pricing = { [currency]: packageData.pricing.get(currency) };
      } else if (packageData.pricing && typeof packageData.pricing === 'object') {
        packageData.pricing = { [currency]: packageData.pricing[currency] };
      }
      
      return packageData;
    });
  }

  res.status(200).json({
    success: true,
    data: {
      packages: result,
      count: result.length,
      ...(currency && { currency })
    }
  });
});

/**
 * Obtenir un package spécifique
 */
exports.getPackage = catchAsync(async (req, res, next) => {
  const { currency } = req.query;
  
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

  // Traitement du package selon la devise
  let processedPackage = package;
  
  if (currency) {
    const packageData = package.toJSON();
    
    // Si le package n'a pas la devise demandée, retourner une erreur
    if (!packageData.pricing || !packageData.pricing[currency]) {
      return next(new AppError(`Package non disponible dans la devise ${currency}`, 404, ErrorCodes.NOT_FOUND));
    }
    
    packageData.pricing = { [currency]: packageData.pricing[currency] };
    processedPackage = packageData;
  }

  res.status(200).json({
    success: true,
    data: {
      package: processedPackage,
      userHasPackage,
      ...(currency && { currency })
    }
  });
});

/**
 * Obtenir les packages par catégorie
 */
exports.getPackagesByCategory = catchAsync(async (req, res, next) => {
  const { categoryId } = req.params;
  const { currency } = req.query;

  const packages = await Package.find({ 
    isActive: true,
    categories: categoryId
  }).populate('categories', 'name description isVip')
    .sort({ 'pricing.XAF': 1 });

  // Traitement des packages selon la devise
  let processedPackages = packages;
  
  if (currency) {
    processedPackages = packages
      .filter(pkg => pkg.pricing && pkg.pricing[currency]) // Filtrer seulement les packages qui ont la devise
      .map(pkg => {
        const packageData = pkg.toJSON();
        packageData.pricing = { [currency]: packageData.pricing[currency] };
        return packageData;
      });
  }

  res.status(200).json({
    success: true,
    data: {
      packages: processedPackages,
      count: processedPackages.length,
      ...(currency && { currency })
    }
  });
});

/**
 * Obtenir les packages recommandés
 */
exports.getRecommendedPackages = catchAsync(async (req, res, next) => {
  const { currency } = req.query;
  
  // Logique simple : packages les plus populaires ou récents
  const packages = await Package.find({ isActive: true })
    .populate('categories', 'name description isVip')
    .sort({ createdAt: -1 })
    .limit(3);

  // Traitement des packages selon la devise
  let processedPackages = packages;
  
  if (currency) {
    processedPackages = packages
      .filter(pkg => pkg.pricing && pkg.pricing[currency]) // Filtrer seulement les packages qui ont la devise
      .map(pkg => {
        const packageData = pkg.toJSON();
        packageData.pricing = { [currency]: packageData.pricing[currency] };
        return packageData;
      });
  }

  res.status(200).json({
    success: true,
    data: {
      packages: processedPackages,
      count: processedPackages.length,
      ...(currency && { currency })
    }
  });
});

/**
 * Comparer plusieurs packages
 */
exports.comparePackages = catchAsync(async (req, res, next) => {
  const { packageIds, currency } = req.query; // ?packageIds=id1,id2,id3&currency=XAF

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
  const comparison = packages
    .filter(pkg => !currency || (pkg.pricing && pkg.pricing[currency])) // Filtrer par devise si spécifiée
    .map(pkg => {
      const packageData = pkg.toJSON();
      let pricing = packageData.pricing;
      
      // Filtrer selon la devise si spécifiée
      if (currency && pricing && pricing[currency]) {
        pricing = { [currency]: pricing[currency] };
      }
      
      // Calculer le prix par jour selon la devise
      const pricePerDay = {};
      if (pricing) {
        Object.keys(pricing).forEach(curr => {
          if (curr === 'XAF' || curr === 'XOF') {
            pricePerDay[curr] = Math.round(pricing[curr] / pkg.duration);
          } else {
            pricePerDay[curr] = Math.round((pricing[curr] / pkg.duration) * 100) / 100;
          }
        });
      }

      return {
        id: pkg._id,
        name: pkg.name,
        pricing,
        duration: pkg.duration,
        categories: pkg.categories,
        features: pkg.features,
        pricePerDay
      };
    });

  res.status(200).json({
    success: true,
    data: {
      comparison,
      count: comparison.length,
      ...(currency && { currency })
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
    .sort({ [`pricing.${currency}`]: 1 });

  // Pour la recherche, filtrer par devise
  let processedPackages = packages;
  
  if (currency) {
    processedPackages = packages
      .filter(pkg => pkg.pricing && pkg.pricing[currency]) // Filtrer seulement les packages qui ont la devise
      .map(pkg => {
        const packageData = pkg.toJSON();
        packageData.pricing = { [currency]: packageData.pricing[currency] };
        return packageData;
      });
  }

  res.status(200).json({
    success: true,
    data: {
      packages: processedPackages,
      count: processedPackages.length,
      filters: {
        searchTerm: q,
        minPrice,
        maxPrice,
        currency
      }
    }
  });
});