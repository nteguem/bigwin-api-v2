// controllers/user/googlePlayController.js

const catchAsync = require('../../../utils/catchAsync');
const AppError = require('../../../utils/AppError');
const googlePlayService = require('../../services/user/GooglePlayService');
const Package = require('../../models/common/Package');

/**
 * Valider un ABONNEMENT depuis Flutter
 */
exports.validatePurchase = catchAsync(async (req, res, next) => {
  const { purchaseToken, productId, packageId } = req.body;
  const userId = req.user._id;
  const appId = req.appId;

  if (!purchaseToken || !productId || !packageId) {
    return next(new AppError('Données de validation manquantes', 400));
  }

  const packageItem = await Package.findOne({ _id: packageId, appId });
  if (!packageItem) {
    return next(new AppError('Package introuvable', 404));
  }

  if (!packageItem.googleProductId) {
    return next(new AppError('Ce package n\'est pas disponible sur Google Play', 400));
  }

  const result = await googlePlayService.validatePurchase(
    appId,
    purchaseToken,
    productId,
    userId,
    packageId
  );

  if (!result.success) {
    return next(new AppError('Validation de l\'achat échouée', 400));
  }

  res.status(200).json({
    status: 'success',
    data: {
      subscription: result.data.subscription,
      message: result.data.message
    }
  });
});

/**
 * Valider un PRODUIT PONCTUEL depuis Flutter
 */
exports.validateOneTimePurchase = catchAsync(async (req, res, next) => {
  const { purchaseToken, productId, packageId } = req.body;
  const userId = req.user._id;
  const appId = req.appId;

  if (!purchaseToken || !productId || !packageId) {
    return next(new AppError('Données de validation manquantes', 400));
  }

  const packageItem = await Package.findOne({ _id: packageId, appId });
  if (!packageItem) {
    return next(new AppError('Package introuvable', 404));
  }

  if (!packageItem.isGooglePlayOneTimeProduct()) {
    return next(new AppError('Ce package n\'est pas un produit ponctuel Google Play', 400));
  }

  const result = await googlePlayService.validateOneTimePurchase(
    appId,
    purchaseToken,
    productId,
    userId,
    packageId
  );

  if (!result.success) {
    return next(new AppError('Validation du produit échouée', 400));
  }

  res.status(200).json({
    status: 'success',
    data: {
      subscription: result.data.subscription,
      message: result.data.message
    }
  });
});

/**
 * Vérifier le statut de l'abonnement
 */
exports.getSubscriptionStatus = catchAsync(async (req, res, next) => {
  const userId = req.user._id;
  const appId = req.appId;

  const status = await googlePlayService.checkSubscriptionStatus(appId, userId);

  res.status(200).json({
    status: 'success',
    data: status
  });
});

/**
 * Webhook RTDN - Recevoir les notifications de Google
 */
exports.handleRTDN = catchAsync(async (req, res, next) => {
  console.log('=== WEBHOOK REÇU ===');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body complet:', JSON.stringify(req.body, null, 2));
  
  const appId = req.appId;
  
  if (!req.body || !req.body.message) {
    console.log('Test manuel ou format invalide');
    return res.status(200).json({
      status: 'success',
      message: 'Webhook reçu (test format)',
      received: req.body
    });
  }

  const message = req.body.message;
  
  if (!message.data) {
    console.log('Pas de data dans le message');
    return res.status(200).send();
  }

  try {
    const decodedData = Buffer.from(message.data, 'base64').toString('utf-8');
    console.log('Data décodée:', decodedData);
    
    if (decodedData === 'test' || decodedData.length < 10) {
      console.log('✅ Test basique reçu et décodé correctement');
      return res.status(200).json({
        status: 'success',
        message: 'Test décodage OK',
        decoded: decodedData
      });
    }
    
    const notification = JSON.parse(decodedData);
    console.log('Notification parsée:', JSON.stringify(notification, null, 2));

    if (notification.testNotification) {
      console.log('✅ Notification de test Google reçue !');
      return res.status(200).send();
    }

    if (notification.subscriptionNotification) {
      console.log(`📱 [${appId}] Notification d'abonnement reçue`);
      await googlePlayService.processNotification(appId, notification);
    }

    if (notification.oneTimeProductNotification) {
      console.log(`🛒 [${appId}] Notification de produit ponctuel reçue`);
      await googlePlayService.processNotification(appId, notification);
    }

    console.log('===================');
    res.status(200).send();

  } catch (error) {
    console.error(`❌ [${appId}] Erreur traitement RTDN:`, error.message);
    console.log('===================');
    res.status(200).send();
  }
});

/**
 * Acknowledge manuel d'un achat
 */
exports.acknowledgePurchase = catchAsync(async (req, res, next) => {
  const { purchaseToken } = req.params;
  const userId = req.user._id;
  const appId = req.appId;

  const GooglePlayTransaction = require('../../models/user/GooglePlayTransaction');
  const transaction = await GooglePlayTransaction.findOne({
    appId,
    purchaseToken,
    user: userId
  });

  if (!transaction) {
    return next(new AppError('Transaction introuvable', 404));
  }

  if (transaction.acknowledged) {
    return res.status(200).json({
      status: 'success',
      message: 'Achat déjà acknowledgé'
    });
  }

  const success = await googlePlayService.acknowledgePurchase(appId, purchaseToken);

  if (!success) {
    return next(new AppError('Échec de l\'acknowledge', 500));
  }

  res.status(200).json({
    status: 'success',
    message: 'Achat acknowledgé avec succès'
  });
});

/**
 * Récupérer l'info du produit Google Play pour un package
 */
exports.getGoogleProductInfo = catchAsync(async (req, res, next) => {
  const { packageId } = req.params;
  const appId = req.appId;

  const packageItem = await Package.findOne({ _id: packageId, appId });
  
  if (!packageItem) {
    return next(new AppError('Package introuvable', 404));
  }

  if (!packageItem.googleProductId) {
    return next(new AppError('Ce package n\'est pas disponible sur Google Play', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      packageId: packageItem._id,
      packageName: packageItem.name,
      googleProductId: packageItem.googleProductId,
      googleProductType: packageItem.googleProductType || 'SUBSCRIPTION',
      pricing: packageItem.pricing
    }
  });
});

/**
 * Synchroniser manuellement un abonnement
 */
exports.syncSubscription = catchAsync(async (req, res, next) => {
  const userId = req.user._id;
  const appId = req.appId;

  const GooglePlayTransaction = require('../../models/user/GooglePlayTransaction');
  const transaction = await GooglePlayTransaction.findOne({
    appId,
    user: userId,
    status: { $ne: 'EXPIRED' }
  }).sort({ createdAt: -1 });

  if (!transaction) {
    return next(new AppError('Aucun abonnement Google Play trouvé', 404));
  }

  const syncedTx = await googlePlayService.syncSubscription(appId, transaction.purchaseToken);

  res.status(200).json({
    status: 'success',
    data: {
      message: 'Synchronisation effectuée',
      status: syncedTx.status,
      expiryTime: syncedTx.expiryTime
    }
  });
});