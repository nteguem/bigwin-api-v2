const mongoose = require('mongoose');

const packageSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
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
  features: [String],
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Index pour performance
packageSchema.index({ isActive: 1 });

// Pour un Map, on peut seulement indexer sur l'existence de pricing
// ou créer des index spécifiques selon vos besoins de requête
packageSchema.index({ pricing: 1 }); // Index général sur pricing

// Méthode pour ajouter/modifier un prix dans une devise
packageSchema.methods.setPricing = function(currency, price) {
  if (!this.pricing) {
    this.pricing = new Map();
  }
  this.pricing.set(currency.toUpperCase(), price);
  return this;
};

// Méthode pour obtenir le prix dans une devise spécifique
packageSchema.methods.getPricing = function(currency) {
  return this.pricing ? this.pricing.get(currency.toUpperCase()) : undefined;
};

// Méthode pour obtenir toutes les devises disponibles
packageSchema.methods.getAvailableCurrencies = function() {
  return this.pricing ? Array.from(this.pricing.keys()) : [];
};

// Supprimer champs sensibles du JSON et convertir Map en objet
packageSchema.methods.toJSON = function() {
  const packageObj = this.toObject();
  delete packageObj.__v;
  
  // Convertir la Map pricing en objet normal pour le JSON
  if (packageObj.pricing instanceof Map) {
    packageObj.pricing = Object.fromEntries(packageObj.pricing);
  }
  
  return packageObj;
};

// Pre-save hook pour valider les codes de devises (optionnel)
packageSchema.pre('save', function(next) {
  if (this.pricing) {
    // Validation optionnelle des codes ISO 4217 (3 lettres)
    for (let currency of this.pricing.keys()) {
      if (!/^[A-Z]{3}$/.test(currency)) {
        return next(new Error(`Code devise invalide: ${currency}. Doit être 3 lettres majuscules.`));
      }
    }
  }
  next();
});

module.exports = mongoose.model('Package', packageSchema);