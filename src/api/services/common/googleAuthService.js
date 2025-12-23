// src/api/services/common/googleAuthService.js - VERSION MULTI-TENANT

const { OAuth2Client } = require('google-auth-library');
const User = require('../../models/user/User');
const App = require('../../models/common/App');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

class GoogleAuthService {
  constructor() {
    // Cache des clients OAuth par appId pour optimiser les performances
    this.clientCache = new Map();
  }

  /**
   * Récupérer ou créer un client OAuth2 pour une app spécifique
   * @param {String} appId - ID de l'application
   */
  async getOAuthClient(appId) {
    // Vérifier le cache
    if (this.clientCache.has(appId)) {
      return this.clientCache.get(appId);
    }

    // Récupérer la config de l'app depuis la BDD
    const app = await App.findOne({ appId }).select('googleAuth');
    
    if (!app) {
      throw new AppError('Application non trouvée', 404, ErrorCodes.NOT_FOUND);
    }

    const googleAuthConfig = app.getGoogleAuthConfig();

    if (!googleAuthConfig.enabled) {
      throw new AppError(
        'Google Sign-In n\'est pas activé pour cette application',
        403,
        ErrorCodes.FEATURE_DISABLED
      );
    }

    if (!googleAuthConfig.clientId && !googleAuthConfig.webClientId) {
      throw new AppError(
        'Google OAuth non configuré pour cette application',
        500,
        ErrorCodes.CONFIGURATION_ERROR
      );
    }

    // Créer le client OAuth avec les IDs de cette app
    // Priorité : webClientId > clientId
    const clientId = googleAuthConfig.webClientId || googleAuthConfig.clientId;
    const client = new OAuth2Client(clientId);
    
    // Stocker dans le cache
    this.clientCache.set(appId, {
      client,
      clientId: googleAuthConfig.clientId,
      webClientId: googleAuthConfig.webClientId
    });

    console.log(`✅ Client OAuth créé pour app: ${appId}`);
    return this.clientCache.get(appId);
  }

  /**
   * Vérifier et décoder le token Google ID envoyé par l'app mobile
   * @param {String} appId - ID de l'application
   * @param {String} idToken - Token Google ID
   */
  async verifyGoogleToken(appId, idToken) {
    try {
      // Récupérer le client OAuth pour cette app
      const { client, clientId, webClientId } = await this.getOAuthClient(appId);
      
      // Liste des audiences autorisées pour cette app
      const audiences = [clientId, webClientId].filter(Boolean);
      
      if (audiences.length === 0) {
        throw new AppError(
          'Aucun Client ID configuré pour cette application',
          500,
          ErrorCodes.CONFIGURATION_ERROR
        );
      }

      // Vérifier le token
      const ticket = await client.verifyIdToken({
        idToken,
        audience: audiences
      });
      
      const payload = ticket.getPayload();
      
      // 🔍 LOG pour debug (à retirer en production si tu veux)
      console.log(`✅ Token vérifié pour app: ${appId} - Audience: ${payload.aud}`);
      
      // Extraire les infos Google
      return {
        googleId: payload.sub,
        email: payload.email,
        emailVerified: payload.email_verified,
        firstName: payload.given_name || '',
        lastName: payload.family_name || '',
        fullName: payload.name || '',
        profilePicture: payload.picture || ''
      };
    } catch (error) {
      console.error(`❌ Erreur vérification token Google (app: ${appId}):`, error.message);
      
      if (error instanceof AppError) {
        throw error;
      }
      
      throw new AppError(
        'Token Google invalide ou expiré',
        401,
        ErrorCodes.AUTH_INVALID_TOKEN
      );
    }
  }

  /**
   * Créer ou connecter un utilisateur Google
   * @param {String} appId - ID de l'application
   * @param {Object} googleData - Données extraites du token Google
   * @param {Object} additionalData - Données additionnelles (city, countryCode, affiliateCode)
   */
  async findOrCreateGoogleUser(appId, googleData, additionalData = {}) {
    try {
      // 1. Chercher d'abord par googleId ET appId
      let user = await User.findOne({ googleId: googleData.googleId, appId });
      
      if (user) {
        // User Google existant - mise à jour des infos si changées
        const updates = {
          email: googleData.email,
          emailVerified: googleData.emailVerified,
          profilePicture: googleData.profilePicture
        };
        
        // Garder les noms existants s'ils existent, sinon utiliser ceux de Google
        if (!user.firstName && googleData.firstName) {
          updates.firstName = googleData.firstName;
        }
        if (!user.lastName && googleData.lastName) {
          updates.lastName = googleData.lastName;
        }
        
        await User.findByIdAndUpdate(user._id, updates);
        
        console.log(`✅ User Google existant connecté: ${user.email} - App: ${appId}`);
        return { user, isNewUser: false };
      }
      
      // 2. Vérifier si l'email Google existe déjà DANS CETTE APP
      const existingEmailUser = await User.findOne({ email: googleData.email, appId });
      if (existingEmailUser) {
        // Email déjà utilisé par un compte local - on refuse la fusion
        throw new AppError(
          'Cet email est déjà associé à un compte existant. Veuillez vous connecter avec votre téléphone et mot de passe.',
          400,
          ErrorCodes.VALIDATION_ERROR
        );
      }
      
      // 3. Créer un nouveau compte Google POUR CETTE APP
      const pseudo = await this.generateUniquePseudo(appId, googleData);
      
      // Valider le code affilié si fourni
      let referredBy = null;
      if (additionalData.affiliateCode) {
        const authService = require('./authService');
        try {
          const affiliate = await authService.validateAffiliateCode(appId, additionalData.affiliateCode);
          referredBy = affiliate?._id;
        } catch (error) {
          console.log(`⚠️  Code affilié invalide (${additionalData.affiliateCode}) - App: ${appId}`);
          // On continue sans affilié
        }
      }
      
      // Créer le nouveau user
      user = await User.create({
        // Multi-tenant
        appId,
        
        // Auth Google
        googleId: googleData.googleId,
        authProvider: 'google',
        
        // Infos de profil
        email: googleData.email,
        emailVerified: googleData.emailVerified,
        pseudo,
        firstName: googleData.firstName,
        lastName: googleData.lastName,
        profilePicture: googleData.profilePicture,
        
        // Infos additionnelles de l'app
        city: additionalData.city || '',
        countryCode: additionalData.countryCode || '',
        referredBy,
        
        // Statut
        isActive: true
      });
      
      console.log(`✅ Nouveau user Google créé: ${user.email} (${user.pseudo}) - App: ${appId}`);
      return { user, isNewUser: true };
      
    } catch (error) {
      console.error(`❌ Erreur findOrCreateGoogleUser (app: ${appId}):`, error);
      throw error;
    }
  }

  /**
   * Générer un pseudo unique à partir des données Google
   * @param {String} appId - ID de l'application
   * @param {Object} googleData - Données Google
   */
  async generateUniquePseudo(appId, googleData) {
    let basePseudo = '';
    
    if (googleData.firstName) {
      basePseudo = googleData.firstName.toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .substring(0, 15);
    }
    
    if (!basePseudo && googleData.email) {
      basePseudo = googleData.email.split('@')[0]
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .substring(0, 15);
    }
    
    if (!basePseudo) {
      basePseudo = 'user';
    }
    
    // Vérifier l'unicité DANS CETTE APP
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

  /**
   * Vérifier si un utilisateur peut utiliser Google Auth
   * @param {String} appId - ID de l'application
   * @param {String} email - Email à vérifier
   */
  async canUseGoogleAuth(appId, email) {
    // Vérifier si Google Auth est activé pour cette app
    const app = await App.findOne({ appId }).select('googleAuth');
    
    if (!app) {
      return {
        canUse: false,
        reason: 'Application non trouvée'
      };
    }

    const googleAuthConfig = app.getGoogleAuthConfig();

    if (!googleAuthConfig.enabled) {
      return {
        canUse: false,
        reason: 'Google Sign-In non activé pour cette application'
      };
    }

    // Vérifier si l'email est déjà utilisé par un compte local
    const existingUser = await User.findOne({ 
      email,
      appId,
      authProvider: 'local' 
    });
    
    if (existingUser) {
      return {
        canUse: false,
        reason: 'Email déjà utilisé par un compte local'
      };
    }
    
    return { canUse: true };
  }

  /**
   * Invalider le cache pour une app (utile après mise à jour de config)
   * @param {String} appId - ID de l'application (optionnel)
   */
  clearCache(appId = null) {
    if (appId) {
      this.clientCache.delete(appId);
      console.log(`🗑️  Cache OAuth vidé pour app: ${appId}`);
    } else {
      this.clientCache.clear();
      console.log('🗑️  Cache OAuth complètement vidé');
    }
  }
}

module.exports = new GoogleAuthService();