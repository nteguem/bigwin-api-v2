// services/user/googleAuthService.js

const { OAuth2Client } = require('google-auth-library');
const User = require('../../models/user/User');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

class GoogleAuthService {
  constructor() {
    this.client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  }

  /**
   * Vérifier et décoder le token Google ID envoyé par l'app mobile
   */
  async verifyGoogleToken(idToken) {
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: [
          process.env.GOOGLE_CLIENT_ID,
          // Ajouter l'ID du client Android si différent
          '1001267727536-323s3jl7v106ke3le5q9jkcaabmti9mb.apps.googleusercontent.com'
        ]
      });
      
      const payload = ticket.getPayload();
      
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
      console.error('Erreur vérification token Google:', error.message);
      throw new AppError('Token Google invalide ou expiré', 401, ErrorCodes.AUTH_INVALID_TOKEN);
    }
  }

  /**
   * Créer ou connecter un utilisateur Google
   * PAS de fusion avec comptes existants comme demandé
   * @param {String} appId - ID de l'application
   */
  async findOrCreateGoogleUser(appId, googleData, additionalData = {}) {
    try {
      // ⭐ 1. Chercher d'abord par googleId ET appId
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
        
        return { user, isNewUser: false };
      }
      
      // ⭐ 2. Vérifier si l'email Google existe déjà DANS CETTE APP (PAS de fusion)
      const existingEmailUser = await User.findOne({ email: googleData.email, appId });
      if (existingEmailUser) {
        // Email déjà utilisé par un compte local - on refuse
        throw new AppError(
          'Cet email est déjà associé à un compte existant. Veuillez vous connecter avec votre téléphone et mot de passe.',
          400,
          ErrorCodes.VALIDATION_ERROR
        );
      }
      
      // ⭐ 3. Créer un nouveau compte Google POUR CETTE APP
      const pseudo = await this.generateUniquePseudo(appId, googleData);
      
      // Valider le code affilié si fourni
      let referredBy = null;
      if (additionalData.affiliateCode) {
        const authService = require('./authService');
        try {
          // ⭐ Passer appId pour valider l'affilié
          const affiliate = await authService.validateAffiliateCode(appId, additionalData.affiliateCode);
          referredBy = affiliate?._id;
        } catch (error) {
          console.log('Code affilié invalide:', additionalData.affiliateCode);
          // On continue sans affilié
        }
      }
      
      // ⭐ Créer le nouveau user AVEC APPID
      user = await User.create({
        // ⭐ Multi-tenant
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
      console.error('Erreur findOrCreateGoogleUser:', error);
      throw error;
    }
  }

  /**
   * Générer un pseudo unique à partir des données Google
   * @param {String} appId - ID de l'application
   */
  async generateUniquePseudo(appId, googleData) {
    // Stratégie de génération du pseudo :
    // 1. Essayer prénom
    // 2. Sinon partie avant @ de l'email
    // 3. Ajouter des chiffres si déjà pris
    
    let basePseudo = '';
    
    if (googleData.firstName) {
      // Utiliser le prénom sans espaces et caractères spéciaux
      basePseudo = googleData.firstName.toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .substring(0, 15); // Limiter la longueur
    }
    
    if (!basePseudo && googleData.email) {
      // Utiliser la partie avant @ de l'email
      basePseudo = googleData.email.split('@')[0]
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .substring(0, 15);
    }
    
    if (!basePseudo) {
      // Cas de secours
      basePseudo = 'user';
    }
    
    // ⭐ Vérifier l'unicité DANS CETTE APP et ajouter un nombre si nécessaire
    let pseudo = basePseudo;
    let counter = 1;
    
    while (await User.findOne({ pseudo, appId })) {
      pseudo = `${basePseudo}${counter}`;
      counter++;
      
      // Sécurité pour éviter boucle infinie
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
   */
  async canUseGoogleAuth(appId, email) {
    // ⭐ Vérifier si l'email est déjà utilisé par un compte local DANS CETTE APP
    const existingUser = await User.findOne({ 
      email,
      appId, // ⭐ AJOUT
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
}

module.exports = new GoogleAuthService();