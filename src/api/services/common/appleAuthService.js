// src/api/services/common/appleAuthService.js - Sign in with Apple (multi-tenant)

const appleSignin = require('apple-signin-auth');
const User = require('../../models/user/User');
const App = require('../../models/common/App');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

class AppleAuthService {
  /**
   * Resolve the Apple Sign-In config for an app. Throws if not configured /
   * disabled. Mirrors `googleAuthService.getOAuthClient` shape.
   */
  async getAppleConfig(appId) {
    const app = await App.findOne({ appId }).select('appleAuth');

    if (!app) {
      throw new AppError('Application non trouvée', 404, ErrorCodes.NOT_FOUND);
    }

    const config = app.getAppleAuthConfig();

    if (!config.enabled) {
      throw new AppError(
        'Sign in with Apple n\'est pas activé pour cette application',
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
   * Verify and decode the Apple identityToken sent by the iOS client.
   *
   * apple-signin-auth fetches Apple's JWK Set (https://appleid.apple.com/auth/keys)
   * and caches it, so we don't need a manual JWKS client here. It also checks
   * `iss === https://appleid.apple.com`, `aud === bundleId`, and `exp`.
   *
   * @param {String} appId
   * @param {String} identityToken JWT from the iOS app
   */
  async verifyAppleToken(appId, identityToken) {
    try {
      const { bundleId } = await this.getAppleConfig(appId);

      const payload = await appleSignin.verifyIdToken(identityToken, {
        audience: bundleId,
        ignoreExpiration: false,
      });

      console.log(`✅ Token Apple vérifié pour app: ${appId} - sub: ${payload.sub}`);

      return {
        appleId: payload.sub,
        // Apple ne renvoie email_verified que pour les vrais emails (pas les relais
        // privés). Pour les relais on considère verified par construction (c'est
        // Apple qui les contrôle).
        email: payload.email || null,
        emailVerified: payload.email_verified === true ||
          payload.email_verified === 'true' ||
          (payload.email && payload.email.endsWith('@privaterelay.appleid.com')),
        isPrivateEmail: payload.is_private_email === true ||
          payload.is_private_email === 'true',
      };
    } catch (error) {
      console.error(`❌ Erreur vérification token Apple (app: ${appId}):`, error.message);

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        'Token Apple invalide ou expiré',
        401,
        ErrorCodes.AUTH_INVALID_TOKEN
      );
    }
  }

  /**
   * Find an existing Apple user or create one for this app.
   *
   * Apple only returns `email` / `givenName` / `familyName` on the FIRST
   * sign-in. The client passes them in the request body for that case; on
   * subsequent sign-ins they will be `null` and we rely on what we stored
   * the first time.
   */
  async findOrCreateAppleUser(appId, appleData, additionalData = {}) {
    try {
      // 1. Existing Apple user for this app?
      let user = await User.findOne({ appleId: appleData.appleId, appId });

      if (user) {
        // Refresh stored email if Apple finally exposes it (rare — usually
        // only on the very first sign-in, but handle the edge case anyway).
        const updates = {};
        if (appleData.email && !user.email) {
          updates.email = appleData.email;
          updates.emailVerified = appleData.emailVerified;
        }
        if (additionalData.firstName && !user.firstName) {
          updates.firstName = additionalData.firstName;
        }
        if (additionalData.lastName && !user.lastName) {
          updates.lastName = additionalData.lastName;
        }
        if (Object.keys(updates).length > 0) {
          await User.findByIdAndUpdate(user._id, updates);
        }

        console.log(`✅ User Apple existant connecté: ${user._id} - App: ${appId}`);
        return { user, isNewUser: false };
      }

      // 2. Email collision check (only if Apple gave us an email this time)
      if (appleData.email) {
        const existingEmailUser = await User.findOne({ email: appleData.email, appId });
        if (existingEmailUser) {
          throw new AppError(
            'Cet email est déjà associé à un compte existant. Veuillez vous connecter avec votre méthode habituelle.',
            400,
            ErrorCodes.VALIDATION_ERROR
          );
        }
      }

      // 3. Create the new Apple user.
      const pseudo = await this.generateUniquePseudo(appId, {
        firstName: additionalData.firstName,
        email: appleData.email,
      });

      const acquisition = additionalData.acquisitionSource &&
        ['google_ads', 'organique'].includes(additionalData.acquisitionSource)
        ? {
            source: additionalData.acquisitionSource,
            gclid: additionalData.acquisitionGclid || null,
            capturedAt: new Date()
          }
        : undefined;

      user = await User.create({
        appId,
        appleId: appleData.appleId,
        authProvider: 'apple',

        // Email may legitimately be null on subsequent sign-ins from a brand
        // new account that didn't share email — we still create the user.
        ...(appleData.email && {
          email: appleData.email,
          emailVerified: appleData.emailVerified,
        }),
        pseudo,
        ...(additionalData.firstName && { firstName: additionalData.firstName }),
        ...(additionalData.lastName && { lastName: additionalData.lastName }),
        city: additionalData.city || '',
        countryCode: additionalData.countryCode || '',
        isActive: true,
        ...(acquisition && { acquisition })
      });

      console.log(`✅ Nouveau user Apple créé: ${user._id} (${user.pseudo}) - App: ${appId}`);
      return { user, isNewUser: true };
    } catch (error) {
      console.error(`❌ Erreur findOrCreateAppleUser (app: ${appId}):`, error);
      throw error;
    }
  }

  /**
   * Generate a unique pseudo from the data Apple gave us. On Apple this is
   * thinner than Google: often only an email (or even nothing) on first
   * sign-in, and nothing at all on subsequent ones — so we fall back to a
   * timestamp-based pseudo if needed.
   */
  async generateUniquePseudo(appId, hint = {}) {
    let basePseudo = '';

    if (hint.firstName) {
      basePseudo = hint.firstName.toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .substring(0, 15);
    }

    if (!basePseudo && hint.email) {
      basePseudo = hint.email.split('@')[0]
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .substring(0, 15);
    }

    if (!basePseudo) {
      basePseudo = 'apple';
    }

    let pseudo = basePseudo;
    let counter = 1;

    while (await User.findOne({ pseudo, appId })) {
      pseudo = `${basePseudo}${counter}`;
      counter++;

      if (counter > 9999) {
        pseudo = `user${Date.now()}`;
        break;
      }
    }

    return pseudo;
  }
}

module.exports = new AppleAuthService();
