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
 // Remplacer la méthode validatePurchase dans GooglePlayService.js par celle-ci :

async validatePurchase(purchaseToken, productId, userId, packageId) {
  try {
    console.log('[GooglePlay] Début validation:', { purchaseToken, productId, packageId });
    
    // 1. Vérifier avec l'API Google
    const { data } = await this.androidPublisher.purchases.subscriptionsv2.get({
      packageName: process.env.GOOGLE_PLAY_PACKAGE_NAME,
      token: purchaseToken
    });

    console.log('[GooglePlay] Réponse API Google:', JSON.stringify(data, null, 2));

    if (!data) {
      throw new Error('Réponse invalide de Google Play');
    }

    // 2. Vérifier si déjà traité
    const existingTx = await GooglePlayTransaction.findOne({ purchaseToken });
    if (existingTx) {
      console.log('[GooglePlay] Transaction déjà traitée:', existingTx._id);
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
    const package = await Package.findById(packageId);
    if (!package) {
      throw new Error('Package non trouvé: ' + packageId);
    }

    // 4. Parser les dates
    let startDate, endDate;
    
    // startTime peut être en millisecondes (string) ou en secondes
    if (data.startTime) {
      startDate = new Date(parseInt(data.startTime));
      // Vérifier si la date est valide
      if (isNaN(startDate.getTime())) {
        startDate = new Date();
      }
    } else {
      startDate = new Date();
    }

    // expiryTime peut être en millisecondes (string) ou en secondes
    if (data.expiryTime) {
      endDate = new Date(parseInt(data.expiryTime));
      // Vérifier si la date est valide
      if (isNaN(endDate.getTime())) {
        // Utiliser la durée du package
        endDate = new Date(startDate.getTime() + (package.duration * 24 * 60 * 60 * 1000));
      }
    } else {
      // Utiliser la durée du package (en jours)
      endDate = new Date(startDate.getTime() + (package.duration * 24 * 60 * 60 * 1000));
    }

    console.log('[GooglePlay] Dates calculées:', { startDate, endDate });

    // 5. Extraire le prix et la devise
    let priceAmountMicros = 0;
    let priceCurrencyCode = 'EUR';
    
    // Essayer différentes structures de données possibles
    try {
      if (data.lineItems && Array.isArray(data.lineItems) && data.lineItems.length > 0) {
        const lineItem = data.lineItems[0];
        console.log('[GooglePlay] LineItem trouvé:', JSON.stringify(lineItem, null, 2));
        
        // Cas 1: Structure avec offerDetails
        if (lineItem.offerDetails) {
          priceAmountMicros = lineItem.offerDetails.priceAmountMicros || 0;
          priceCurrencyCode = lineItem.offerDetails.priceCurrencyCode || 'EUR';
        }
        // Cas 2: Structure avec productDetails.basePlanDetails
        else if (lineItem.productDetails && lineItem.productDetails.basePlanDetails) {
          priceAmountMicros = lineItem.productDetails.basePlanDetails.priceAmountMicros || 0;
          priceCurrencyCode = lineItem.productDetails.basePlanDetails.priceCurrencyCode || 'EUR';
        }
        // Cas 3: Structure avec productDetails direct
        else if (lineItem.productDetails) {
          priceAmountMicros = lineItem.productDetails.priceAmountMicros || 0;
          priceCurrencyCode = lineItem.productDetails.priceCurrencyCode || 'EUR';
        }
        // Cas 4: Prix directement sur lineItem
        else if (lineItem.priceAmountMicros) {
          priceAmountMicros = lineItem.priceAmountMicros;
          priceCurrencyCode = lineItem.priceCurrencyCode || 'EUR';
        }
      }
    } catch (priceError) {
      console.error('[GooglePlay] Erreur extraction prix:', priceError);
    }
    
    // Si toujours pas de prix, utiliser le prix du package
    if (!priceAmountMicros || priceAmountMicros === 0) {
      console.log('[GooglePlay] Pas de prix Google, utilisation du prix package');
      // Essayer EUR d'abord, puis XAF, puis n'importe quelle devise
      let packagePrice = package.pricing.get('EUR');
      if (!packagePrice) {
        packagePrice = package.pricing.get('XAF');
      }
      if (!packagePrice && package.pricing.size > 0) {
        // Prendre la première devise disponible
        const firstCurrency = Array.from(package.pricing.keys())[0];
        packagePrice = package.pricing.get(firstCurrency);
        priceCurrencyCode = firstCurrency;
      }
      if (!packagePrice) {
        packagePrice = 10; // Prix par défaut
      }
      priceAmountMicros = packagePrice * 1000000;
    }

    console.log('[GooglePlay] Prix final:', { priceAmountMicros, priceCurrencyCode });

    // 6. Déterminer l'état de l'abonnement
    let subscriptionState = 'ACTIVE';
    let autoRenewing = false;
    
    if (data.subscriptionState) {
      // Mapper les états Google vers nos états
      const stateMap = {
        'SUBSCRIPTION_STATE_ACTIVE': 'ACTIVE',
        'SUBSCRIPTION_STATE_CANCELED': 'CANCELED',
        'SUBSCRIPTION_STATE_IN_GRACE_PERIOD': 'ACTIVE',
        'SUBSCRIPTION_STATE_ON_HOLD': 'ON_HOLD',
        'SUBSCRIPTION_STATE_PAUSED': 'PAUSED',
        'SUBSCRIPTION_STATE_EXPIRED': 'EXPIRED'
      };
      subscriptionState = stateMap[data.subscriptionState] || 'ACTIVE';
    }

    // Vérifier l'auto-renouvellement
    if (data.lineItems && data.lineItems[0]) {
      autoRenewing = data.lineItems[0].autoRenewingPlan?.autoRenewEnabled || false;
    } else {
      autoRenewing = data.autoRenewing || false;
    }

    // 7. Créer la transaction Google Play
    const googleTx = await GooglePlayTransaction.create({
      purchaseToken,
      orderId: data.latestOrderId || data.orderId || `GP_${Date.now()}`,
      productId,
      user: userId,
      package: packageId,
      status: subscriptionState,
      startTime: startDate,
      expiryTime: endDate,
      priceAmountMicros,
      priceCurrencyCode,
      autoRenewing,
      acknowledged: false,
      purchaseTime: startDate
    });

    console.log('[GooglePlay] Transaction créée:', googleTx._id);

    // 8. Créer la subscription
    const subscription = await Subscription.create({
      user: userId,
      package: packageId,
      startDate,
      endDate,
      pricing: {
        amount: Math.round(priceAmountMicros / 1000000), // Convertir en montant normal
        currency: priceCurrencyCode
      },
      status: 'active',
      paymentProvider: 'GOOGLE_PLAY',
      paymentReference: googleTx.orderId,
      googlePlayTransaction: googleTx._id,
      autoRenewing
    });

    console.log('[GooglePlay] Subscription créée:', subscription._id);

    // 9. Mettre à jour la transaction avec l'ID de subscription
    googleTx.subscription = subscription._id;
    await googleTx.save();

    // 10. Acknowledge l'achat (non bloquant)
    this.acknowledgePurchase(purchaseToken).catch(error => {
      console.error('[GooglePlay] Erreur acknowledge (non bloquant):', error.message);
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
    console.error('[GooglePlay] Erreur validation complète:', error);
    
    // Retourner une erreur plus descriptive
    let errorMessage = 'Erreur de validation: ';
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