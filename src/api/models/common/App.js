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
    // Nouvelle API CinetPay (api.cinetpay.co/v1) — OAuth 2.0 par compte/pays.
    // 1 compte = 1 devise. Les devises inutilisées peuvent rester vides.
    cinetpay: {
      apiUrl: {
        type: String,
        default: 'https://api.cinetpay.co'
      },
      xof: {
        apiKey: String,
        apiPassword: String
      },
      xaf: {
        apiKey: String,
        apiPassword: String
      },
      gnf: {
        apiKey: String,
        apiPassword: String
      },
      cdf: {
        apiKey: String,
        apiPassword: String
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
    },

    // InTouch / TouchPay e-marchand — Paiement Marchand multi-pays.
    // Cf. https://developers.intouchgroup.net/
    // Chaque pays = 1 compte e-marchand InTouch distinct (agence/partnerId/credentials
    // propres). On stocke la liste des configs par pays dans `configs[]`.
    intouch: {
      apiUrl:  { type: String, default: 'https://apidist.gutouch.net/apidist/sec' },
      enabled: { type: Boolean, default: false },     // master switch (toggle global InTouch)
      configs: [{
        countryCode:   { type: String, trim: true, uppercase: true, required: true },
        agence:        { type: String, trim: true, required: true },
        partnerId:     { type: String, trim: true, required: true },
        loginApi:      { type: String, trim: true, required: true },
        passwordApi:   { type: String, trim: true, required: true },
        basicUser:     { type: String, trim: true, required: true },
        basicPassword: { type: String, trim: true, required: true },
        enabled:       { type: Boolean, default: true }
      }]
    },

    // pawaPay — collecte mobile money multi-pays (1 compte = 20 pays africains).
    // Cf. https://docs.pawapay.io/v2/docs/welcome
    // Auth Bearer JWT. 2 tokens stockes (sandbox+prod), on flip via `environment`.
    // Webhook signe (RFC 9421 HTTP Signatures) — verification via webhookPublicKey.
    pawapay: {
      prodApiUrl:       { type: String, default: 'https://api.pawapay.io' },
      sandboxApiUrl:    { type: String, default: 'https://api.sandbox.pawapay.io' },
      environment:      { type: String, enum: ['sandbox', 'production'], default: 'sandbox' },
      sandboxToken:     { type: String, trim: true },
      prodToken:        { type: String, trim: true },
      webhookPublicKey: { type: String, trim: true },   // PEM, optionnel (recommande)
      enabled:          { type: Boolean, default: false }
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

// Retourne la config pawaPay active (sandbox OU production selon `environment`).
// Resout l'apiUrl + le token correspondant. Retourne { enabled:false } si
// master switch off ou si le token correspondant a l'env actif est vide.
appSchema.methods.getPawapayConfig = function () {
  const c = this.payments?.pawapay;
  if (!c?.enabled) return { enabled: false };
  const env = (c.environment === 'production') ? 'production' : 'sandbox';
  const apiUrl = env === 'production'
    ? (c.prodApiUrl    || 'https://api.pawapay.io')
    : (c.sandboxApiUrl || 'https://api.sandbox.pawapay.io');
  const token = env === 'production' ? c.prodToken : c.sandboxToken;
  return {
    enabled:          true,
    environment:      env,
    apiUrl,
    token,
    webhookPublicKey: c.webhookPublicKey || null
  };
};

// Retourne la config InTouch pour un pays donne (ou { enabled:false } si manquant/disabled).
// Le master switch `enabled` doit aussi etre actif. La config retournee merge
// la racine (apiUrl) et l'entree de `configs[]` du pays demande.
appSchema.methods.getIntouchConfig = function (countryCode) {
  const root = this.payments?.intouch;
  if (!root?.enabled) return { enabled: false };
  const cc = String(countryCode || '').toUpperCase();
  if (!cc) return { enabled: false };
  const found = (root.configs || []).find(c => c.countryCode === cc && c.enabled);
  if (!found) return { enabled: false };
  return {
    enabled:       true,
    apiUrl:        root.apiUrl || 'https://apidist.gutouch.net/apidist/sec',
    countryCode:   found.countryCode,
    agence:        found.agence,
    partnerId:     found.partnerId,
    loginApi:      found.loginApi,
    passwordApi:   found.passwordApi,
    basicUser:     found.basicUser,
    basicPassword: found.basicPassword
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

    // Cas particulier InTouch : credentials a l'interieur de configs[].
    if (Array.isArray(app.payments?.intouch?.configs)) {
      app.payments.intouch.configs.forEach(cfg => {
        ['loginApi', 'passwordApi', 'basicUser', 'basicPassword'].forEach(f => {
          delete cfg[f];
        });
      });
    }

    // Cas particulier pawaPay : 2 tokens (sandbox + prod) + cle publique
    // webhook (la cle PUBLIQUE n'est pas un secret mais on la masque par
    // hygiene — c'est un identifiant lie au compte marchand).
    if (app.payments?.pawapay) {
      ['sandboxToken', 'prodToken', 'webhookPublicKey'].forEach(f => {
        delete app.payments.pawapay[f];
      });
    }
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
