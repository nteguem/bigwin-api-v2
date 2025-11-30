// controllers/admin/affiliateTypeController.js

const AffiliateType = require('../../models/affiliate/AffiliateType');
const Affiliate = require('../../models/affiliate/Affiliate');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const catchAsync = require('../../../utils/catchAsync');

/**
 * Obtenir tous les types d'affiliés
 */
exports.getAllAffiliateTypes = catchAsync(async (req, res, next) => {
  // ⭐ Récupérer appId
  const appId = req.appId;
  
  const { offset = 0, limit = 20, search } = req.query;

  // ⭐ Construire les filtres AVEC APPID
  const filters = { appId };
  
  if (search) {
    filters.$or = [
      { name: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } }
    ];
  }

  const affiliateTypes = await AffiliateType.find(filters)
    .sort({ minAccounts: 1 })
    .skip(parseInt(offset))
    .limit(parseInt(limit));

  const total = await AffiliateType.countDocuments(filters);

  res.status(200).json({
    success: true,
    data: {
      affiliateTypes,
      pagination: {
        offset: parseInt(offset),
        limit: parseInt(limit),
        total
      }
    }
  });
});

/**
 * Obtenir un type d'affilié par ID
 */
exports.getAffiliateType = catchAsync(async (req, res, next) => {
  // ⭐ Récupérer appId
  const appId = req.appId;
  
  // ⭐ Filtrer par appId
  const affiliateType = await AffiliateType.findOne({ _id: req.params.id, appId });

  if (!affiliateType) {
    return next(new AppError('Type d\'affilié non trouvé', 404, ErrorCodes.NOT_FOUND));
  }

  // ⭐ Compter le nombre d'affiliés de ce type POUR CETTE APP
  const affiliatesCount = await Affiliate.countDocuments({ 
    affiliateType: affiliateType._id,
    appId // ⭐ AJOUT
  });

  res.status(200).json({
    success: true,
    data: {
      affiliateType,
      stats: {
        affiliatesCount
      }
    }
  });
});

/**
 * Créer un nouveau type d'affilié
 */
exports.createAffiliateType = catchAsync(async (req, res, next) => {
  // ⭐ Récupérer appId
  const appId = req.appId;
  
  const { name, description, minAccounts, commissionRate } = req.body;

  // Validation des champs obligatoires
  if (!name || !description || minAccounts === undefined || commissionRate === undefined) {
    return next(new AppError('Nom, description, nombre minimum de comptes et taux de commission sont requis', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // ⭐ Vérifier si le nom existe déjà DANS CETTE APP
  const existingType = await AffiliateType.findOne({ name: name.toUpperCase(), appId });
  if (existingType) {
    return next(new AppError('Ce nom de type d\'affilié existe déjà', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // ⭐ Créer le type d'affilié AVEC APPID
  const affiliateType = await AffiliateType.create({
    appId, // ⭐ AJOUT
    name: name.toUpperCase(),
    description,
    minAccounts,
    commissionRate
  });

  res.status(201).json({
    success: true,
    message: 'Type d\'affilié créé avec succès',
    data: {
      affiliateType
    }
  });
});

/**
 * Modifier un type d'affilié
 */
exports.updateAffiliateType = catchAsync(async (req, res, next) => {
  // ⭐ Récupérer appId
  const appId = req.appId;
  
  const { name, description, minAccounts, commissionRate } = req.body;

  // ⭐ Filtrer par appId
  const affiliateType = await AffiliateType.findOne({ _id: req.params.id, appId });
  if (!affiliateType) {
    return next(new AppError('Type d\'affilié non trouvé', 404, ErrorCodes.NOT_FOUND));
  }

  // ⭐ Vérifier si le nouveau nom existe déjà DANS CETTE APP (si changé)
  if (name && name.toUpperCase() !== affiliateType.name) {
    const existingType = await AffiliateType.findOne({ 
      name: name.toUpperCase(),
      appId, // ⭐ AJOUT
      _id: { $ne: req.params.id }
    });
    if (existingType) {
      return next(new AppError('Ce nom de type d\'affilié existe déjà', 400, ErrorCodes.VALIDATION_ERROR));
    }
  }

  // Mettre à jour les champs autorisés
  const updateData = {};
  if (name !== undefined) updateData.name = name.toUpperCase();
  if (description !== undefined) updateData.description = description;
  if (minAccounts !== undefined) updateData.minAccounts = minAccounts;
  if (commissionRate !== undefined) updateData.commissionRate = commissionRate;

  // ⭐ Filtrer par appId
  const updatedAffiliateType = await AffiliateType.findOneAndUpdate(
    { _id: req.params.id, appId }, // ⭐ AJOUT
    updateData,
    { new: true, runValidators: true }
  );

  res.status(200).json({
    success: true,
    message: 'Type d\'affilié mis à jour avec succès',
    data: {
      affiliateType: updatedAffiliateType
    }
  });
});

/**
 * Supprimer un type d'affilié
 */
exports.deleteAffiliateType = catchAsync(async (req, res, next) => {
  // ⭐ Récupérer appId
  const appId = req.appId;
  
  // ⭐ Filtrer par appId
  const affiliateType = await AffiliateType.findOne({ _id: req.params.id, appId });
  if (!affiliateType) {
    return next(new AppError('Type d\'affilié non trouvé', 404, ErrorCodes.NOT_FOUND));
  }

  // ⭐ Vérifier s'il y a des affiliés utilisant ce type DANS CETTE APP
  const affiliatesCount = await Affiliate.countDocuments({
    affiliateType: req.params.id,
    appId // ⭐ AJOUT
  });

  if (affiliatesCount > 0) {
    return next(new AppError(`Impossible de supprimer ce type. ${affiliatesCount} affilié(s) l'utilisent encore`, 400, ErrorCodes.VALIDATION_ERROR));
  }

  // ⭐ Filtrer par appId
  await AffiliateType.findOneAndDelete({ _id: req.params.id, appId });

  res.status(200).json({
    success: true,
    message: 'Type d\'affilié supprimé avec succès'
  });
});

/**
 * Obtenir les statistiques des types d'affiliés
 */
exports.getAffiliateTypeStats = catchAsync(async (req, res, next) => {
  // ⭐ Récupérer appId
  const appId = req.appId;
  
  // ⭐ Stats POUR CETTE APP
  const totalTypes = await AffiliateType.countDocuments({ appId });
  
  // ⭐ Statistiques par type POUR CETTE APP
  const typeStats = await AffiliateType.aggregate([
    { $match: { appId } }, // ⭐ AJOUT
    {
      $lookup: {
        from: 'affiliates',
        localField: '_id',
        foreignField: 'affiliateType',
        as: 'affiliates'
      }
    },
    {
      $project: {
        name: 1,
        minAccounts: 1,
        commissionRate: 1,
        affiliatesCount: { $size: '$affiliates' },
        activeAffiliatesCount: {
          $size: {
            $filter: {
              input: '$affiliates',
              as: 'affiliate',
              cond: { $eq: ['$$affiliate.isActive', true] }
            }
          }
        }
      }
    },
    {
      $sort: { minAccounts: 1 }
    }
  ]);

  res.status(200).json({
    success: true,
    data: {
      totalTypes,
      typeStats
    }
  });
});

/**
 * Obtenir le type approprié pour un nombre de comptes donné
 */
exports.getTypeByAccountCount = catchAsync(async (req, res, next) => {
  // ⭐ Récupérer appId
  const appId = req.appId;
  
  const { accountCount } = req.params;

  if (!accountCount || accountCount < 0) {
    return next(new AppError('Nombre de comptes invalide', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // ⭐ Chercher le type approprié DANS CETTE APP
  const appropriateType = await AffiliateType.findOne({
    appId, // ⭐ AJOUT
    minAccounts: { $lte: parseInt(accountCount) }
  }).sort({ minAccounts: -1 });

  if (!appropriateType) {
    return next(new AppError('Aucun type d\'affilié approprié trouvé pour ce nombre de comptes', 404, ErrorCodes.NOT_FOUND));
  }

  res.status(200).json({
    success: true,
    data: {
      accountCount: parseInt(accountCount),
      appropriateType
    }
  });
});

/**
 * Calculer la commission pour un montant donné et un type
 */
exports.calculateCommission = catchAsync(async (req, res, next) => {
  // ⭐ Récupérer appId
  const appId = req.appId;
  
  const { amount } = req.body;
  const typeId = req.params.id;

  if (!amount || amount <= 0) {
    return next(new AppError('Montant invalide', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // ⭐ Filtrer par appId
  const affiliateType = await AffiliateType.findOne({ _id: typeId, appId });
  if (!affiliateType) {
    return next(new AppError('Type d\'affilié non trouvé', 404, ErrorCodes.NOT_FOUND));
  }

  const commissionAmount = affiliateType.calculateCommission(amount);

  res.status(200).json({
    success: true,
    data: {
      originalAmount: amount,
      commissionRate: affiliateType.commissionRate,
      commissionAmount,
      affiliateType: {
        id: affiliateType._id,
        name: affiliateType.name
      }
    }
  });
});