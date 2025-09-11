const catchAsync = require('../../../utils/catchAsync');
const AppError = require('../../../utils/AppError');
const googlePlayService = require('../../services/user/GooglePlayService');
const Package = require('../../models/common/Package');

// Valider un achat depuis Flutter
exports.validatePurchase = catchAsync(async (req, res, next) => {
  const { purchaseToken, productId, packageId } = req.body;
  const userId = req.user._id;

  // Validation des données
  if (!purchaseToken || !productId || !packageId) {
    return next(new AppError('Données de validation manquantes', 400));
  }

  // Vérifier que le package existe
  const packageItem = await Package.findById(packageId);
  if (!packageItem) {
    return next(new AppError('Package introuvable', 404));
  }

  // Vérifier que le package a un produit Google
  if (!packageItem.googleProductId) {
    return next(new AppError('Ce package n\'est pas disponible sur Google Play', 400));
  }

  // Valider l'achat
  const result = await googlePlayService.validatePurchase(
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
      subscription: result.subscription,
      message: result.message
    }
  });
});

// Vérifier le statut de l'abonnement
exports.getSubscriptionStatus = catchAsync(async (req, res, next) => {
  const userId = req.user._id;

  const status = await googlePlayService.checkSubscriptionStatus(userId);

  res.status(200).json({
    status: 'success',
    data: status
  });
});

// Webhook RTDN - Recevoir les notifications de Google
exports.handleRTDN = catchAsync(async (req, res, next) => {
  // Google envoie les données en base64
  const message = req.body.message;
  
  if (!message || !message.data) {
    return res.status(400).json({ error: 'Message invalide' });
  }

  try {
    // Décoder le message base64
    const decodedData = Buffer.from(message.data, 'base64').toString('utf-8');
    const notification = JSON.parse(decodedData);

    // Vérifier si c'est une notification de test
    if (notification.testNotification) {
      console.log('Notification de test reçue');
      return res.status(200).send();
    }

    // Traiter la notification d'abonnement
    if (notification.subscriptionNotification) {
      await googlePlayService.processNotification(notification);
    }

    // Toujours répondre 200 pour que Google ne renvoie pas
    res.status(200).send();

  } catch (error) {
    console.error('Erreur traitement RTDN:', error);
    // Répondre 200 même en cas d'erreur pour éviter les renvois
    res.status(200).send();
  }
});

// Acknowledge manuel d'un achat
exports.acknowledgePurchase = catchAsync(async (req, res, next) => {
  const { purchaseToken } = req.params;
  const userId = req.user._id;

  // Vérifier que l'achat appartient à l'utilisateur
  const GooglePlayTransaction = require('../../models/user/GooglePlayTransaction');
  const transaction = await GooglePlayTransaction.findOne({
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

// Récupérer l'info du produit Google Play pour un package
exports.getGoogleProductInfo = catchAsync(async (req, res, next) => {
  const { packageId } = req.params;

  const packageItem = await Package.findById(packageId);
  
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
      pricing: packageItem.pricing
    }
  });
});

// Synchroniser manuellement un abonnement
exports.syncSubscription = catchAsync(async (req, res, next) => {
  const userId = req.user._id;

  // Récupérer la transaction active de l'utilisateur
  const GooglePlayTransaction = require('../../models/user/GooglePlayTransaction');
  const transaction = await GooglePlayTransaction.findOne({
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