const Package = require('../../models/common/Package');
const Formation = require('../../models/common/Formation');
const Category = require('../../models/common/Category');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const catchAsync = require('../../../utils/catchAsync');

/**
 * Obtenir tous les packages (admin)
 */
exports.getAllPackages = catchAsync(async (req, res, next) => {
  const { lang = 'fr', currency } = req.query;
  
  // Récupération uniquement des packages actifs
  const packages = await Package.find({ isActive: true })
    .populate('categories', 'name description isVip')
    .populate('formationId');

  let finalPackages = packages;

  // FILTRER par devise uniquement si currency est fourni
  if (currency) {
    finalPackages = packages.filter(pkg => {
      const price = pkg.getPricing(currency);
      return price !== null && price !== undefined;
    });

    // Si aucun package n'a cette devise, retourner vide
    if (!finalPackages.length) {
      return res.status(200).json({
        success: true,
        data: {
          packages: [],
          count: 0,
          currency: currency
        }
      });
    }

    // Trier par prix dans la devise demandée
    finalPackages = finalPackages.sort((a, b) => {
      const priceA = a.getPricing(currency) || 0;
      const priceB = b.getPricing(currency) || 0;
      return priceA - priceB;
    });
  }

  // Formater selon la langue
  const formattedPackages = finalPackages.map(pkg => {
    const formatted = pkg.formatForLanguage(lang);
    
    // Si une devise est spécifiée, ne retourner que le prix pour cette devise
    if (currency) {
      formatted.pricing = formatted.pricing[currency] || 0;
      formatted.economy = formatted.economy ? (formatted.economy[currency] || 0) : null;
    }
    // Sinon, retourner tous les prix (déjà formatés par formatForLanguage)
    
    return formatted;
  });

  const response = {
    success: true,
    data: {
      packages: formattedPackages,
      count: formattedPackages.length
    }
  };

  // Ajouter la devise dans la réponse seulement si elle a été fournie
  if (currency) {
    response.data.currency = currency;
  }

  res.status(200).json(response);
});
/**
 * Obtenir un package par ID
 */
exports.getPackage = catchAsync(async (req, res, next) => {
  const { lang = 'fr' } = req.query;
  
  const package = await Package.findById(req.params.id)
    .populate('categories', 'name description isVip')
    .populate('formationId');

  if (!package) {
    return next(new AppError('Package non trouvé', 404, ErrorCodes.NOT_FOUND));
  }

  const formattedPackage = package.formatForLanguage(lang);

  res.status(200).json({
    success: true,
    data: {
      package: formattedPackage
    }
  });
});

/**
 * Créer un nouveau package
 */
exports.createPackage = catchAsync(async (req, res, next) => {
  const { name, description, pricing, duration, categories, badge, economy, formationId } = req.body;

  // Validation des champs obligatoires
  if (!name?.fr || !name?.en || !pricing?.XAF || !duration) {
    return next(new AppError('Nom (FR/EN), prix en XAF et durée sont requis', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // Vérifier que les catégories existent
  if (categories && categories.length > 0) {
    const existingCategories = await Category.find({ _id: { $in: categories } });
    if (existingCategories.length !== categories.length) {
      return next(new AppError('Une ou plusieurs catégories sont invalides', 400, ErrorCodes.VALIDATION_ERROR));
    }
  }

  // Vérifier que la formation existe si fournie
  if (formationId) {
    const existingFormation = await Formation.findById(formationId);
    if (!existingFormation) {
      return next(new AppError('Formation invalide', 400, ErrorCodes.VALIDATION_ERROR));
    }
  }

  const package = await Package.create({
    name,
    description,
    pricing,
    duration,
    categories: categories || [],
    badge,
    economy,
    formationId
  });

  // Populer les relations pour la réponse
  await package.populate('categories', 'name isVip');
  await package.populate('formationId');

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
  const { name, description, pricing, duration, categories, badge, economy, formationId, isActive } = req.body;

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

  // Vérifier la formation si fournie
  if (formationId) {
    const existingFormation = await Formation.findById(formationId);
    if (!existingFormation) {
      return next(new AppError('Formation invalide', 400, ErrorCodes.VALIDATION_ERROR));
    }
  }

  // Mettre à jour les champs
  const updateData = {};
  if (name !== undefined) updateData.name = name;
  if (description !== undefined) updateData.description = description;
  if (pricing !== undefined) updateData.pricing = pricing;
  if (duration !== undefined) updateData.duration = duration;
  if (categories !== undefined) updateData.categories = categories;
  if (badge !== undefined) updateData.badge = badge;
  if (economy !== undefined) updateData.economy = economy;
  if (formationId !== undefined) updateData.formationId = formationId;
  if (isActive !== undefined) updateData.isActive = isActive;

  package = await Package.findByIdAndUpdate(
    req.params.id,
    updateData,
    { new: true, runValidators: true }
  ).populate('categories', 'name isVip').populate('formationId');

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