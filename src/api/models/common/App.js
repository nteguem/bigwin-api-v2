// src/api/models/common/App.js

const mongoose = require('mongoose');

const appSchema = new mongoose.Schema({
  appId: {
    type: String,
    required: true,
    unique: true,  // ✅ Ceci crée DÉJÀ un index unique
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
      xof: {
        apiKey: String,
        siteId: String,
        secretKey: String
      },
      xaf: {
        apiKey: String,
        siteId: String,
        secretKey: String
      },
      enabled: {
        type: Boolean,
        default: false
      }
    },
    afribapay: {
      apiUrl: String,
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
    }
  },
  
  branding: {
    primaryColor: String,
    logo: String,
    icon: String
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
// ❌ SUPPRIMÉ : appSchema.index({ appId: 1 }); 
// (déjà créé automatiquement par "unique: true")
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
      }
    });
  }
  
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