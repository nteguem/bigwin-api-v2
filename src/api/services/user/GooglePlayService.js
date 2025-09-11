const { google } = require('googleapis');
const GooglePlayTransaction = require('../../models/user/GooglePlayTransaction');
const Subscription = require('../../models/common/Subscription');
const Package = require('../../models/common/Package');

class GooglePlayService {
  constructor() {
    this.androidPublisher = null;
    this.initializeClient();
  }

  // Initialiser le client Google API
  initializeClient() {
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
      scopes: ['https://www.googleapis.com/auth/androidpublisher']
    });

    this.androidPublisher = google.androidpublisher({
      version: 'v3',
      auth
    });
  }

  // Valider un achat depuis Flutter
  async validatePurchase(purchaseToken, productId, userId, packageId) {
    try {
      // 1. Vérifier avec l'API Google
      const { data } = await this.androidPublisher.purchases.subscriptionsv2.get({
        packageName: process.env.GOOGLE_PLAY_PACKAGE_NAME,
        token: purchaseToken
      });

      if (!data) {
        throw new Error('Achat invalide');
      }

      // 2. Vérifier si déjà traité
      const existingTx = await GooglePlayTransaction.findOne({ purchaseToken });
      if (existingTx) {
        return { 
          success: true, 
          message: 'Achat déjà traité',
          subscription: await Subscription.findById(existingTx.subscription)
        };
      }

      // 3. Récupérer le package et calculer les dates
      const startDate = new Date(parseInt(data.startTime));
      const endDate = new Date(parseInt(data.expiryTime));

      // 4. Créer la transaction Google Play
      const googleTx = await GooglePlayTransaction.create({
        purchaseToken,
        orderId: data.latestOrderId,
        productId,
        user: userId,
        package: packageId,
        status: 'ACTIVE',
        startTime: startDate,
        expiryTime: endDate,
        priceAmountMicros: data.lineItems[0].productDetails.basePlanDetails.priceAmountMicros,
        priceCurrencyCode: data.lineItems[0].productDetails.basePlanDetails.priceCurrencyCode,
        autoRenewing: data.lineItems[0].autoRenewingPlan?.autoRenewEnabled || false,
        acknowledged: false
      });

      // 5. Créer la subscription
      const subscription = await Subscription.create({
        user: userId,
        package: packageId,
        startDate,
        endDate,
        pricing: {
          amount: googleTx.priceAmountMicros / 1000000,
          currency: googleTx.priceCurrencyCode
        },
        status: 'active',
        paymentProvider: 'GOOGLE_PLAY',
        paymentReference: data.latestOrderId,
        googlePlayTransaction: googleTx._id,
        autoRenewing: googleTx.autoRenewing
      });

      // 6. Mettre à jour la transaction avec l'ID de subscription
      googleTx.subscription = subscription._id;
      await googleTx.save();

      // 7. Acknowledge l'achat
      await this.acknowledgePurchase(purchaseToken);

      return {
        success: true,
        subscription,
        message: 'Abonnement activé avec succès'
      };

    } catch (error) {
      console.error('Erreur validation Google Play:', error);
      throw error;
    }
  }

  // Acknowledge un achat (obligatoire sous 3 jours)
  async acknowledgePurchase(purchaseToken) {
    try {
      await this.androidPublisher.purchases.subscriptions.acknowledge({
        packageName: process.env.GOOGLE_PLAY_PACKAGE_NAME,
        subscriptionId: purchaseToken,
        token: purchaseToken
      });

      // Mettre à jour le flag
      await GooglePlayTransaction.findOneAndUpdate(
        { purchaseToken },
        { acknowledged: true }
      );

      return true;
    } catch (error) {
      console.error('Erreur acknowledge:', error);
      return false;
    }
  }

  // Traiter une notification RTDN
  async processNotification(notification) {
    try {
      const { purchaseToken, subscriptionId } = notification.subscriptionNotification;
      const notificationType = notification.subscriptionNotification.notificationType;

      // Récupérer la transaction
      const googleTx = await GooglePlayTransaction.findOne({ purchaseToken });
      if (!googleTx) {
        console.log('Transaction non trouvée:', purchaseToken);
        return;
      }

      // Enregistrer la notification
      googleTx.lastNotificationType = notificationType;
      googleTx.lastNotificationTime = new Date();

      // Traiter selon le type
      switch (notificationType) {
        case 2: // SUBSCRIPTION_RENEWED
          await this.handleRenewal(googleTx);
          break;
        case 3: // SUBSCRIPTION_CANCELED
          await this.handleCancellation(googleTx);
          break;
        case 5: // SUBSCRIPTION_ON_HOLD
          await this.handleOnHold(googleTx);
          break;
        case 13: // SUBSCRIPTION_EXPIRED
          await this.handleExpiration(googleTx);
          break;
      }

      await googleTx.save();
    } catch (error) {
      console.error('Erreur traitement notification:', error);
    }
  }

  // Gérer le renouvellement
  async handleRenewal(googleTx) {
    // Récupérer les nouvelles infos depuis Google
    const { data } = await this.androidPublisher.purchases.subscriptionsv2.get({
      packageName: process.env.GOOGLE_PLAY_PACKAGE_NAME,
      token: googleTx.purchaseToken
    });

    const newExpiryTime = new Date(parseInt(data.expiryTime));

    // Mettre à jour la transaction
    googleTx.expiryTime = newExpiryTime;
    googleTx.status = 'ACTIVE';

    // Mettre à jour la subscription
    await Subscription.findByIdAndUpdate(
      googleTx.subscription,
      { 
        endDate: newExpiryTime,
        status: 'active'
      }
    );
  }

  // Gérer l'annulation
  async handleCancellation(googleTx) {
    googleTx.status = 'CANCELED';
    
    // L'abonnement reste actif jusqu'à expiration
    // Pas de changement sur la Subscription pour l'instant
  }

  // Gérer la suspension
  async handleOnHold(googleTx) {
    googleTx.status = 'ON_HOLD';
    
    await Subscription.findByIdAndUpdate(
      googleTx.subscription,
      { status: 'expired' } // Plus d'accès
    );
  }

  // Gérer l'expiration
  async handleExpiration(googleTx) {
    googleTx.status = 'EXPIRED';
    
    await Subscription.findByIdAndUpdate(
      googleTx.subscription,
      { status: 'expired' }
    );
  }

  // Vérifier le statut d'un abonnement
  async checkSubscriptionStatus(userId) {
    try {
      // Chercher une transaction active
      const googleTx = await GooglePlayTransaction.findOne({
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

      // Vérifier avec Google pour être sûr
      const { data } = await this.androidPublisher.purchases.subscriptionsv2.get({
        packageName: process.env.GOOGLE_PLAY_PACKAGE_NAME,
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
      console.error('Erreur vérification statut:', error);
      return {
        hasActiveSubscription: false,
        error: error.message
      };
    }
  }

  // Synchroniser un abonnement avec Google
  async syncSubscription(purchaseToken) {
    try {
      const { data } = await this.androidPublisher.purchases.subscriptionsv2.get({
        packageName: process.env.GOOGLE_PLAY_PACKAGE_NAME,
        token: purchaseToken
      });

      const googleTx = await GooglePlayTransaction.findOne({ purchaseToken });
      if (!googleTx) return;

      // Mettre à jour les infos
      googleTx.expiryTime = new Date(parseInt(data.expiryTime));
      googleTx.autoRenewing = data.lineItems[0].autoRenewingPlan?.autoRenewEnabled || false;
      
      // Mapper l'état Google vers notre état
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

      // Synchroniser la Subscription
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
      console.error('Erreur sync:', error);
      throw error;
    }
  }
}

module.exports = new GooglePlayService();