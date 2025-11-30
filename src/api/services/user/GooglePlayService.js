// services/user/GooglePlayService.js

const { google } = require('googleapis');
const GooglePlayTransaction = require('../../models/user/GooglePlayTransaction');
const Subscription = require('../../models/common/Subscription');
const Package = require('../../models/common/Package');

class GooglePlayService {
  constructor() {
    this.clientCache = new Map();
    this.cacheMaxAge = 24 * 60 * 60 * 1000; // 24 heures
    this.cacheTimestamps = new Map();
  }

  /**
   * Obtenir le client Google Play pour une app spécifique (avec cache)
   */
  async getClientForApp(appId) {
    const now = Date.now();
    
    if (this.clientCache.has(appId)) {
      const cacheTime = this.cacheTimestamps.get(appId);
      
      if (now - cacheTime < this.cacheMaxAge) {
        return this.clientCache.get(appId);
      }
      
      this.clientCache.delete(appId);
      this.cacheTimestamps.delete(appId);
    }

    const App = require('../../models/common/App');
    const app = await App.findOne({ appId, isActive: true });
    
    if (!app) {
      throw new Error(`Application ${appId} non trouvée ou inactive`);
    }

    const googleConfig = app.getGooglePlayConfig();
    
    if (!googleConfig.packageName || !googleConfig.serviceAccountKeyPath) {
      throw new Error(`Configuration Google Play manquante pour l'app ${appId}`);
    }

    const auth = new google.auth.GoogleAuth({
      keyFile: googleConfig.serviceAccountKeyPath,
      scopes: ['https://www.googleapis.com/auth/androidpublisher']
    });

    const client = {
      androidPublisher: google.androidpublisher({
        version: 'v3',
        auth
      }),
      packageName: googleConfig.packageName
    };

    this.clientCache.set(appId, client);
    this.cacheTimestamps.set(appId, now);
    
    console.log(`[GooglePlay] Client créé et mis en cache pour l'app: ${appId}`);
    
    return client;
  }

  /**
   * Invalider le cache (si config change)
   */
  clearConfigCache(appId = null) {
    if (appId) {
      this.clientCache.delete(appId);
      this.cacheTimestamps.delete(appId);
      console.log(`[GooglePlay] Cache invalidé pour l'app: ${appId}`);
    } else {
      this.clientCache.clear();
      this.cacheTimestamps.clear();
      console.log('[GooglePlay] Cache global invalidé');
    }
  }

  /**
   * Valider un produit ponctuel depuis Flutter
   */
  async validateOneTimePurchase(appId, purchaseToken, productId, userId, packageId) {
    try {
      console.log(`[GooglePlay ONE-TIME] [${appId}] Début validation:`, { purchaseToken, productId, packageId });
      
      const client = await this.getClientForApp(appId);
      
      const { data } = await client.androidPublisher.purchases.products.get({
        packageName: client.packageName,
        productId: productId,
        token: purchaseToken
      });

      if (!data) {
        throw new Error('Réponse invalide de Google Play');
      }

      const existingTx = await GooglePlayTransaction.findOne({ appId, purchaseToken });
      if (existingTx) {
        console.log(`[GooglePlay ONE-TIME] [${appId}] Transaction déjà traitée:`, existingTx._id);
        const subscription = await Subscription.findById(existingTx.subscription)
          .populate('package');
        
        return { 
          success: true, 
          message: 'Achat déjà traité',
          data: {
            subscription,
            message: 'Produit déjà actif'
          }
        };
      }

      const purchaseState = data.purchaseState;

      console.log(`[GooglePlay ONE-TIME] [${appId}] Purchase state:`, purchaseState, typeof purchaseState);

      if (purchaseState === undefined) {
        console.log(`[GooglePlay ONE-TIME] [${appId}] ⚠️ purchaseState undefined, on continue`);
      } else {
        if (purchaseState === 2) {
          throw new Error('Paiement en attente. Veuillez patienter.');
        }
        
        if (purchaseState === 1) {
          throw new Error('Achat annulé.');
        }
        
        if (purchaseState !== 0) {
          throw new Error(`État d'achat invalide: ${purchaseState}`);
        }
      }

      const packageItem = await Package.findOne({ _id: packageId, appId });
      if (!packageItem) {
        throw new Error('Package non trouvé: ' + packageId);
      }

      let startDate = new Date();
      let purchaseTime = data.purchaseTimeMillis 
        ? new Date(parseInt(data.purchaseTimeMillis)) 
        : startDate;
      
      let endDate = new Date(startDate.getTime() + (packageItem.duration * 24 * 60 * 60 * 1000));

      console.log(`[GooglePlay ONE-TIME] [${appId}] Dates calculées:`, { 
        startDate: startDate.toISOString(), 
        endDate: endDate.toISOString(),
        purchaseTime: purchaseTime.toISOString()
      });

      let quantity = 1;
      let consumptionState = 'YET_TO_BE_CONSUMED';
      
      if (data.consumptionState === 1) {
        consumptionState = 'CONSUMED';
      }

      console.log(`[GooglePlay ONE-TIME] [${appId}] Quantity:`, quantity, 'Consumption:', consumptionState);

      let packagePrice = null;
      let currency = null;
      
      const currencyPreference = ['EUR', 'USD', 'XAF', 'XOF', 'GMD', 'CDF', 'GNF'];
      
      for (const curr of currencyPreference) {
        if (packageItem.pricing.has(curr)) {
          packagePrice = packageItem.pricing.get(curr);
          currency = curr;
          break;
        }
      }
      
      if (!packagePrice && packageItem.pricing.size > 0) {
        const firstCurrency = Array.from(packageItem.pricing.keys())[0];
        packagePrice = packageItem.pricing.get(firstCurrency);
        currency = firstCurrency;
      }
      
      if (!packagePrice) {
        packagePrice = 10;
        currency = 'EUR';
      }

      console.log(`[GooglePlay ONE-TIME] [${appId}] Prix final:`, { 
        priceAmountMicros: packagePrice, 
        priceCurrencyCode: currency,
        quantity
      });

      const googleTx = await GooglePlayTransaction.create({
        appId,
        purchaseToken,
        orderId: data.orderId || `GP_OT_${Date.now()}`,
        productId,
        user: userId,
        package: packageId,
        status: 'ACTIVE',
        startTime: startDate,
        expiryTime: endDate,
        purchaseTime: purchaseTime,
        priceAmountMicros: packagePrice,
        priceCurrencyCode: currency,
        autoRenewing: false,
        acknowledged: data.acknowledgementState === 1,
        purchaseType: 'ONE_TIME_PRODUCT',
        consumptionState,
        quantity,
        refundableQuantity: quantity
      });

      console.log(`[GooglePlay ONE-TIME] [${appId}] Transaction créée:`, googleTx._id);

      const subscription = await Subscription.create({
        appId,
        user: userId,
        package: packageId,
        startDate,
        endDate,
        pricing: {
          amount: packagePrice,
          currency: currency
        },
        status: 'active',
        paymentProvider: 'GOOGLE_PLAY',
        paymentReference: googleTx.orderId,
        googlePlayTransaction: googleTx._id,
        autoRenewing: false
      });

      console.log(`[GooglePlay ONE-TIME] [${appId}] Subscription créée:`, subscription._id);

      googleTx.subscription = subscription._id;
      await googleTx.save();

      if (data.acknowledgementState !== 1) {
        this.acknowledgeOneTimePurchase(appId, purchaseToken, productId).catch(error => {
          console.error(`[GooglePlay ONE-TIME] [${appId}] Erreur acknowledge:`, error.message);
        });
      }

      const populatedSubscription = await Subscription.findById(subscription._id)
        .populate('package');

      return {
        success: true,
        data: {
          subscription: populatedSubscription,
          message: 'Produit activé avec succès'
        }
      };

    } catch (error) {
      console.error(`[GooglePlay ONE-TIME] [${appId}] Erreur validation complète:`, error);
      
      let errorMessage = 'Erreur de validation du produit: ';
      if (error.response && error.response.data) {
        errorMessage += JSON.stringify(error.response.data);
      } else if (error.message) {
        errorMessage += error.message;
      } else {
        errorMessage += 'Erreur inconnue';
      }
      
      throw new Error(errorMessage);
    }
  }

  /**
   * Acknowledge un abonnement
   */
  async acknowledgePurchase(appId, purchaseToken) {
    try {
      const client = await this.getClientForApp(appId);
      
      await client.androidPublisher.purchases.subscriptions.acknowledge({
        packageName: client.packageName,
        subscriptionId: purchaseToken,
        token: purchaseToken
      });

      await GooglePlayTransaction.findOneAndUpdate(
        { appId, purchaseToken },
        { acknowledged: true }
      );

      console.log(`[GooglePlay] [${appId}] Acknowledge réussi:`, purchaseToken);
      return true;
    } catch (error) {
      console.error(`[GooglePlay] [${appId}] Erreur acknowledge:`, error);
      return false;
    }
  }

  /**
   * Acknowledge un produit ponctuel
   */
  async acknowledgeOneTimePurchase(appId, purchaseToken, productId) {
    try {
      const client = await this.getClientForApp(appId);
      
      await client.androidPublisher.purchases.products.acknowledge({
        packageName: client.packageName,
        productId: productId,
        token: purchaseToken
      });

      await GooglePlayTransaction.findOneAndUpdate(
        { appId, purchaseToken },
        { acknowledged: true }
      );

      console.log(`[GooglePlay ONE-TIME] [${appId}] Acknowledge réussi:`, purchaseToken);
      return true;
    } catch (error) {
      console.error(`[GooglePlay ONE-TIME] [${appId}] Erreur acknowledge:`, error);
      return false;
    }
  }

  /**
   * Traiter une notification RTDN
   */
  async processNotification(appId, notification) {
    try {
      if (notification.subscriptionNotification) {
        const { purchaseToken, subscriptionId } = notification.subscriptionNotification;
        const notificationType = notification.subscriptionNotification.notificationType;

        console.log(`[NOTIFICATION SUB] [${appId}] Type: ${notificationType}, Token: ${purchaseToken.substring(0, 20)}...`);

        const googleTx = await GooglePlayTransaction.findOne({ appId, purchaseToken });
        if (!googleTx) {
          console.log(`[NOTIFICATION SUB] [${appId}] Transaction non trouvée:`, purchaseToken);
          return;
        }

        googleTx.lastNotificationType = notificationType;
        googleTx.lastNotificationTime = new Date();

        switch (notificationType) {
          case 1:
            console.log(`[NOTIFICATION SUB] [${appId}] → SUBSCRIPTION_RECOVERED`);
            await this.handleRecovery(appId, googleTx);
            break;
          case 2:
            console.log(`[NOTIFICATION SUB] [${appId}] → SUBSCRIPTION_RENEWED`);
            await this.handleRenewal(appId, googleTx);
            break;
          case 3:
            console.log(`[NOTIFICATION SUB] [${appId}] → SUBSCRIPTION_CANCELED`);
            await this.handleCancellation(googleTx);
            break;
          case 4:
            console.log(`[NOTIFICATION SUB] [${appId}] → SUBSCRIPTION_PURCHASED`);
            break;
          case 5:
          case 11:
            console.log(`[NOTIFICATION SUB] [${appId}] → SUBSCRIPTION_ON_HOLD`);
            await this.handleOnHold(googleTx);
            break;
          case 13:
            console.log(`[NOTIFICATION SUB] [${appId}] → SUBSCRIPTION_EXPIRED`);
            await this.handleExpiration(googleTx);
            break;
          default:
            console.log(`[NOTIFICATION SUB] [${appId}] Type ${notificationType} non géré`);
        }

        await googleTx.save();
      }

      if (notification.oneTimeProductNotification) {
        await this.handleOneTimeProductNotification(appId, notification);
      }

    } catch (error) {
      console.error(`[NOTIFICATION] [${appId}] Erreur traitement notification:`, error);
    }
  }

  /**
   * Gérer les notifications de produits ponctuels
   */
  async handleOneTimeProductNotification(appId, notification) {
    try {
      const { purchaseToken } = notification.oneTimeProductNotification;
      const notificationType = notification.oneTimeProductNotification.notificationType;

      console.log(`[NOTIFICATION ONE-TIME] [${appId}] Type: ${notificationType}, Token: ${purchaseToken.substring(0, 20)}...`);

      const googleTx = await GooglePlayTransaction.findOne({ appId, purchaseToken });
      if (!googleTx) {
        console.log(`[NOTIFICATION ONE-TIME] [${appId}] Transaction non trouvée:`, purchaseToken);
        return;
      }

      googleTx.lastNotificationType = notificationType;
      googleTx.lastNotificationTime = new Date();

      switch (notificationType) {
        case 1:
          console.log(`[NOTIFICATION ONE-TIME] [${appId}] → ONE_TIME_PRODUCT_PURCHASED`);
          break;

        case 2:
          console.log(`[NOTIFICATION ONE-TIME] [${appId}] → ONE_TIME_PRODUCT_CANCELED`);
          googleTx.status = 'CANCELED';
          
          await Subscription.findByIdAndUpdate(
            googleTx.subscription,
            { status: 'expired' }
          );
          break;

        default:
          console.log(`[NOTIFICATION ONE-TIME] [${appId}] Type ${notificationType} non géré`);
      }

      await googleTx.save();
      console.log(`[NOTIFICATION ONE-TIME] [${appId}] Traitement terminé`);

    } catch (error) {
      console.error(`[NOTIFICATION ONE-TIME] [${appId}] Erreur:`, error);
    }
  }

  /**
   * Gérer la récupération d'un abonnement
   */
  async handleRecovery(appId, googleTx) {
    try {
      console.log(`[RECOVERY] [${appId}] Début récupération pour:`, googleTx.purchaseToken);
      
      const client = await this.getClientForApp(appId);
      
      const { data } = await client.androidPublisher.purchases.subscriptionsv2.get({
        packageName: client.packageName,
        token: googleTx.purchaseToken
      });

      console.log(`[RECOVERY] [${appId}] Réponse API Google:`, JSON.stringify(data, null, 2));

      let newExpiryTime;
      
      if (data.lineItems && data.lineItems[0] && data.lineItems[0].expiryTime) {
        newExpiryTime = new Date(data.lineItems[0].expiryTime);
        console.log(`[RECOVERY] [${appId}] Date trouvée dans lineItems[0].expiryTime`);
      } else if (data.expiryTime) {
        const expiryTimestamp = parseInt(data.expiryTime);
        newExpiryTime = new Date(expiryTimestamp);
        console.log(`[RECOVERY] [${appId}] Date trouvée dans data.expiryTime`);
      } else {
        const packageData = await Package.findById(googleTx.package);
        if (packageData) {
          newExpiryTime = new Date(Date.now() + (packageData.duration * 24 * 60 * 60 * 1000));
        } else {
          newExpiryTime = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000));
        }
        console.log(`[RECOVERY] [${appId}] Date calculée avec durée package`);
      }

      console.log(`[RECOVERY] [${appId}] Nouvelle date expiration:`, newExpiryTime.toISOString());

      googleTx.status = 'ACTIVE';
      googleTx.expiryTime = newExpiryTime;
      await googleTx.save();

      await Subscription.findByIdAndUpdate(
        googleTx.subscription,
        { 
          status: 'active',
          endDate: newExpiryTime
        }
      );

      console.log(`[RECOVERY] [${appId}] Abonnement récupéré avec succès`);
      
    } catch (error) {
      console.error(`[RECOVERY] [${appId}] Erreur handleRecovery:`, error);
      throw error;
    }
  }

  /**
   * Gérer le renouvellement d'un abonnement
   */
  async handleRenewal(appId, googleTx) {
    try {
      console.log(`[RENEWAL] [${appId}] Début handleRenewal pour:`, googleTx.purchaseToken);
      
      const client = await this.getClientForApp(appId);
      
      const { data } = await client.androidPublisher.purchases.subscriptionsv2.get({
        packageName: client.packageName,
        token: googleTx.purchaseToken
      });

      console.log(`[RENEWAL] [${appId}] Réponse API Google:`, JSON.stringify(data, null, 2));

      let newExpiryTime;
      
      if (data.lineItems && data.lineItems.length > 0 && data.lineItems[0].expiryTime) {
        newExpiryTime = new Date(data.lineItems[0].expiryTime);
        console.log(`[RENEWAL] [${appId}] Date trouvée dans lineItems[0].expiryTime`);
      } else if (data.expiryTime) {
        const expiryTimestamp = parseInt(data.expiryTime);
        newExpiryTime = new Date(expiryTimestamp);
        console.log(`[RENEWAL] [${appId}] Date trouvée dans data.expiryTime`);
      } else {
        console.log(`[RENEWAL] [${appId}] Aucune date Google, calcul avec durée package`);
        const packageData = await Package.findById(googleTx.package);
        if (packageData) {
          newExpiryTime = new Date(Date.now() + (packageData.duration * 24 * 60 * 60 * 1000));
        } else {
          newExpiryTime = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000));
        }
      }

      if (isNaN(newExpiryTime.getTime()) || newExpiryTime.getFullYear() < 2020) {
        console.log(`[RENEWAL] [${appId}] Date invalide, fallback sur durée package`);
        const packageData = await Package.findById(googleTx.package);
        if (packageData) {
          newExpiryTime = new Date(Date.now() + (packageData.duration * 24 * 60 * 60 * 1000));
        } else {
          newExpiryTime = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000));
        }
      }

      console.log(`[RENEWAL] [${appId}] Nouvelle date expiration:`, newExpiryTime.toISOString());

      let autoRenewing = false;
      if (data.lineItems && data.lineItems[0] && data.lineItems[0].autoRenewingPlan) {
        autoRenewing = data.lineItems[0].autoRenewingPlan.autoRenewEnabled;
      }

      googleTx.expiryTime = newExpiryTime;
      googleTx.status = 'ACTIVE';
      googleTx.autoRenewing = autoRenewing;
      await googleTx.save();

      await Subscription.findByIdAndUpdate(
        googleTx.subscription,
        { 
          endDate: newExpiryTime,
          status: 'active',
          autoRenewing: autoRenewing
        }
      );

      console.log(`[RENEWAL] [${appId}] Renouvellement traité avec succès`);
      
    } catch (error) {
      console.error(`[RENEWAL] [${appId}] Erreur handleRenewal:`, error);
      throw error;
    }
  }

  /**
   * Gérer l'annulation d'un abonnement
   */
  async handleCancellation(googleTx) {
    try {
      console.log('[CANCELLATION] Début annulation pour:', googleTx.purchaseToken);
      
      googleTx.status = 'CANCELED';
      await googleTx.save();
      
      console.log('[CANCELLATION] Annulation traitée - abonnement reste actif jusqu\'à expiration');
      
    } catch (error) {
      console.error('[CANCELLATION] Erreur handleCancellation:', error);
      throw error;
    }
  }

  /**
   * Gérer la suspension d'un abonnement
   */
  async handleOnHold(googleTx) {
    try {
      console.log('[ON_HOLD] Début suspension pour:', googleTx.purchaseToken);
      
      googleTx.status = 'ON_HOLD';
      await googleTx.save();
      
      await Subscription.findByIdAndUpdate(
        googleTx.subscription,
        { status: 'expired' }
      );

      console.log('[ON_HOLD] Suspension traitée - accès suspendu');
      
    } catch (error) {
      console.error('[ON_HOLD] Erreur handleOnHold:', error);
      throw error;
    }
  }

  /**
   * Gérer l'expiration d'un abonnement
   */
  async handleExpiration(googleTx) {
    try {
      console.log('[EXPIRATION] Début expiration pour:', googleTx.purchaseToken);
      
      googleTx.status = 'EXPIRED';
      await googleTx.save();
      
      await Subscription.findByIdAndUpdate(
        googleTx.subscription,
        { status: 'expired' }
      );

      console.log('[EXPIRATION] Expiration traitée');
      
    } catch (error) {
      console.error('[EXPIRATION] Erreur handleExpiration:', error);
      throw error;
    }
  }

  /**
   * Vérifier le statut d'un abonnement
   */
  async checkSubscriptionStatus(appId, userId) {
    try {
      const googleTx = await GooglePlayTransaction.findOne({
        appId,
        user: userId,
        status: { $in: ['ACTIVE', 'CANCELED'] },
        expiryTime: { $gt: new Date() }
      }).populate('subscription');

      if (!googleTx) {
        return {
          hasActiveSubscription: false,
          message: 'Aucun abonnement Google Play actif'
        };
      }

      const client = await this.getClientForApp(appId);
      
      const { data } = await client.androidPublisher.purchases.subscriptionsv2.get({
        packageName: client.packageName,
        token: googleTx.purchaseToken
      });

      const isActive = data.subscriptionState === 'SUBSCRIPTION_STATE_ACTIVE';

      return {
        hasActiveSubscription: isActive,
        subscription: googleTx.subscription,
        expiryDate: googleTx.expiryTime,
        autoRenewing: googleTx.autoRenewing
      };

    } catch (error) {
      console.error(`[GooglePlay] [${appId}] Erreur vérification statut:`, error);
      return {
        hasActiveSubscription: false,
        error: error.message
      };
    }
  }

  /**
   * Synchroniser un abonnement avec Google Play
   */
  async syncSubscription(appId, purchaseToken) {
    try {
      const client = await this.getClientForApp(appId);
      
      const { data } = await client.androidPublisher.purchases.subscriptionsv2.get({
        packageName: client.packageName,
        token: purchaseToken
      });

      const googleTx = await GooglePlayTransaction.findOne({ appId, purchaseToken });
      if (!googleTx) return;

      if (data.lineItems && data.lineItems[0] && data.lineItems[0].expiryTime) {
        googleTx.expiryTime = new Date(data.lineItems[0].expiryTime);
        googleTx.autoRenewing = data.lineItems[0].autoRenewingPlan?.autoRenewEnabled || false;
      } else if (data.expiryTime) {
        googleTx.expiryTime = new Date(parseInt(data.expiryTime));
        googleTx.autoRenewing = data.autoRenewing || false;
      }
      
      const stateMap = {
        'SUBSCRIPTION_STATE_ACTIVE': 'ACTIVE',
        'SUBSCRIPTION_STATE_CANCELED': 'CANCELED',
        'SUBSCRIPTION_STATE_IN_GRACE_PERIOD': 'ACTIVE',
        'SUBSCRIPTION_STATE_ON_HOLD': 'ON_HOLD',
        'SUBSCRIPTION_STATE_PAUSED': 'PAUSED',
        'SUBSCRIPTION_STATE_EXPIRED': 'EXPIRED'
      };

      googleTx.status = stateMap[data.subscriptionState] || 'EXPIRED';
      await googleTx.save();

      const subStatus = ['ACTIVE', 'CANCELED'].includes(googleTx.status) ? 'active' : 'expired';
      await Subscription.findByIdAndUpdate(
        googleTx.subscription,
        { 
          status: subStatus,
          endDate: googleTx.expiryTime
        }
      );

      console.log(`[GooglePlay] [${appId}] Sync réussi:`, purchaseToken);
      return googleTx;
    } catch (error) {
      console.error(`[GooglePlay] [${appId}] Erreur sync:`, error);
      throw error;
    }
  }
}

module.exports = new GooglePlayService();