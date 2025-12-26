// src/api/models/common/Package.js

const mongoose = require('mongoose');

const packageSchema = new mongoose.Schema({
  appId: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    ref: 'App'
  },
  
  name: {
    fr: {
      type: String,
      required: [true, 'Le nom en français est requis'],
      trim: true
    },
    en: {
      type: String,
      required: [true, 'Le nom en anglais est requis'],
      trim: true
    }
  },
  
  description: {
    fr: {
      type: String,
      trim: true
    },
    en: {
      type: String,
      trim: true
    }
  },
  
  pricing: {
    type: Map,
    of: {
      type: Number,
      min: 0,
      validate: {
        validator: function(value) {
          return value >= 0;
        },
        message: 'Le prix doit être positif'
      }
    },
    required: true,
    validate: {
      validator: function(map) {
        return map.size > 0;
      },
      message: 'Au moins une devise doit être spécifiée'
    }
  },
  
  duration: {
    type: Number,
    required: true,
    min: 1
  },
  
  categories: [{
    type: mongoose.Schema.ObjectId,
    ref: 'Category'
  }],
  
  badge: {
    fr: {
      type: String,
      trim: true
    },
    en: {
      type: String,
      trim: true
    }
  },
  
  economy: {
    type: Map,
    of: {
      type: Number,
      min: 0,
      validate: {
        validator: function(value) {
          return value >= 0;
        },
        message: 'L\'économie doit être positive'
      }
    }
  },

  googleProductId: {
    type: String,
    trim: true,
    sparse: true
  },

  googlePlanId: {
    monthly: {
      type: String,
      trim: true
    },
    quarterly: {
      type: String,
      trim: true
    }
  },

  availableOnGooglePlay: {
    type: Boolean,
    default: false
  },

  googleProductType: {
    type: String,
    enum: ['SUBSCRIPTION', 'ONE_TIME_PRODUCT'],
    default: function() {
      if (this.availableOnGooglePlay && this.googleProductId) {
        return 'SUBSCRIPTION';
      }
      return null;
    }
  },

  formationId: {
    type: mongoose.Schema.ObjectId,
    ref: 'Formation'
  },
  
  isActive: {
    type: Boolean,
    default: true
  },
  
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes
packageSchema.index({ appId: 1, googleProductId: 1 }, { unique: true, sparse: true });
packageSchema.index({ appId: 1, isActive: 1 });
packageSchema.index({ appId: 1, availableOnGooglePlay: 1 });
packageSchema.index({ isActive: 1 });
packageSchema.index({ pricing: 1 });
packageSchema.index({ formationId: 1 });

// Methods
packageSchema.methods.isGooglePlayOneTimeProduct = function() {
  return this.availableOnGooglePlay && this.googleProductType === 'ONE_TIME_PRODUCT';
};

packageSchema.methods.isGooglePlaySubscription = function() {
  return this.availableOnGooglePlay && 
    (this.googleProductType === 'SUBSCRIPTION' || !this.googleProductType);
};

packageSchema.methods.getGooglePlayInfo = function() {
  if (!this.availableOnGooglePlay) {
    return null;
  }
  
  return {
    productId: this.googleProductId,
    plans: this.googlePlanId,
    available: true,
    productType: this.googleProductType || 'SUBSCRIPTION'
  };
};

packageSchema.methods.setPricing = function(currency, price) {
  if (!this.pricing) {
    this.pricing = new Map();
  }
  this.pricing.set(currency.toUpperCase(), price);
  return this;
};

packageSchema.methods.getPricing = function(currency) {
  return this.pricing ? this.pricing.get(currency.toUpperCase()) : undefined;
};

packageSchema.methods.getAvailableCurrencies = function() {
  return this.pricing ? Array.from(this.pricing.keys()) : [];
};

packageSchema.methods.setEconomy = function(currency, amount) {
  if (!this.economy) {
    this.economy = new Map();
  }
  this.economy.set(currency.toUpperCase(), amount);
  return this;
};

packageSchema.methods.getEconomy = function(currency) {
  return this.economy ? this.economy.get(currency.toUpperCase()) : undefined;
};

packageSchema.methods.formatForLanguage = function(lang = 'fr') {
  const packageObj = this.toObject();
  
  let formation = null;
  if (packageObj.formationId && typeof packageObj.formationId === 'object') {
    formation = {
      _id: packageObj.formationId._id,
      title: packageObj.formationId.title[lang] || packageObj.formationId.title.fr,
      description: packageObj.formationId.description[lang] || packageObj.formationId.description.fr,
      isActive: packageObj.formationId.isActive,
      createdAt: packageObj.formationId.createdAt,
      updatedAt: packageObj.formationId.updatedAt
    };
  }
  
  return {
    _id: packageObj._id,
    name: packageObj.name[lang] || packageObj.name.fr,
    description: packageObj.description ? (packageObj.description[lang] || packageObj.description.fr) : null,
    pricing: packageObj.pricing instanceof Map ? Object.fromEntries(packageObj.pricing) : packageObj.pricing,
    duration: packageObj.duration,
    categories: packageObj.categories,
    badge: packageObj.badge ? (packageObj.badge[lang] || packageObj.badge.fr) : null,
    economy: packageObj.economy instanceof Map ? Object.fromEntries(packageObj.economy) : packageObj.economy,
    formation: formation,
    formationId: typeof packageObj.formationId === 'object' ? packageObj.formationId._id : packageObj.formationId,
    isActive: packageObj.isActive,
    createdAt: packageObj.createdAt,
    // ===== AJOUT DES CHAMPS GOOGLE PLAY =====
    availableOnGooglePlay: packageObj.availableOnGooglePlay || false,
    googleProductId: packageObj.googleProductId || null,
    googleProductType: packageObj.googleProductType || null,
    googlePlanId: packageObj.googlePlanId || null
    // ========================================
  };
};

packageSchema.methods.toJSON = function() {
  const packageObj = this.toObject();
  delete packageObj.__v;
  
  if (packageObj.pricing instanceof Map) {
    packageObj.pricing = Object.fromEntries(packageObj.pricing);
  }
  
  if (packageObj.economy instanceof Map) {
    packageObj.economy = Object.fromEntries(packageObj.economy);
  }
  
  return packageObj;
};

// Hooks
packageSchema.pre('save', function(next) {
  if (this.pricing) {
    for (let currency of this.pricing.keys()) {
      if (!/^[A-Z]{3}$/.test(currency)) {
        return next(new Error(`Code devise invalide: ${currency}. Doit être 3 lettres majuscules.`));
      }
    }
  }
  
  if (this.economy) {
    for (let currency of this.economy.keys()) {
      if (!/^[A-Z]{3}$/.test(currency)) {
        return next(new Error(`Code devise invalide pour economy: ${currency}. Doit être 3 lettres majuscules.`));
      }
    }
  }
  
  next();
});

module.exports = mongoose.model('Package', packageSchema);