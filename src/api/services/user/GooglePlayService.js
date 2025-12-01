// services/user/GooglePlayService.js
const { google } = require('googleapis');
const GooglePlayTransaction = require('../../models/user/GooglePlayTransaction');
const Subscription = require('../../models/common/Subscription');
const Package = require('../../models/common/Package');
const Device = require('../../models/common/Device');
const notificationService = require('../common/notificationService');

class GooglePlayService {
  constructor() {
    // Cache des clients Google API par appId
    this.clients = new Map();
  }

  /**
   * Obtenir ou créer un client Google API pour une app
   * @param {Object} app - Document App depuis req.currentApp
   * @returns {Object} Client androidpublisher
   */
  getClient(app) {
    const appId = app.appId;
    
    // Vérifier le cache
    if (this.clients.has(appId)) {
      return this.clients.get(appId);
    }

    // Vérifier la configuration
    if (!app.googlePlay?.serviceAccountKeyPath) {
      throw new Error(`Google Play non configuré pour l'app ${appId}: serviceAccountKeyPath manquant`);
    }

    if (!app.googlePlay?.packageName) {
      throw new Error(`Google Play non configuré pour l'app ${appId}: packageName manquant`);
    }

    console.log(`[GooglePlay] Initialisation client pour app ${appId} avec keyPath: ${app.googlePlay.serviceAccountKeyPath}`);

    // Créer le client
    const auth = new google.auth.GoogleAuth({
      keyFile: app.googlePlay.serviceAccountKeyPath,
      scopes: ['https://www.googleapis.com/auth/androidpublisher']
    });

    const androidPublisher = google.androidpublisher({
      version: 'v3',
      auth
    });

    // Mettre en cache avec le packageName pour référence
    this.clients.set(appId, {
      androidPublisher,
      packageName: app.googlePlay.packageName
    });

    return this.clients.get(appId);
  }

  /**
   * Obtenir la configuration Google Play
   * @param {Object} app - Document App
   * @returns {Object} Configuration
   */
  getConfig(app) {
    return {
      packageName: app.googlePlay?.packageName,
      serviceAccountKeyPath: app.googlePlay?.serviceAccountKeyPath,
      enabled: !!(app.googlePlay?.packageName && app.googlePlay?.serviceAccountKeyPath)
    };
  }

  /**
   * Valider la configuration
   * @param {Object} app - Document App
   */
  validateConfig(app) {
    const config = this.getConfig(app);
    
    if (!config.enabled) {
      throw new Error('Google Play n\'est pas configuré pour cette application');
    }

    if (!config.packageName) {
      throw new Error('packageName Google Play non configuré');
    }

    if (!config.serviceAccountKeyPath) {
      throw new Error('serviceAccountKeyPath Google Play non configuré');
    }
  }

  /**
   * Envoyer une notification de paiement réussi Google Play
   * @param {String} appId - ID de l'application
   * @param {String} userId - ID de l'utilisateur
   * @param {Object} packageItem - Document Package
   * @param {Object} googleTx - Transaction Google Play
   */
  async sendPaymentSuccessNotification(appId, userId, packageItem, googleTx) {
    try {
      // Récupérer le device de l'utilisateur pour avoir son playerId
      const device = await Device.findOne({
        appId,
        user: userId,
        isActive: true,
        playerId: { $exists: true, $ne: null }
      }).sort({ lastActiveAt: -1 });

      if (!device || !device.playerId) {
        console.log(`[GooglePlay ${appId}] No playerId found for user ${userId}, skipping notification`);
        return;
      }

      const packageName = packageItem?.name?.fr || packageItem?.name?.en || 'Package Premium';
      const isOneTime = googleTx.purchaseType === 'ONE_TIME_PRODUCT';

      const notification = {
        headings: {
          en: "🎉 Payment Successful!",
          fr: "🎉 Paiement Réussi !"
        },
        contents: {
          en: `Your ${isOneTime ? 'purchase' : 'subscription'} to ${packageName} is now active! Enjoy your premium features.`,
          fr: `Votre ${isOneTime ? 'achat' : 'abonnement'} à ${packageName} est maintenant actif ! Profitez de vos avantages premium.`
        },
        data: {
          type: "payment_success",
          provider: "GOOGLE_PLAY",
          transaction_id: googleTx._id.toString(),
          order_id: googleTx.orderId,
          package_id: packageItem._id.toString(),
          purchase_type: googleTx.purchaseType,
          action: "view_subscription"
        },
        options: {
          android_accent_color: "00C853",
          small_icon: "ic_notification",
          large_icon: "ic_launcher",
          priority: 8
        }
      };

      await notificationService.sendToUsers(appId, [device.playerId], notification);

      console.log(`[GooglePlay ${appId}] Payment success notification sent to user ${userId}`);
    } catch (error) {
      console.error(`[GooglePlay ${appId}] Error sending payment success notification:`, error.message);
    }
  }

  /**
   * Envoyer une notification de paiement échoué/annulé Google Play
   * @param {String} appId - ID de l'application
   * @param {String} userId - ID de l'utilisateur
   * @param {Object} packageItem - Document Package (optionnel)
   * @param {String} reason - Raison de l'échec
   */
  async sendPaymentFailedNotification(appId, userId, packageItem, reason = 'canceled') {
    try {
      const device = await Device.findOne({
        appId,
        user: userId,
        isActive: true,
        playerId: { $exists: true, $ne: null }
      }).sort({ lastActiveAt: -1 });

      if (!device || !device.playerId) {
        console.log(`[GooglePlay ${appId}] No playerId found for user ${userId}, skipping notification`);
        return;
      }

      const packageName = packageItem?.name?.fr || packageItem?.name?.en || 'Package Premium';

      let headingEn, headingFr, contentEn, contentFr;

      if (reason === 'expired') {
        headingEn = "⏰ Subscription Expired";
        headingFr = "⏰ Abonnement Expiré";
        contentEn = `Your subscription to ${packageName} has expired. Renew now to continue enjoying premium features.`;
        contentFr = `Votre abonnement à ${packageName} a expiré. Renouvelez maintenant pour continuer à profiter des avantages premium.`;
      } else if (reason === 'on_hold') {
        headingEn = "⚠️ Payment Issue";
        headingFr = "⚠️ Problème de Paiement";
        contentEn = `Your subscription to ${packageName} is on hold due to a payment issue. Please update your payment method.`;
        contentFr = `Votre abonnement à ${packageName} est suspendu en raison d'un problème de paiement. Veuillez mettre à jour votre moyen de paiement.`;
      } else {
        headingEn = "❌ Subscription Canceled";
        headingFr = "❌ Abonnement Annulé";
        contentEn = `Your subscription to ${packageName} has been canceled. You can resubscribe anytime.`;
        contentFr = `Votre abonnement à ${packageName} a été annulé. Vous pouvez vous réabonner à tout moment.`;
      }

      const notification = {
        headings: { en: headingEn, fr: headingFr },
        contents: { en: contentEn, fr: contentFr },
        data: {
          type: "payment_issue",
          provider: "GOOGLE_PLAY",
          reason: reason,
          package_id: packageItem?._id?.toString(),
          action: "view_subscription"
        },
        options: {
          android_accent_color: "D32F2F",
          small_icon: "ic_notification",
          large_icon: "ic_launcher",
          priority: 7
        }
      };

      await notificationService.sendToUsers(appId, [device.playerId], notification);

      console.log(`[GooglePlay ${appId}] Payment ${reason} notification sent to user ${userId}`);
    } catch (error) {
      console.error(`[GooglePlay ${appId}] Error sending payment ${reason} notification:`, error.message);
    }
  }

  // ===== NOUVEAU : Valider un PRODUIT PONCTUEL depuis Flutter =====
  async validateOneTimePurchase(appId, app, purchaseToken, productId, userId, packageId) {
    try {
      console.log(`[GooglePlay ONE-TIME] Début validation pour app ${appId}:`, { purchaseToken, productId, packageId });
      
      // Valider la config et obtenir le client
      this.validateConfig(app);
      const { androidPublisher, packageName } = this.getClient(app);

      // 1. Vérifier avec l'API Google
      const { data } = await androidPublisher.purchases.products.get({
        packageName: packageName,
        productId: productId,
        token: purchaseToken
      });

      if (!data) {
        throw new Error('Réponse invalide de Google Play');
      }

      console.log(`[GooglePlay ONE-TIME] Réponse API Google:`, JSON.stringify(data, null, 2));

      // 2. Vérifier si déjà traité
      const existingTx = await GooglePlayTransaction.findOne({ appId, purchaseToken });
      if (existingTx) {
        console.log(`[GooglePlay ONE-TIME] Transaction déjà traitée:`, existingTx._id);
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

      // 3. Vérifier l'état de l'achat
      const purchaseState = data.purchaseState;

      console.log(`[GooglePlay ONE-TIME] Purchase state:`, purchaseState, typeof purchaseState);

      if (purchaseState === undefined) {
        console.log(`[GooglePlay ONE-TIME] ⚠️ purchaseState undefined, on continue pour debug`);
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

      // 4. Récupérer le package
      const packageItem = await Package.findOne({ _id: packageId, appId });
      if (!packageItem) {
        throw new Error('Package non trouvé: ' + packageId);
      }

      // 5. Parser les dates
      let startDate = new Date();
      let purchaseTime = data.purchaseTimeMillis 
        ? new Date(parseInt(data.purchaseTimeMillis)) 
        : startDate;
      
      let endDate = new Date(startDate.getTime() + (packageItem.duration * 24 * 60 * 60 * 1000));

      console.log(`[GooglePlay ONE-TIME] Dates calculées:`, { 
        startDate: startDate.toISOString(), 
        endDate: endDate.toISOString(),
        purchaseTime: purchaseTime.toISOString()
      });

      // 6. Extraire quantité et état de consommation
      let quantity = 1;
      let consumptionState = 'YET_TO_BE_CONSUMED';
      
      if (data.consumptionState === 1) {
        consumptionState = 'CONSUMED';
      }

      // 7. Prix depuis le package
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

      console.log(`[GooglePlay ONE-TIME] Prix final:`, { packagePrice, currency, quantity });

      // 8. Créer la transaction Google Play
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

      console.log(`[GooglePlay ONE-TIME] Transaction créée:`, googleTx._id);

      // 9. Créer la subscription
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

      console.log(`[GooglePlay ONE-TIME] Subscription créée:`, subscription._id);

      // 10. Mettre à jour la transaction avec l'ID de subscription
      googleTx.subscription = subscription._id;
      await googleTx.save();

      // 11. Acknowledge l'achat si pas déjà fait
      if (data.acknowledgementState !== 1) {
        this.acknowledgeOneTimePurchase(app, purchaseToken, productId).catch(error => {
          console.error(`[GooglePlay ONE-TIME] Erreur acknowledge (non bloquant):`, error.message);
        });
      }

      // 12. Envoyer notification de succès
      this.sendPaymentSuccessNotification(appId, userId, packageItem, googleTx).catch(error => {
        console.error(`[GooglePlay ONE-TIME] Erreur notification (non bloquant):`, error.message);
      });

      // 13. Retourner le résultat avec populate
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
      console.error(`[GooglePlay ONE-TIME] Erreur validation complète:`, error);
      
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

  // ===== Valider un ABONNEMENT depuis Flutter =====
  async validatePurchase(appId, app, purchaseToken, productId, userId, packageId) {
    try {
      console.log(`[GooglePlay SUB] Début validation pour app ${appId}:`, { purchaseToken, productId, packageId });
      
      // Valider la config et obtenir le client
      this.validateConfig(app);
      const { androidPublisher, packageName } = this.getClient(app);

      // 1. Vérifier avec l'API Google (subscriptions v2)
      const { data } = await androidPublisher.purchases.subscriptionsv2.get({
        packageName: packageName,
        token: purchaseToken
      });

      if (!data) {
        throw new Error('Réponse invalide de Google Play');
      }

      console.log(`[GooglePlay SUB] Réponse API Google:`, JSON.stringify(data, null, 2));

      // 2. Vérifier si déjà traité
      const existingTx = await GooglePlayTransaction.findOne({ appId, purchaseToken });
      if (existingTx) {
        console.log(`[GooglePlay SUB] Transaction déjà traitée:`, existingTx._id);
        const subscription = await Subscription.findById(existingTx.subscription)
          .populate('package');
        
        return { 
          success: true, 
          message: 'Achat déjà traité',
          data: {
            subscription,
            message: 'Abonnement déjà actif'
          }
        };
      }

      // 3. Récupérer le package
      const packageItem = await Package.findOne({ _id: packageId, appId });
      if (!packageItem) {
        throw new Error('Package non trouvé: ' + packageId);
      }

      // 4. Parser les dates
      let startDate = new Date();
      let expiryTime;
      let autoRenewing = false;

      if (data.lineItems && data.lineItems[0]) {
        if (data.lineItems[0].expiryTime) {
          expiryTime = new Date(data.lineItems[0].expiryTime);
        }
        if (data.lineItems[0].autoRenewingPlan) {
          autoRenewing = data.lineItems[0].autoRenewingPlan.autoRenewEnabled || false;
        }
      }

      if (!expiryTime) {
        expiryTime = new Date(startDate.getTime() + (packageItem.duration * 24 * 60 * 60 * 1000));
      }

      console.log(`[GooglePlay SUB] Dates:`, { startDate: startDate.toISOString(), expiryTime: expiryTime.toISOString() });

      // 5. Prix depuis le package
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

      // 6. Créer la transaction Google Play
      const googleTx = await GooglePlayTransaction.create({
        appId,
        purchaseToken,
        orderId: data.latestOrderId || `GP_SUB_${Date.now()}`,
        productId,
        user: userId,
        package: packageId,
        status: 'ACTIVE',
        startTime: startDate,
        expiryTime: expiryTime,
        purchaseTime: startDate,
        priceAmountMicros: packagePrice,
        priceCurrencyCode: currency,
        autoRenewing,
        acknowledged: data.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
        purchaseType: 'SUBSCRIPTION'
      });

      console.log(`[GooglePlay SUB] Transaction créée:`, googleTx._id);

      // 7. Créer la subscription
      const subscription = await Subscription.create({
        appId,
        user: userId,
        package: packageId,
        startDate,
        endDate: expiryTime,
        pricing: {
          amount: packagePrice,
          currency: currency
        },
        status: 'active',
        paymentProvider: 'GOOGLE_PLAY',
        paymentReference: googleTx.orderId,
        googlePlayTransaction: googleTx._id,
        autoRenewing
      });

      console.log(`[GooglePlay SUB] Subscription créée:`, subscription._id);

      // 8. Mettre à jour la transaction avec l'ID de subscription
      googleTx.subscription = subscription._id;
      await googleTx.save();

      // 9. Acknowledge l'achat si pas déjà fait
      if (data.acknowledgementState !== 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED') {
        this.acknowledgePurchase(app, purchaseToken).catch(error => {
          console.error(`[GooglePlay SUB] Erreur acknowledge (non bloquant):`, error.message);
        });
      }

      // 10. Envoyer notification de succès
      this.sendPaymentSuccessNotification(appId, userId, packageItem, googleTx).catch(error => {
        console.error(`[GooglePlay SUB] Erreur notification (non bloquant):`, error.message);
      });

      // 11. Retourner le résultat avec populate
      const populatedSubscription = await Subscription.findById(subscription._id)
        .populate('package');

      return {
        success: true,
        data: {
          subscription: populatedSubscription,
          message: 'Abonnement activé avec succès'
        }
      };

    } catch (error) {
      console.error(`[GooglePlay SUB] Erreur validation:`, error);
      throw new Error('Erreur de validation de l\'abonnement: ' + error.message);
    }
  }

  // ===== Acknowledge un abonnement =====
  async acknowledgePurchase(app, purchaseToken) {
    try {
      this.validateConfig(app);
      const { androidPublisher, packageName } = this.getClient(app);

      await androidPublisher.purchases.subscriptions.acknowledge({
        packageName: packageName,
        subscriptionId: purchaseToken,
        token: purchaseToken
      });

      await GooglePlayTransaction.findOneAndUpdate(
        { purchaseToken },
        { acknowledged: true }
      );

      console.log(`[GooglePlay] Acknowledge réussi:`, purchaseToken);
      return true;
    } catch (error) {
      console.error(`[GooglePlay] Erreur acknowledge:`, error);
      return false;
    }
  }

  // ===== Acknowledge un produit ponctuel =====
  async acknowledgeOneTimePurchase(app, purchaseToken, productId) {
    try {
      this.validateConfig(app);
      const { androidPublisher, packageName } = this.getClient(app);

      await androidPublisher.purchases.products.acknowledge({
        packageName: packageName,
        productId: productId,
        token: purchaseToken
      });

      await GooglePlayTransaction.findOneAndUpdate(
        { purchaseToken },
        { acknowledged: true }
      );

      console.log(`[GooglePlay ONE-TIME] Acknowledge réussi:`, purchaseToken);
      return true;
    } catch (error) {
      console.error(`[GooglePlay ONE-TIME] Erreur acknowledge:`, error);
      return false;
    }
  }

  // ===== Traiter une notification RTDN =====
  async processNotification(appId, app, notification) {
    try {
      // Gérer les notifications d'abonnement
      if (notification.subscriptionNotification) {
        const { purchaseToken } = notification.subscriptionNotification;
        const notificationType = notification.subscriptionNotification.notificationType;

        console.log(`[NOTIFICATION SUB] App: ${appId}, Type: ${notificationType}, Token: ${purchaseToken.substring(0, 20)}...`);

        const googleTx = await GooglePlayTransaction.findOne({ appId, purchaseToken });
        if (!googleTx) {
          console.log(`[NOTIFICATION SUB] Transaction non trouvée pour app ${appId}:`, purchaseToken);
          return;
        }

        googleTx.lastNotificationType = notificationType;
        googleTx.lastNotificationTime = new Date();

        switch (notificationType) {
          case 1: // SUBSCRIPTION_RECOVERED
            console.log('[NOTIFICATION SUB] → SUBSCRIPTION_RECOVERED');
            await this.handleRecovery(appId, app, googleTx);
            break;
          case 2: // SUBSCRIPTION_RENEWED
            console.log('[NOTIFICATION SUB] → SUBSCRIPTION_RENEWED');
            await this.handleRenewal(appId, app, googleTx);
            break;
          case 3: // SUBSCRIPTION_CANCELED
            console.log('[NOTIFICATION SUB] → SUBSCRIPTION_CANCELED');
            await this.handleCancellation(appId, googleTx);
            break;
          case 4: // SUBSCRIPTION_PURCHASED
            console.log('[NOTIFICATION SUB] → SUBSCRIPTION_PURCHASED');
            break;
          case 5: // SUBSCRIPTION_ON_HOLD (ancienne version)
          case 11: // SUBSCRIPTION_ON_HOLD (nouvelle version)
            console.log('[NOTIFICATION SUB] → SUBSCRIPTION_ON_HOLD');
            await this.handleOnHold(appId, googleTx);
            break;
          case 13: // SUBSCRIPTION_EXPIRED
            console.log('[NOTIFICATION SUB] → SUBSCRIPTION_EXPIRED');
            await this.handleExpiration(appId, googleTx);
            break;
          default:
            console.log(`[NOTIFICATION SUB] Type ${notificationType} non géré`);
        }

        await googleTx.save();
      }

      // Gérer les notifications de produits ponctuels
      if (notification.oneTimeProductNotification) {
        await this.handleOneTimeProductNotification(appId, notification);
      }

    } catch (error) {
      console.error('[NOTIFICATION] Erreur traitement:', error);
    }
  }

  // ===== Gérer les notifications de produits ponctuels =====
  async handleOneTimeProductNotification(appId, notification) {
    try {
      const { purchaseToken } = notification.oneTimeProductNotification;
      const notificationType = notification.oneTimeProductNotification.notificationType;

      console.log(`[NOTIFICATION ONE-TIME] App: ${appId}, Type: ${notificationType}, Token: ${purchaseToken.substring(0, 20)}...`);

      const googleTx = await GooglePlayTransaction.findOne({ appId, purchaseToken }).populate('package');
      if (!googleTx) {
        console.log(`[NOTIFICATION ONE-TIME] Transaction non trouvée pour app ${appId}:`, purchaseToken);
        return;
      }

      googleTx.lastNotificationType = notificationType;
      googleTx.lastNotificationTime = new Date();

      switch (notificationType) {
        case 1: // ONE_TIME_PRODUCT_PURCHASED
          console.log('[NOTIFICATION ONE-TIME] → ONE_TIME_PRODUCT_PURCHASED');
          break;

        case 2: // ONE_TIME_PRODUCT_CANCELED
          console.log('[NOTIFICATION ONE-TIME] → ONE_TIME_PRODUCT_CANCELED');
          googleTx.status = 'CANCELED';
          
          await Subscription.findByIdAndUpdate(
            googleTx.subscription,
            { status: 'expired' }
          );

          // Envoyer notification d'annulation
          const packageItem = await Package.findById(googleTx.package);
          this.sendPaymentFailedNotification(appId, googleTx.user, packageItem, 'canceled').catch(error => {
            console.error(`[NOTIFICATION ONE-TIME] Erreur notification (non bloquant):`, error.message);
          });
          break;

        default:
          console.log(`[NOTIFICATION ONE-TIME] Type ${notificationType} non géré`);
      }

      await googleTx.save();
      console.log('[NOTIFICATION ONE-TIME] Traitement terminé');

    } catch (error) {
      console.error('[NOTIFICATION ONE-TIME] Erreur:', error);
    }
  }

  // ===== Méthodes pour abonnements =====
  async handleRecovery(appId, app, googleTx) {
    try {
      console.log('[RECOVERY] Début récupération pour:', googleTx.purchaseToken);
      
      this.validateConfig(app);
      const { androidPublisher, packageName } = this.getClient(app);

      const { data } = await androidPublisher.purchases.subscriptionsv2.get({
        packageName: packageName,
        token: googleTx.purchaseToken
      });

      console.log('[RECOVERY] Réponse API Google:', JSON.stringify(data, null, 2));

      let newExpiryTime;
      
      if (data.lineItems && data.lineItems[0] && data.lineItems[0].expiryTime) {
        newExpiryTime = new Date(data.lineItems[0].expiryTime);
      } else if (data.expiryTime) {
        newExpiryTime = new Date(parseInt(data.expiryTime));
      } else {
        const packageData = await Package.findById(googleTx.package);
        if (packageData) {
          newExpiryTime = new Date(Date.now() + (packageData.duration * 24 * 60 * 60 * 1000));
        } else {
          newExpiryTime = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000));
        }
      }

      console.log('[RECOVERY] Nouvelle date expiration:', newExpiryTime.toISOString());

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

      // Envoyer notification de récupération
      const packageItem = await Package.findById(googleTx.package);
      this.sendPaymentSuccessNotification(appId, googleTx.user, packageItem, googleTx).catch(error => {
        console.error(`[RECOVERY] Erreur notification (non bloquant):`, error.message);
      });

      console.log('[RECOVERY] Abonnement récupéré avec succès');
      
    } catch (error) {
      console.error('[RECOVERY] Erreur:', error);
      throw error;
    }
  }

  async handleRenewal(appId, app, googleTx) {
    try {
      console.log('[RENEWAL] Début pour:', googleTx.purchaseToken);
      
      this.validateConfig(app);
      const { androidPublisher, packageName } = this.getClient(app);

      const { data } = await androidPublisher.purchases.subscriptionsv2.get({
        packageName: packageName,
        token: googleTx.purchaseToken
      });

      console.log('[RENEWAL] Réponse API Google:', JSON.stringify(data, null, 2));

      let newExpiryTime;
      
      if (data.lineItems && data.lineItems.length > 0 && data.lineItems[0].expiryTime) {
        newExpiryTime = new Date(data.lineItems[0].expiryTime);
      } else if (data.expiryTime) {
        newExpiryTime = new Date(parseInt(data.expiryTime));
      } else {
        const packageData = await Package.findById(googleTx.package);
        if (packageData) {
          newExpiryTime = new Date(Date.now() + (packageData.duration * 24 * 60 * 60 * 1000));
        } else {
          newExpiryTime = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000));
        }
      }

      if (isNaN(newExpiryTime.getTime()) || newExpiryTime.getFullYear() < 2020) {
        const packageData = await Package.findById(googleTx.package);
        if (packageData) {
          newExpiryTime = new Date(Date.now() + (packageData.duration * 24 * 60 * 60 * 1000));
        } else {
          newExpiryTime = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000));
        }
      }

      console.log('[RENEWAL] Nouvelle date expiration:', newExpiryTime.toISOString());

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

      // Envoyer notification de renouvellement
      const packageItem = await Package.findById(googleTx.package);
      this.sendPaymentSuccessNotification(appId, googleTx.user, packageItem, googleTx).catch(error => {
        console.error(`[RENEWAL] Erreur notification (non bloquant):`, error.message);
      });

      console.log('[RENEWAL] Renouvellement traité avec succès');
      
    } catch (error) {
      console.error('[RENEWAL] Erreur:', error);
      throw error;
    }
  }

  async handleCancellation(appId, googleTx) {
    try {
      console.log('[CANCELLATION] Début pour:', googleTx.purchaseToken);
      
      googleTx.status = 'CANCELED';
      await googleTx.save();

      // Envoyer notification d'annulation
      const packageItem = await Package.findById(googleTx.package);
      this.sendPaymentFailedNotification(appId, googleTx.user, packageItem, 'canceled').catch(error => {
        console.error(`[CANCELLATION] Erreur notification (non bloquant):`, error.message);
      });
      
      console.log('[CANCELLATION] Traité - abonnement reste actif jusqu\'à expiration');
      
    } catch (error) {
      console.error('[CANCELLATION] Erreur:', error);
      throw error;
    }
  }

  async handleOnHold(appId, googleTx) {
    try {
      console.log('[ON_HOLD] Début pour:', googleTx.purchaseToken);
      
      googleTx.status = 'ON_HOLD';
      await googleTx.save();
      
      await Subscription.findByIdAndUpdate(
        googleTx.subscription,
        { status: 'expired' }
      );

      // Envoyer notification de suspension
      const packageItem = await Package.findById(googleTx.package);
      this.sendPaymentFailedNotification(appId, googleTx.user, packageItem, 'on_hold').catch(error => {
        console.error(`[ON_HOLD] Erreur notification (non bloquant):`, error.message);
      });

      console.log('[ON_HOLD] Traité - accès suspendu');
      
    } catch (error) {
      console.error('[ON_HOLD] Erreur:', error);
      throw error;
    }
  }

  async handleExpiration(appId, googleTx) {
    try {
      console.log('[EXPIRATION] Début pour:', googleTx.purchaseToken);
      
      googleTx.status = 'EXPIRED';
      await googleTx.save();
      
      await Subscription.findByIdAndUpdate(
        googleTx.subscription,
        { status: 'expired' }
      );

      // Envoyer notification d'expiration
      const packageItem = await Package.findById(googleTx.package);
      this.sendPaymentFailedNotification(appId, googleTx.user, packageItem, 'expired').catch(error => {
        console.error(`[EXPIRATION] Erreur notification (non bloquant):`, error.message);
      });

      console.log('[EXPIRATION] Traité');
      
    } catch (error) {
      console.error('[EXPIRATION] Erreur:', error);
      throw error;
    }
  }

  async checkSubscriptionStatus(appId, app, userId) {
    try {
      this.validateConfig(app);
      const { androidPublisher, packageName } = this.getClient(app);

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

      const { data } = await androidPublisher.purchases.subscriptionsv2.get({
        packageName: packageName,
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
      console.error('[GooglePlay] Erreur vérification statut:', error);
      return {
        hasActiveSubscription: false,
        error: error.message
      };
    }
  }

  async syncSubscription(app, purchaseToken) {
    try {
      this.validateConfig(app);
      const { androidPublisher, packageName } = this.getClient(app);

      const { data } = await androidPublisher.purchases.subscriptionsv2.get({
        packageName: packageName,
        token: purchaseToken
      });

      const googleTx = await GooglePlayTransaction.findOne({ purchaseToken });
      if (!googleTx) return null;

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

      return googleTx;
    } catch (error) {
      console.error('[GooglePlay] Erreur sync:', error);
      throw error;
    }
  }
}

module.exports = new GooglePlayService();