// controllers/user/googlePlayController.js

const catchAsync = require('../../../utils/catchAsync');
const AppError = require('../../../utils/AppError');
const googlePlayService = require('../../services/user/GooglePlayService');
const Package = require('../../models/common/Package');

// ===== EXISTANT : Valider un ABONNEMENT depuis Flutter =====
exports.validatePurchase = catchAsync(async (req, res, next) => {
  const { purchaseToken, productId, packageId } = req.body;
  const userId = req.user._id;

  // ⭐ Récupérer appId
  const appId = req.appId;

  // Validation des données
  if (!purchaseToken || !productId || !packageId) {
    return next(new AppError('Données de validation manquantes', 400));
  }

  // ⭐ Vérifier que le package existe POUR CETTE APP
  const packageItem = await Package.findOne({ _id: packageId, appId });
  if (!packageItem) {
    return next(new AppError('Package introuvable', 404));
  }

  // Vérifier que le package a un produit Google
  if (!packageItem.googleProductId) {
    return next(new AppError('Ce package n\'est pas disponible sur Google Play', 400));
  }

  // ⭐ Valider l'achat avec appId
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

// ===== NOUVEAU : Valider un PRODUIT PONCTUEL depuis Flutter =====
exports.validateOneTimePurchase = catchAsync(async (req, res, next) => {
  const { purchaseToken, productId, packageId } = req.body;
  const userId = req.user._id;

  // ⭐ Récupérer appId
  const appId = req.appId;

  // Validation des données
  if (!purchaseToken || !productId || !packageId) {
    return next(new AppError('Données de validation manquantes', 400));
  }

  // ⭐ Vérifier que le package existe POUR CETTE APP
  const packageItem = await Package.findOne({ _id: packageId, appId });
  if (!packageItem) {
    return next(new AppError('Package introuvable', 404));
  }

  // Vérifier que c'est bien un produit ponctuel Google
  if (!packageItem.isGooglePlayOneTimeProduct()) {
    return next(new AppError('Ce package n\'est pas un produit ponctuel Google Play', 400));
  }

  // ⭐ Valider l'achat avec appId
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

// ===== EXISTANT : Vérifier le statut de l'abonnement =====
exports.getSubscriptionStatus = catchAsync(async (req, res, next) => {
  const userId = req.user._id;

  // ⭐ Récupérer appId
  const appId = req.appId;

  const status = await googlePlayService.checkSubscriptionStatus(appId, userId);

  res.status(200).json({
    status: 'success',
    data: status
  });
});

// ===== MODIFIÉ : Webhook RTDN - Recevoir les notifications de Google =====
exports.handleRTDN = catchAsync(async (req, res, next) => {
  console.log('=== WEBHOOK REÇU ===');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body complet:', JSON.stringify(req.body, null, 2));
  
  // ⭐ Récupérer appId
  const appId = req.appId;
  
  // Vérifier si c'est un test manuel ou Google
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
    // Décoder le message base64
    const decodedData = Buffer.from(message.data, 'base64').toString('utf-8');
    console.log('Data décodée:', decodedData);
    
    // Vérifier si c'est un test simple (pas JSON)
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

    // Vérifier si c'est une notification de test Google
    if (notification.testNotification) {
      console.log('✅ Notification de test Google reçue !');
      return res.status(200).send();
    }

    // ===== EXISTANT : Traiter la notification d'abonnement =====
    if (notification.subscriptionNotification) {
      console.log('📱 Notification d\'abonnement reçue');
      // ⭐ Passer appId au service
      await googlePlayService.processNotification(appId, notification);
    }

    // ===== NOUVEAU : Traiter la notification de produit ponctuel =====
    if (notification.oneTimeProductNotification) {
      console.log('🛒 Notification de produit ponctuel reçue');
      // ⭐ Passer appId au service
      await googlePlayService.processNotification(appId, notification);
    }

    console.log('===================');
    // Toujours répondre 200 pour que Google ne renvoie pas
    res.status(200).send();

  } catch (error) {
    console.error('❌ Erreur traitement RTDN:', error.message);
    console.log('===================');
    // Répondre 200 même en cas d'erreur pour éviter les renvois
    res.status(200).send();
  }
});

// ===== EXISTANT : Acknowledge manuel d'un achat =====
exports.acknowledgePurchase = catchAsync(async (req, res, next) => {
  const { purchaseToken } = req.params;
  const userId = req.user._id;

  // ⭐ Récupérer appId
  const appId = req.appId;

  // Vérifier que l'achat appartient à l'utilisateur
  const GooglePlayTransaction = require('../../models/user/GooglePlayTransaction');
  const transaction = await GooglePlayTransaction.findOne({
    appId, // ⭐ Filtrer par appId
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

  const success = await googlePlayService.acknowledgePurchase(purchaseToken);

  if (!success) {
    return next(new AppError('Échec de l\'acknowledge', 500));
  }

  res.status(200).json({
    status: 'success',
    message: 'Achat acknowledgé avec succès'
  });
});

// ===== EXISTANT : Récupérer l'info du produit Google Play pour un package =====
exports.getGoogleProductInfo = catchAsync(async (req, res, next) => {
  const { packageId } = req.params;

  // ⭐ Récupérer appId
  const appId = req.appId;

  // ⭐ Rechercher package pour cette app
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

// ===== EXISTANT : Synchroniser manuellement un abonnement =====
exports.syncSubscription = catchAsync(async (req, res, next) => {
  const userId = req.user._id;

  // ⭐ Récupérer appId
  const appId = req.appId;

  // ⭐ Récupérer la transaction active de l'utilisateur POUR CETTE APP
  const GooglePlayTransaction = require('../../models/user/GooglePlayTransaction');
  const transaction = await GooglePlayTransaction.findOne({
    appId, // ⭐ Filtrer par appId
    user: userId,
    status: { $ne: 'EXPIRED' }
  }).sort({ createdAt: -1 });

  if (!transaction) {
    return next(new AppError('Aucun abonnement Google Play trouvé', 404));
  }

  const syncedTx = await googlePlayService.syncSubscription(transaction.purchaseToken);

  res.status(200).json({
    status: 'success',
    data: {
      message: 'Synchronisation effectuée',
      status: syncedTx.status,
      expiryTime: syncedTx.expiryTime
    }
  });
});