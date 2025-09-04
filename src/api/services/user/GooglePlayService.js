// const { google } = require('googleapis');
// const { PubSub } = require('@google-cloud/pubsub');
// const GooglePlayTransaction = require('../../models/user/GooglePlayTransaction');
// const Subscription = require('../../models/common/Subscription');
// const Package = require('../../models/common/Package');
// const AppError = require('../../../utils/AppError');

// class GooglePlayService {
//   constructor() {
//     this.packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME;
//     this.serviceAccountKey = JSON.parse(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY);
//     this.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
    
//     // Google Play API
//     this.androidPublisher = google.androidpublisher({
//       version: 'v3',
//       auth: new google.auth.GoogleAuth({
//         credentials: this.serviceAccountKey,
//         scopes: ['https://www.googleapis.com/auth/androidpublisher']
//       })
//     });

//     // Google Cloud Pub/Sub pour webhooks
//     this.pubSubClient = new PubSub({
//       projectId: this.projectId,
//       credentials: this.serviceAccountKey
//     });
//   }

//   /**
//    * Vérifier un achat Google Play (produit unique)
//    */
//   async verifyPurchase(purchaseToken, productId) {
//     try {
//       const response = await this.androidPublisher.purchases.products.get({
//         packageName: this.packageName,
//         productId: productId,
//         token: purchaseToken
//       });
//       return response.data;
//     } catch (error) {
//       throw new AppError(`Google Play verification failed: ${error.message}`, 400);
//     }
//   }

//   /**
//    * Vérifier un abonnement Google Play
//    */
//   async verifySubscription(purchaseToken, subscriptionId) {
//     try {
//       const response = await this.androidPublisher.purchases.subscriptions.get({
//         packageName: this.packageName,
//         subscriptionId: subscriptionId,
//         token: purchaseToken
//       });
//       return response.data;
//     } catch (error) {
//       throw new AppError(`Google Play subscription verification failed: ${error.message}`, 400);
//     }
//   }

//   /**
//    * Trouver le package via Google Play Product ID
//    */
//   async findPackageByProductId(productId) {
//     const packageRetrieve = await Package.findOne({ 
//       google_play_product_id: productId,
//       'platform_availability.google_play': true
//     });
    
//     if (!packageRetrieve) {
//       throw new AppError(`Package not found for product ID: ${productId}`, 404);
//     }
    
//     return packageRetrieve;
//   }

//   /**
//    * Créer une transaction Google Play
//    */
//   async createTransaction(userId, packageData, purchaseDetails, googleResponse, isSubscription = false) {
//     const transaction = new GooglePlayTransaction({
//       user: userId,
//       package: packageData._id,
//       purchaseToken: purchaseDetails.purchaseToken,
//       orderId: purchaseDetails.orderId || googleResponse.orderId,
//       productId: purchaseDetails.productId,
//       purchaseTime: new Date(parseInt(googleResponse.purchaseTimeMillis)),
//       expiryTime: googleResponse.expiryTimeMillis ? 
//         new Date(parseInt(googleResponse.expiryTimeMillis)) : null,
//       autoRenewing: googleResponse.autoRenewing || false,
//       status: 'verified',
//       subscriptionState: googleResponse.paymentState,
//       priceAmountMicros: googleResponse.priceAmountMicros,
//       priceCurrencyCode: googleResponse.priceCurrencyCode,
//       googleResponse: googleResponse
//     });

//     return await transaction.save();
//   }

//   /**
//    * Créer subscription après achat Google Play
//    */
//   async createSubscription(userId, packageData, transactionId, googleResponse) {
//     try {
//       const startDate = new Date(parseInt(googleResponse.purchaseTimeMillis));
      
//       // Si c'est un abonnement récurrent, utiliser expiryTime de Google
//       // Sinon utiliser la durée du package
//       let endDate;
//       if (googleResponse.expiryTimeMillis) {
//         endDate = new Date(parseInt(googleResponse.expiryTimeMillis));
//       } else {
//         endDate = new Date(startDate);
//         endDate.setDate(endDate.getDate() + packageData.duration);
//       }

//       const subscription = new Subscription({
//         user: userId,
//         package: packageData._id,
//         startDate: startDate,
//         endDate: endDate,
//         pricing: {
//           amount: this.convertMicrosToAmount(googleResponse.priceAmountMicros),
//           currency: googleResponse.priceCurrencyCode || 'USD'
//         },
//         status: 'active',
//         paymentReference: transactionId,
//         isGooglePlaySubscription: true,
//         autoRenewing: googleResponse.autoRenewing || false
//       });

//       return await subscription.save();
//     } catch (error) {
//       throw new AppError(`Subscription creation failed: ${error.message}`, 500);
//     }
//   }

//   /**
//    * Traiter les notifications webhook Google Play
//    */
//   async processWebhookNotification(notification) {
//     try {
//       const { subscriptionNotification, oneTimeProductNotification } = notification;
      
//       if (subscriptionNotification) {
//         await this.handleSubscriptionNotification(subscriptionNotification);
//       }
      
//       if (oneTimeProductNotification) {
//         await this.handleOneTimeProductNotification(oneTimeProductNotification);
//       }
//     } catch (error) {
//       throw new AppError(`Webhook processing failed: ${error.message}`, 500);
//     }
//   }

//   /**
//    * Gérer les notifications d'abonnement
//    */
//   async handleSubscriptionNotification(notification) {
//     const { subscriptionId, purchaseToken, notificationType } = notification;
    
//     // Récupérer la transaction existante
//     const transaction = await GooglePlayTransaction.findOne({ purchaseToken });
//     if (!transaction) {
//       console.warn(`Transaction not found for token: ${purchaseToken}`);
//       return;
//     }

//     // Ajouter l'événement webhook
//     transaction.webhookEvents.push({
//       event_type: this.getNotificationTypeName(notificationType),
//       processed: false
//     });

//     switch (notificationType) {
//       case 2: // SUBSCRIPTION_RENEWED
//         await this.handleSubscriptionRenewal(transaction, subscriptionId);
//         break;
        
//       case 3: // SUBSCRIPTION_CANCELED  
//         await this.handleSubscriptionCancellation(transaction);
//         break;
        
//       case 13: // SUBSCRIPTION_EXPIRED
//         await this.handleSubscriptionExpiration(transaction);
//         break;
        
//       case 12: // SUBSCRIPTION_REVOKED
//         await this.handleSubscriptionRevocation(transaction);
//         break;
        
//       case 4: // SUBSCRIPTION_PURCHASED (nouveau)
//       case 1: // SUBSCRIPTION_RECOVERED
//         await this.handleSubscriptionActivation(transaction, subscriptionId);
//         break;
//     }

//     await transaction.save();
//   }

//   /**
//    * Gérer les notifications produits uniques
//    */
//   async handleOneTimeProductNotification(notification) {
//     const { productId, purchaseToken, notificationType } = notification;
    
//     const transaction = await GooglePlayTransaction.findOne({ purchaseToken });
//     if (!transaction) return;

//     transaction.webhookEvents.push({
//       event_type: this.getOneTimeNotificationTypeName(notificationType),
//       processed: false
//     });

//     switch (notificationType) {
//       case 2: // ONE_TIME_PRODUCT_CANCELED
//         await this.cancelOneTimeProduct(transaction);
//         break;
//     }

//     await transaction.save();
//   }

//   /**
//    * Renouvellement d'abonnement
//    */
//   async handleSubscriptionRenewal(transaction, subscriptionId) {
//     // Récupérer les nouvelles données de Google
//     const googleResponse = await this.verifySubscription(
//       transaction.purchaseToken, 
//       subscriptionId
//     );

//     // Mettre à jour la transaction
//     transaction.status = 'renewed';
//     transaction.expiryTime = new Date(parseInt(googleResponse.expiryTimeMillis));
//     transaction.googleResponse = googleResponse;

//     // Prolonger la subscription existante
//     const subscription = await Subscription.findOne({
//       paymentReference: transaction._id,
//       status: 'active'
//     });

//     if (subscription) {
//       subscription.endDate = new Date(parseInt(googleResponse.expiryTimeMillis));
//       subscription.status = 'active';
//       await subscription.save();
//     }
//   }

//   /**
//    * Annulation d'abonnement
//    */
//   async handleSubscriptionCancellation(transaction) {
//     transaction.status = 'cancelled';
    
//     await Subscription.updateMany(
//       { paymentReference: transaction._id },
//       { status: 'cancelled' }
//     );
//   }

//   /**
//    * Expiration d'abonnement
//    */
//   async handleSubscriptionExpiration(transaction) {
//     transaction.status = 'expired';
    
//     await Subscription.updateMany(
//       { paymentReference: transaction._id },
//       { status: 'expired' }
//     );
//   }

//   /**
//    * Révocation d'abonnement
//    */
//   async handleSubscriptionRevocation(transaction) {
//     transaction.status = 'revoked';
    
//     await Subscription.updateMany(
//       { paymentReference: transaction._id },
//       { status: 'revoked' }
//     );
//   }

//   /**
//    * Activation d'abonnement
//    */
//   async handleSubscriptionActivation(transaction, subscriptionId) {
//     const googleResponse = await this.verifySubscription(
//       transaction.purchaseToken,
//       subscriptionId
//     );

//     transaction.status = 'verified';
//     transaction.expiryTime = new Date(parseInt(googleResponse.expiryTimeMillis));
//     transaction.googleResponse = googleResponse;

//     // Réactiver la subscription si nécessaire
//     await Subscription.updateMany(
//       { paymentReference: transaction._id },
//       { 
//         status: 'active',
//         endDate: new Date(parseInt(googleResponse.expiryTimeMillis))
//       }
//     );
//   }

//   /**
//    * Annuler produit unique
//    */
//   async cancelOneTimeProduct(transaction) {
//     transaction.status = 'cancelled';
    
//     await Subscription.updateMany(
//       { paymentReference: transaction._id },
//       { status: 'cancelled' }
//     );
//   }

//   /**
//    * Utilitaires
//    */
//   convertMicrosToAmount(priceAmountMicros) {
//     return priceAmountMicros ? (parseInt(priceAmountMicros) / 1000000) : 0;
//   }

//   getNotificationTypeName(type) {
//     const types = {
//       1: 'SUBSCRIPTION_RECOVERED',
//       2: 'SUBSCRIPTION_RENEWED', 
//       3: 'SUBSCRIPTION_CANCELED',
//       4: 'SUBSCRIPTION_PURCHASED',
//       12: 'SUBSCRIPTION_REVOKED',
//       13: 'SUBSCRIPTION_EXPIRED'
//     };
//     return types[type] || `UNKNOWN_${type}`;
//   }

//   getOneTimeNotificationTypeName(type) {
//     const types = {
//       1: 'ONE_TIME_PRODUCT_PURCHASED',
//       2: 'ONE_TIME_PRODUCT_CANCELED'
//     };
//     return types[type] || `UNKNOWN_${type}`;
//   }
// }

// module.exports = new GooglePlayService();