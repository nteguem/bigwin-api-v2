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
    fr: { type: String, required: true },
    en: { type: String, required: true }
  },

  description: {
    fr: String,
    en: String
  },

  googlePlay: {
    packageName: { type: String, sparse: true, unique: true },
    serviceAccountKeyPath: String
  },

  oneSignal: {
    appId: String,
    restApiKey: String
  },

  payments: {
    smobilpay: {
      apiUrl:    String,
      apiKey:    String,
      apiSecret: String,
      enabled:   { type: Boolean, default: false }
    },

    // CinetPay - Nouvelle API v1 (JWT)
    cinetpay: {
      baseUrl:     { type: String, default: 'https://api.cinetpay.net' },
      apiKey:      { type: String, trim: true },
      apiPassword: { type: String, trim: true },
      enabled:     { type: Boolean, default: false }
    },

    afribapay: {
      apiUrl:      String,
      apiUser:     String,
      apiKey:      String,
      merchantKey: String,
      enabled:     { type: Boolean, default: false }
    },

    dpopay: {
      companyToken: String,
      serviceType:  String,
      enabled:      { type: Boolean, default: false }
    },

    flutterwave: {
      apiUrl:        String,
      publicKey:     String,
      secretKey:     String,
      encryptionKey: String,
      webhookHash:   String,
      enabled:       { type: Boolean, default: false }
    },

    korapay: {
      apiUrl:        { type: String, default: 'https://api.korapay.com/merchant' },
      publicKey:     { type: String, trim: true },
      secretKey:     { type: String, trim: true },
      encryptionKey: { type: String, trim: true },
      enabled:       { type: Boolean, default: false }
    },

    fedapay: {
      environment:   String,
      publicKey:     String,
      secretKey:     String,
      apiUrl:        String,
      sandboxApiUrl: String,
      webhookSecret: String,
      enabled:       { type: Boolean, default: false }
    }
  },

  googleAuth: {
    clientId:    { type: String, default: null, trim: true },
    webClientId: { type: String, default: null, trim: true },
    enabled:     { type: Boolean, default: false }
  },

  branding: {
    primaryColor: String,
    logo:         String,
    icon:         String
  },

  isActive:  { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Indexes
appSchema.index({ isActive: 1 });

// Methods
appSchema.methods.getGooglePlayConfig = function () {
  return {
    packageName:           this.googlePlay?.packageName,
    serviceAccountKeyPath: this.googlePlay?.serviceAccountKeyPath
  };
};

appSchema.methods.getOneSignalConfig = function () {
  return {
    appId:      this.oneSignal?.appId,
    restApiKey: this.oneSignal?.restApiKey
  };
};

appSchema.methods.getPaymentConfig = function (provider) {
  return this.payments?.[provider] || null;
};

appSchema.methods.getGoogleAuthConfig = function () {
  return {
    clientId:    this.googleAuth?.clientId,
    webClientId: this.googleAuth?.webClientId,
    enabled:     this.googleAuth?.enabled || false
  };
};

appSchema.methods.getKorapayConfig = function () {
  return {
    apiUrl:        this.payments?.korapay?.apiUrl || 'https://api.korapay.com/merchant',
    publicKey:     this.payments?.korapay?.publicKey,
    secretKey:     this.payments?.korapay?.secretKey,
    encryptionKey: this.payments?.korapay?.encryptionKey,
    enabled:       this.payments?.korapay?.enabled || false
  };
};

appSchema.methods.getCinetpayConfig = function () {
  const c = this.payments?.cinetpay;
  return {
    enabled:     c?.enabled || false,
    baseUrl:     c?.baseUrl || 'https://api.cinetpay.net',
    apiKey:      c?.apiKey,
    apiPassword: c?.apiPassword
  };
};

// toJSON - masquer les champs sensibles
appSchema.methods.toJSON = function () {
  const app = this.toObject();

  if (app.googlePlay) delete app.googlePlay.serviceAccountKeyPath;
  if (app.oneSignal)  delete app.oneSignal.restApiKey;

  if (app.payments) {
    Object.keys(app.payments).forEach(provider => {
      if (app.payments[provider]) {
        ['apiKey', 'apiSecret', 'apiPassword', 'secretKey',
         'merchantKey', 'companyToken', 'encryptionKey',
         'webhookHash', 'webhookSecret'].forEach(field => {
          delete app.payments[provider][field];
        });
      }
    });
  }

  delete app.__v;
  return app;
};

// Hooks
appSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

appSchema.pre('findOneAndUpdate', function (next) {
  this.set({ updatedAt: new Date() });
  next();
});

module.exports = mongoose.model('App', appSchema);