// controllers/user/googlePlayController.js
const catchAsync = require('../../../utils/catchAsync');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const googlePlayService = require('../../services/user/GooglePlayService');
const Package = require('../../models/common/Package');
const App = require('../../models/common/App');

// ===== EXISTANT : Valider un ABONNEMENT depuis Flutter =====
exports.validatePurchase = catchAsync(async (req, res, next) => {
  const { purchaseToken, productId, packageId } = req.body;
  const userId = req.user._id;

  const appId = req.appId;
  const currentApp = req.currentApp;

  // Vérifier que appId est présent
  if (!appId || !currentApp) {
    return next(new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // Validation des données
  if (!purchaseToken || !productId || !packageId) {
    return next(new AppError('Données de validation manquantes', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // Vérifier que Google Play est configuré pour cette app
  if (!currentApp.googlePlay?.packageName || !currentApp.googlePlay?.serviceAccountKeyPath) {
    return next(new AppError('Google Play n\'est pas configuré pour cette application', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // Vérifier que le package existe et appartient à cette app
  const packageItem = await Package.findOne({ _id: packageId, appId });
  if (!packageItem) {
    return next(new AppError('Package introuvable', 404, ErrorCodes.NOT_FOUND));
  }

  // Vérifier que le package a un produit Google
  if (!packageItem.googleProductId) {
    return next(new AppError('Ce package n\'est pas disponible sur Google Play', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // Valider l'achat
  const result = await googlePlayService.validatePurchase(
    appId,
    currentApp,
    purchaseToken,
    productId,
    userId,
    packageId
  );

  if (!result.success) {
    return next(new AppError('Validation de l\'achat échouée', 400, ErrorCodes.VALIDATION_ERROR));
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

  const appId = req.appId;
  const currentApp = req.currentApp;

  // Vérifier que appId est présent
  if (!appId || !currentApp) {
    return next(new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // Validation des données
  if (!purchaseToken || !productId || !packageId) {
    return next(new AppError('Données de validation manquantes', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // Vérifier que Google Play est configuré pour cette app
  if (!currentApp.googlePlay?.packageName || !currentApp.googlePlay?.serviceAccountKeyPath) {
    return next(new AppError('Google Play n\'est pas configuré pour cette application', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // Vérifier que le package existe et appartient à cette app
  const packageItem = await Package.findOne({ _id: packageId, appId });
  if (!packageItem) {
    return next(new AppError('Package introuvable', 404, ErrorCodes.NOT_FOUND));
  }

  // Vérifier que c'est bien un produit ponctuel Google
  if (!packageItem.isGooglePlayOneTimeProduct()) {
    return next(new AppError('Ce package n\'est pas un produit ponctuel Google Play', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // Valider l'achat
  const result = await googlePlayService.validateOneTimePurchase(
    appId,
    currentApp,
    purchaseToken,
    productId,
    userId,
    packageId
  );

  if (!result.success) {
    return next(new AppError('Validation du produit échouée', 400, ErrorCodes.VALIDATION_ERROR));
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

  const appId = req.appId;
  const currentApp = req.currentApp;

  // Vérifier que appId est présent
  if (!appId || !currentApp) {
    return next(new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // Vérifier que Google Play est configuré pour cette app
  if (!currentApp.googlePlay?.packageName || !currentApp.googlePlay?.serviceAccountKeyPath) {
    return next(new AppError('Google Play n\'est pas configuré pour cette application', 400, ErrorCodes.VALIDATION_ERROR));
  }

  const status = await googlePlayService.checkSubscriptionStatus(appId, currentApp, userId);

  res.status(200).json({
    status: 'success',
    data: status
  });
});

// ===== MODIFIÉ : Webhook RTDN - Recevoir les notifications de Google =====
exports.handleRTDN = catchAsync(async (req, res, next) => {
  console.log('=== WEBHOOK GOOGLE PLAY REÇU ===');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body complet:', JSON.stringify(req.body, null, 2));
  
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

    // ===== IDENTIFIER L'APP VIA LE PACKAGE NAME =====
    const packageName = notification.packageName;
    
    if (!packageName) {
      console.error('[Webhook Google Play] packageName manquant dans la notification');
      return res.status(200).send(); // Répondre 200 pour éviter les retry
    }

    console.log(`[Webhook Google Play] PackageName reçu: ${packageName}`);

    // Chercher l'app par packageName
    const currentApp = await App.findOne({ 
      'googlePlay.packageName': packageName,
      isActive: true 
    }).lean();

    if (!currentApp) {
      console.error(`[Webhook Google Play] App non trouvée pour packageName: ${packageName}`);
      return res.status(200).send(); // Répondre 200 pour éviter les retry
    }

    const appId = currentApp.appId;
    console.log(`[Webhook Google Play] App identifiée: ${appId}`);

    // Vérifier que Google Play est configuré
    if (!currentApp.googlePlay?.serviceAccountKeyPath) {
      console.error(`[Webhook Google Play] serviceAccountKeyPath manquant pour app ${appId}`);
      return res.status(200).send();
    }

    // ===== EXISTANT : Traiter la notification d'abonnement =====
    if (notification.subscriptionNotification) {
      console.log('📱 Notification d\'abonnement reçue');
      await googlePlayService.processNotification(appId, currentApp, notification);
    }

    // ===== NOUVEAU : Traiter la notification de produit ponctuel =====
    if (notification.oneTimeProductNotification) {
      console.log('🛒 Notification de produit ponctuel reçue');
      await googlePlayService.processNotification(appId, currentApp, notification);
    }

    console.log('===================');
    // Toujours répondre 200 pour que Google ne renvoie pas
    res.status(200).send();

  } catch (error) {
    console.error('❌ Erreur traitement RTDN:', error.message);
    console.error('Error stack:', error.stack);
    console.log('===================');
    // Répondre 200 même en cas d'erreur pour éviter les renvois
    res.status(200).send();
  }
});

// ===== EXISTANT : Acknowledge manuel d'un achat =====
exports.acknowledgePurchase = catchAsync(async (req, res, next) => {
  const { purchaseToken } = req.params;
  const userId = req.user._id;

  const appId = req.appId;
  const currentApp = req.currentApp;

  // Vérifier que appId est présent
  if (!appId || !currentApp) {
    return next(new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // Vérifier que Google Play est configuré pour cette app
  if (!currentApp.googlePlay?.packageName || !currentApp.googlePlay?.serviceAccountKeyPath) {
    return next(new AppError('Google Play n\'est pas configuré pour cette application', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // Vérifier que l'achat appartient à l'utilisateur et à cette app
  const GooglePlayTransaction = require('../../models/user/GooglePlayTransaction');
  const transaction = await GooglePlayTransaction.findOne({
    appId,
    purchaseToken,
    user: userId
  });

  if (!transaction) {
    return next(new AppError('Transaction introuvable', 404, ErrorCodes.NOT_FOUND));
  }

  if (transaction.acknowledged) {
    return res.status(200).json({
      status: 'success',
      message: 'Achat déjà acknowledgé'
    });
  }

  const success = await googlePlayService.acknowledgePurchase(currentApp, purchaseToken);

  if (!success) {
    return next(new AppError('Échec de l\'acknowledge', 500, ErrorCodes.INTERNAL_ERROR));
  }

  res.status(200).json({
    status: 'success',
    message: 'Achat acknowledgé avec succès'
  });
});

// ===== EXISTANT : Récupérer l'info du produit Google Play pour un package =====
exports.getGoogleProductInfo = catchAsync(async (req, res, next) => {
  const { packageId } = req.params;

  const appId = req.appId;
  const currentApp = req.currentApp;

  // Vérifier que appId est présent
  if (!appId || !currentApp) {
    return next(new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // Vérifier que le package existe et appartient à cette app
  const packageItem = await Package.findOne({ _id: packageId, appId });
  
  if (!packageItem) {
    return next(new AppError('Package introuvable', 404, ErrorCodes.NOT_FOUND));
  }

  if (!packageItem.googleProductId) {
    return next(new AppError('Ce package n\'est pas disponible sur Google Play', 404, ErrorCodes.NOT_FOUND));
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

  const appId = req.appId;
  const currentApp = req.currentApp;

  // Vérifier que appId est présent
  if (!appId || !currentApp) {
    return next(new AppError('Header X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // Vérifier que Google Play est configuré pour cette app
  if (!currentApp.googlePlay?.packageName || !currentApp.googlePlay?.serviceAccountKeyPath) {
    return next(new AppError('Google Play n\'est pas configuré pour cette application', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // Récupérer la transaction active de l'utilisateur pour cette app
  const GooglePlayTransaction = require('../../models/user/GooglePlayTransaction');
  const transaction = await GooglePlayTransaction.findOne({
    appId,
    user: userId,
    status: { $ne: 'EXPIRED' }
  }).sort({ createdAt: -1 });

  if (!transaction) {
    return next(new AppError('Aucun abonnement Google Play trouvé', 404, ErrorCodes.NOT_FOUND));
  }

  const syncedTx = await googlePlayService.syncSubscription(currentApp, transaction.purchaseToken);

  res.status(200).json({
    status: 'success',
    data: {
      message: 'Synchronisation effectuée',
      status: syncedTx.status,
      expiryTime: syncedTx.expiryTime
    }
  });
});