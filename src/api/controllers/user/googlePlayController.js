// const GooglePlayService = require('../../services/user/GooglePlayService');
// const GooglePlayTransaction = require('../../models/user/GooglePlayTransaction');
// const catchAsync = require('../../../utils/catchAsync');
// const AppError = require('../../../utils/AppError');
// const { sendResponse } = require('../../../utils/responseFormatter');

// /**
//  * Vérifier et traiter un achat Google Play
//  */
// const verifyPurchase = catchAsync(async (req, res, next) => {
//   const { purchaseToken, orderId, productId } = req.body;
//   const userId = req.user._id;

//   // Vérifier si déjà traité
//   const existingTransaction = await GooglePlayTransaction.findOne({ purchaseToken });
//   if (existingTransaction) {
//     return next(new AppError('Purchase already processed', 400));
//   }

//   // Trouver le package via Product ID
//   const packageData = await GooglePlayService.findPackageByProductId(productId);

//   // Vérifier avec Google Play API
//   const googleResponse = await GooglePlayService.verifyPurchase(purchaseToken, productId);
  
//   // Vérifier l'état du paiement (0 = pending, 1 = purchased)
//   if (googleResponse.purchaseState !== 1) {
//     return next(new AppError('Purchase not completed', 400));
//   }

//   // Créer transaction
//   const transaction = await GooglePlayService.createTransaction(
//     userId,
//     packageData,
//     { purchaseToken, orderId, productId },
//     googleResponse
//   );

//   // Créer subscription
//   const subscription = await GooglePlayService.createSubscription(
//     userId,
//     packageData,
//     transaction._id,
//     googleResponse
//   );

//   sendResponse(res, 201, 'Purchase verified and subscription created', {
//     transaction: transaction._id,
//     subscription: subscription._id,
//     package: {
//       name: packageData.name,
//       duration: packageData.duration
//     },
//     endDate: subscription.endDate,
//     autoRenewing: googleResponse.autoRenewing || false
//   });
// });

// /**
//  * Vérifier un abonnement Google Play
//  */
// const verifySubscription = catchAsync(async (req, res, next) => {
//   const { purchaseToken, subscriptionId } = req.body;
//   const userId = req.user._id;

//   // Vérifier si déjà traité
//   const existingTransaction = await GooglePlayTransaction.findOne({ purchaseToken });
//   if (existingTransaction) {
//     return next(new AppError('Subscription already processed', 400));
//   }

//   // Trouver le package via Subscription ID (Product ID)
//   const packageData = await GooglePlayService.findPackageByProductId(subscriptionId);

//   // Vérifier avec Google Play API
//   const googleResponse = await GooglePlayService.verifySubscription(purchaseToken, subscriptionId);
  
//   // Vérifier l'état du paiement
//   if (googleResponse.paymentState !== 1) {
//     return next(new AppError('Subscription not active', 400));
//   }

//   // Créer transaction
//   const transaction = await GooglePlayService.createTransaction(
//     userId,
//     packageData,
//     { purchaseToken, subscriptionId, productId: subscriptionId },
//     googleResponse,
//     true
//   );

//   // Créer subscription
//   const subscription = await GooglePlayService.createSubscription(
//     userId,
//     packageData,
//     transaction._id,
//     googleResponse
//   );

//   sendResponse(res, 201, 'Subscription verified and created', {
//     transaction: transaction._id,
//     subscription: subscription._id,
//     package: {
//       name: packageData.name,
//       duration: packageData.duration
//     },
//     startDate: subscription.startDate,
//     endDate: subscription.endDate,
//     autoRenewing: googleResponse.autoRenewing
//   });
// });

// /**
//  * Webhook Google Play via Pub/Sub
//  */
// const handleWebhook = catchAsync(async (req, res, next) => {
//   const pubsubMessage = req.body;
  
//   if (!pubsubMessage || !pubsubMessage.message) {
//     return res.status(400).send('Invalid Pub/Sub message');
//   }

//   // Décoder le message Base64
//   let notification;
//   try {
//     const data = Buffer.from(pubsubMessage.message.data, 'base64').toString('utf-8');
//     notification = JSON.parse(data);
//   } catch (error) {
//     return res.status(400).send('Invalid notification data');
//   }

//   // Traiter la notification
//   await GooglePlayService.processWebhookNotification(notification);
  
//   // Accusé de réception pour Pub/Sub
//   res.status(200).send('OK');
// });

// /**
//  * Obtenir les transactions Google Play d'un utilisateur
//  */
// const getUserTransactions = catchAsync(async (req, res, next) => {
//   const userId = req.user._id;
  
//   const transactions = await GooglePlayTransaction
//     .find({ user: userId })
//     .populate('package', 'name description duration google_play_product_id')
//     .sort({ createdAt: -1 });

//   sendResponse(res, 200, 'Transactions retrieved successfully', transactions);
// });

// /**
//  * Obtenir le statut des abonnements actifs
//  */
// const getActiveSubscriptions = catchAsync(async (req, res, next) => {
//   const userId = req.user._id;
  
//   const activeTransactions = await GooglePlayTransaction
//     .find({ 
//       user: userId, 
//       status: { $in: ['verified', 'renewed'] }
//     })
//     .populate('package', 'name description duration')
//     .sort({ createdAt: -1 });

//   const subscriptionsData = await Promise.all(
//     activeTransactions.map(async (transaction) => {
//       const subscription = await Subscription.findOne({
//         paymentReference: transaction._id,
//         status: 'active'
//       });

//       return {
//         transaction: transaction._id,
//         package: transaction.package,
//         purchaseDate: transaction.purchaseTime,
//         expiryDate: transaction.expiryTime || subscription?.endDate,
//         autoRenewing: transaction.autoRenewing,
//         status: transaction.status,
//         subscriptionActive: !!subscription
//       };
//     })
//   );

//   sendResponse(res, 200, 'Active subscriptions retrieved', subscriptionsData);
// });

// /**
//  * Obtenir les packages disponibles pour Google Play
//  */
// const getGooglePlayPackages = catchAsync(async (req, res, next) => {
//   const Package = require('../../models/common/Package');
  
//   const packages = await Package.find({
//     'platform_availability.google_play': true,
//     isActive: true,
//     google_play_product_id: { $exists: true, $ne: null }
//   }).select('name description duration google_play_product_id pricing badge economy');

//   sendResponse(res, 200, 'Google Play packages retrieved', packages);
// });

// module.exports = {
//   verifyPurchase,
//   verifySubscription,
//   handleWebhook,
//   getUserTransactions,
//   getActiveSubscriptions,
//   getGooglePlayPackages
// };