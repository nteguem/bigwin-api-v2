// src/api/models/common/App.js

const mongoose = require('mongoose');

const appSchema = new mongoose.Schema({
  appId: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: /^[a-z0-9-]+$/
  },
  
  name: {
    type: String,
    required: true,
    trim: true
  },
  
  displayName: {
    fr: {
      type: String,
      required: true
    },
    en: {
      type: String,
      required: true
    }
  },
  
  description: {
    fr: String,
    en: String
  },
  
  googlePlay: {
    packageName: {
      type: String,
      sparse: true,
      unique: true
    },
    serviceAccountKeyPath: String
  },
  
  oneSignal: {
    appId: String,
    restApiKey: String
  },
  
  payments: {
    smobilpay: {
      apiUrl: String,
      apiKey: String,
      apiSecret: String,
      enabled: {
        type: Boolean,
        default: false
      }
    },
    cinetpay: {
      apiUrl: String,
      xof: {
        siteId: String,
        secretKey: String,
      },
      xaf: {
        siteId: String,
        secretKey: String,
      },
      enabled: {
        type: Boolean,
        default: false
      }
    },
    afribapay: {
      apiUrl: String,
      // URL spécifique pour le service de payout (sortant). Différente
      // de apiUrl (collect/payin). Ex: https://api-payout.afribapay.com
      payoutApiUrl: {
        type: String,
        default: 'https://api-payout.afribapay.com'
      },
      apiUser: String,
      apiKey: String,
      merchantKey: String,
      enabled: {
        type: Boolean,
        default: false
      }
    },
    dpopay: {
      companyToken: String,
      serviceType: String,
      enabled: {
        type: Boolean,
        default: false
      }
    },
    flutterwave: {
      apiUrl: String,
      publicKey: String,
      secretKey: String,
      encryptionKey: String,
      webhookHash: String,
      enabled: {
        type: Boolean,
        default: false
      }
    },
    // ⭐ NOUVEAU : Configuration KoraPay
    korapay: {
      apiUrl: {
        type: String,
        default: 'https://api.korapay.com/merchant'
      },
      publicKey: {
        type: String,
        trim: true
      },
      secretKey: {
        type: String,
        trim: true
      },
      encryptionKey: {
        type: String,
        trim: true
      },
      enabled: {
        type: Boolean,
        default: false
      }
    }
  },
  
  googleAuth: {
    clientId: {
      type: String,
      default: null,
      trim: true,
      comment: 'Google OAuth Client ID (Web ou Android) pour cette app'
    },
    webClientId: {
      type: String,
      default: null,
      trim: true,
      comment: 'Google Web Client ID (souvent partagé entre apps)'
    },
    enabled: {
      type: Boolean,
      default: false,
      comment: 'Activer/désactiver Google Sign-In pour cette app'
    }
  },
  
  admobAppId: {
    type: String,
    default: null,
    trim: true
  },

  // Blocs d'annonces "rewarded" (pubs récompensées) — utilisés pour le
  // déblocage de tickets free par visionnage de pubs. Non sensibles (ces IDs
  // sont de toute façon embarqués dans le binaire de l'app) → exposés via
  // /app/info.
  admobRewardedAdUnitId: {
    android: { type: String, default: null, trim: true },
    ios: { type: String, default: null, trim: true }
  },

  // Tracking / Analytics per-app — utilisé par les webhooks paiement pour
  // envoyer des events de conversion à GA4 via Measurement Protocol, qui
  // sont ensuite importés comme conversions dans Google Ads.
  analytics: {
    firebase: {
      enabled: {
        type: Boolean,
        default: false,
        comment: 'Activer l\'envoi d\'events MP depuis les webhooks PSP'
      },
      appId: {
        type: String,
        default: null,
        trim: true,
        comment: 'Firebase App ID format 1:NUMBER:android:HEX (pour Android)'
      },
      mpApiSecret: {
        type: String,
        default: null,
        trim: true,
        comment: 'Measurement Protocol API Secret (créé dans GA4 > Data streams > Android > MP secrets)'
      }
    }
  },

  branding: {
    primaryColor: String,
    logo: String,
    icon: String
  },

  // URL de la fiche Play Store de l'app — utilisée comme CTA dans les
  // emails transactionnels (confirmation de souscription, cadeau, etc.).
  // Format : https://play.google.com/store/apps/details?id=com.<app>.application
  playStoreUrl: {
    type: String,
    trim: true,
  },

  // Adresse de contact pour la désinscription (mailto: dans les emails).
  // Si absent, on utilise un fallback générique (process.env.SMTP_FROM).
  supportEmail: {
    type: String,
    trim: true,
    lowercase: true,
  },
  
  isActive: {
    type: Boolean,
    default: true
  },
  
  createdAt: {
    type: Date,
    default: Date.now
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes
appSchema.index({ isActive: 1 });

// Methods
appSchema.methods.getGooglePlayConfig = function() {
  return {
    packageName: this.googlePlay?.packageName,
    serviceAccountKeyPath: this.googlePlay?.serviceAccountKeyPath
  };
};

appSchema.methods.getOneSignalConfig = function() {
  return {
    appId: this.oneSignal?.appId,
    restApiKey: this.oneSignal?.restApiKey
  };
};

appSchema.methods.getPaymentConfig = function(provider) {
  return this.payments?.[provider] || null;
};

appSchema.methods.getGoogleAuthConfig = function() {
  return {
    clientId: this.googleAuth?.clientId,
    webClientId: this.googleAuth?.webClientId,
    enabled: this.googleAuth?.enabled || false
  };
};

// ⭐ NOUVEAU : Méthode pour récupérer la config KoraPay
appSchema.methods.getKorapayConfig = function() {
  return {
    apiUrl: this.payments?.korapay?.apiUrl || 'https://api.korapay.com/merchant',
    publicKey: this.payments?.korapay?.publicKey,
    secretKey: this.payments?.korapay?.secretKey,
    encryptionKey: this.payments?.korapay?.encryptionKey,
    enabled: this.payments?.korapay?.enabled || false
  };
};

appSchema.methods.toJSON = function() {
  const app = this.toObject();
  
  if (app.googlePlay) {
    delete app.googlePlay.serviceAccountKeyPath;
  }
  if (app.oneSignal) {
    delete app.oneSignal.restApiKey;
  }
  if (app.payments) {
    Object.keys(app.payments).forEach(provider => {
      if (app.payments[provider]) {
        delete app.payments[provider].apiKey;
        delete app.payments[provider].apiSecret;
        delete app.payments[provider].secretKey;
        delete app.payments[provider].merchantKey;
        delete app.payments[provider].companyToken;
        // ⭐ NOUVEAU : Masquer les clés sensibles KoraPay
        if (provider === 'korapay') {
          delete app.payments[provider].secretKey;
          delete app.payments[provider].encryptionKey;
        }
      }
    });
  }
  
  // Les Client IDs Google ne sont pas sensibles (publics dans les apps)
  // Donc pas besoin de les masquer
  
  delete app.__v;
  return app;
};

// Hooks
appSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

appSchema.pre('findOneAndUpdate', function(next) {
  this.set({ updatedAt: new Date() });
  next();
});

module.exports = mongoose.model('App', appSchema);