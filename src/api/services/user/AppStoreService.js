// src/api/services/user/AppStoreService.js
//
// Service de validation des transactions StoreKit 2 envoyées par le client iOS.
//
// État actuel : SCAFFOLD. Les méthodes de validation effective (`validateTransaction`,
// `validateOneTimePurchase`) lancent `NotImplementedError` parce que la validation
// JWS contre la chaîne de certificats Apple PKI est un bloc isolé qui demande
// un compte App Store Connect actif + des transactions sandbox pour être testé
// correctement (cf. README iOS dans le repo mobile).
//
// L'endpoint `/products/:packageId` lui est pleinement fonctionnel : il renvoie
// le `appleProductId` stocké sur le Package pour que le client iOS sache quel
// produit charger depuis StoreKit.
//
// Pour compléter la validation plus tard, voici le plan :
//   1. Ajouter `jose` aux deps
//   2. Implémenter `_verifySignedTransaction(jws, expectedBundleId)` :
//      - décoder le header JWS pour extraire `x5c` (chaîne de certificats)
//      - valider la chaîne contre le AppleRootCA-G3 (à embarquer dans le repo
//        ou télécharger depuis https://www.apple.com/certificateauthority/)
//      - vérifier la signature avec la clé publique du leaf cert
//      - vérifier `bundleId === expectedBundleId`, `environment`, `productId` non vide
//   3. Brancher dans `validateTransaction` / `validateOneTimePurchase`
//   4. Créer / mettre à jour la Subscription via `subscriptionService.createOrUpdateSubscription`
//      (mirror du flow Google Play)

const App = require('../../models/common/App');
const Package = require('../../models/common/Package');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

class NotImplementedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotImplementedError';
  }
}

class AppStoreService {
  /**
   * Resolve and validate the App Store config for an app.
   */
  async getConfig(appId) {
    const app = await App.findOne({ appId }).select('appStore');

    if (!app) {
      throw new AppError('Application non trouvée', 404, ErrorCodes.NOT_FOUND);
    }

    const config = app.getAppStoreConfig();

    if (!config.enabled) {
      throw new AppError(
        'App Store IAP n\'est pas activé pour cette application',
        403,
        ErrorCodes.FEATURE_DISABLED
      );
    }

    if (!config.bundleId) {
      throw new AppError(
        'Bundle ID iOS non configuré pour cette application',
        500,
        ErrorCodes.CONFIGURATION_ERROR
      );
    }

    return config;
  }

  /**
   * Look up the App Store product info for a package.
   * Returns `null` if the package isn't sold via App Store.
   *
   * @param {String} appId
   * @param {String} packageId
   */
  async getProductInfo(appId, packageId) {
    const pkg = await Package.findOne({ _id: packageId, appId });

    if (!pkg) {
      throw new AppError('Package introuvable', 404, ErrorCodes.NOT_FOUND);
    }

    if (!pkg.availableOnAppStore || !pkg.appleProductId) {
      return null;
    }

    return {
      packageId: pkg._id.toString(),
      packageName: pkg.name,
      appleProductId: pkg.appleProductId,
      appleProductType: pkg.appleProductType || 'SUBSCRIPTION',
      pricing: pkg.pricing,
    };
  }

  /**
   * Validate a StoreKit 2 signed transaction (subscription flow).
   * NOT YET IMPLEMENTED — see header comment.
   *
   * Expected client body:
   *   - signedTransaction: JWS string sent by the iOS app
   *   - productId: appleProductId
   *   - packageId: our internal Package._id
   *
   * Returns: { success, message, subscription }
   */
  // eslint-disable-next-line no-unused-vars
  async validateTransaction(appId, { signedTransaction, productId, packageId }) {
    // TODO(app-store): decode + verify JWS, match productId to package's
    // appleProductId, create/update Subscription.
    throw new NotImplementedError(
      'App Store transaction validation not yet implemented — see AppStoreService header'
    );
  }

  /**
   * Validate a one-time (consumable) App Store purchase.
   * NOT YET IMPLEMENTED — see header comment.
   */
  // eslint-disable-next-line no-unused-vars
  async validateOneTimePurchase(appId, { signedTransaction, productId, packageId }) {
    throw new NotImplementedError(
      'App Store one-time purchase validation not yet implemented'
    );
  }
}

const service = new AppStoreService();
service.NotImplementedError = NotImplementedError;

module.exports = service;
