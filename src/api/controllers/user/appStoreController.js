// src/api/controllers/user/appStoreController.js
//
// Endpoints App Store (iOS IAP). Mirror plus léger de googlePlayController.
// La validation effective des transactions StoreKit 2 est marquée Not
// Implemented (501) — cf. AppStoreService pour le plan de complétion.

const catchAsync = require('../../../utils/catchAsync');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const appStoreService = require('../../services/user/AppStoreService');

/**
 * Valider un achat App Store (subscription).
 *
 * Body attendu :
 *   - signedTransaction : JWS de la transaction StoreKit 2 envoyé par le client
 *   - productId : appleProductId
 *   - packageId : Package._id côté backend
 */
exports.validatePurchase = catchAsync(async (req, res, next) => {
  const { signedTransaction, productId, packageId } = req.body;
  const appId = req.appId;

  if (!appId || !req.currentApp) {
    return next(new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR));
  }
  if (!signedTransaction || !productId || !packageId) {
    return next(new AppError(
      'signedTransaction, productId et packageId requis',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }

  try {
    const result = await appStoreService.validateTransaction(appId, {
      signedTransaction,
      productId,
      packageId,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof appStoreService.NotImplementedError) {
      req.log?.warn?.('app-store validatePurchase called but not yet implemented', {
        service: 'appStore',
        category: 'iap',
      });
      return res.status(501).json({
        success: false,
        message: 'App Store purchase validation not yet implemented on the backend',
        code: 'NOT_IMPLEMENTED',
      });
    }
    if (error instanceof AppError) {
      return next(error);
    }
    return next(new AppError(
      'Erreur lors de la validation de l\'achat App Store',
      500,
      ErrorCodes.INTERNAL_ERROR
    ));
  }
});

/**
 * Valider un achat App Store one-time (consumable).
 */
exports.validateOneTimePurchase = catchAsync(async (req, res, next) => {
  const { signedTransaction, productId, packageId } = req.body;
  const appId = req.appId;

  if (!appId || !req.currentApp) {
    return next(new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR));
  }
  if (!signedTransaction || !productId || !packageId) {
    return next(new AppError(
      'signedTransaction, productId et packageId requis',
      400,
      ErrorCodes.VALIDATION_ERROR
    ));
  }

  try {
    const result = await appStoreService.validateOneTimePurchase(appId, {
      signedTransaction,
      productId,
      packageId,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof appStoreService.NotImplementedError) {
      req.log?.warn?.('app-store validateOneTimePurchase called but not yet implemented', {
        service: 'appStore',
        category: 'iap',
      });
      return res.status(501).json({
        success: false,
        message: 'App Store one-time purchase validation not yet implemented',
        code: 'NOT_IMPLEMENTED',
      });
    }
    if (error instanceof AppError) {
      return next(error);
    }
    return next(new AppError(
      'Erreur lors de la validation de l\'achat App Store',
      500,
      ErrorCodes.INTERNAL_ERROR
    ));
  }
});

/**
 * GET /products/:packageId — renvoie le produit App Store associé au package.
 * Pleinement fonctionnel (lit depuis la BDD).
 */
exports.getAppleProductInfo = catchAsync(async (req, res, next) => {
  const { packageId } = req.params;
  const appId = req.appId;

  if (!appId) {
    return next(new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR));
  }

  const productInfo = await appStoreService.getProductInfo(appId, packageId);

  if (!productInfo) {
    return res.status(404).json({
      success: false,
      message: 'Ce package n\'est pas disponible sur l\'App Store',
      code: 'NOT_AVAILABLE_ON_APP_STORE',
    });
  }

  return res.json({
    status: 'success',
    data: productInfo,
  });
});
