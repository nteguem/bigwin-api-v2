// src/api/models/common/Category.js

const mongoose = require("mongoose");

/**
 * CATÉGORIES PARTAGÉES (Shared Categories)
 * =========================================
 * 
 * Les catégories peuvent être soit spécifiques à une application, soit partagées entre toutes les applications.
 * 
 * UTILISATION :
 * - appId = "app1", "app2", etc. → Catégorie spécifique à une app
 * - appId = "shared" → Catégorie partagée accessible depuis toutes les apps
 * 
 * EXEMPLES :
 * 1. Catégorie LIVE partagée :
 *    { appId: "shared", name: "LIVE", isVip: true }
 *    → Visible dans app1, app2, app3, etc.
 * 
 * 2. Catégorie PREMIUM spécifique :
 *    { appId: "app1", name: "PREMIUM", isVip: true }
 *    → Visible uniquement dans app1
 * 
 * GESTION :
 * - Les catégories partagées sont créées/modifiées manuellement dans la base de données
 * - L'admin décide quelles catégories sont partagées en changeant appId → "shared"
 * 
 * IMPACT :
 * - Tickets : Peuvent référencer des catégories partagées
 * - Packages : Peuvent inclure des catégories partagées
 * - Subscriptions : Donnent accès aux catégories VIP partagées cross-app
 */

const CategorySchema = new mongoose.Schema({
  appId: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    ref: 'App',
    // ⭐ NOUVEAU : Peut être "shared" pour une catégorie accessible partout
    validate: {
      validator: function(v) {
        // Accepter "shared" ou un appId valide
        return v === "shared" || /^[a-z0-9-]+$/.test(v);
      },
      message: 'appId doit être "shared" ou un identifiant d\'application valide'
    }
  },
  
  name: {
    type: String,
    required: true
  },
  
  description: String,
  
  icon: {
    type: String,
    default: "🧾"
  },
  
  successRate: {
    type: Number,
    default: 50,
    min: 0,
    max: 100,
    validate: {
      validator: function(v) {
        return v >= 0 && v <= 100;
      },
      message: 'Success rate must be between 0 and 100'
    }
  },
  
  isVip: {
    type: Boolean,
    default: false
  },
  
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes
// ⭐ Index unique maintenu : permet { appId: "shared", name: "LIVE" } ET { appId: "app1", name: "LIVE" }
CategorySchema.index({ appId: 1, name: 1 }, { unique: true });
CategorySchema.index({ appId: 1, isActive: 1 });
CategorySchema.index({ appId: 1, isVip: 1 });
CategorySchema.index({ isActive: 1 });
CategorySchema.index({ isVip: 1 });

/**
 * Méthode helper : Vérifier si la catégorie est partagée
 */
CategorySchema.methods.isShared = function() {
  return this.appId === "shared";
};

/**
 * Méthode helper : Obtenir les apps ayant accès à cette catégorie
 * @returns {Array<String>} Liste des appIds ("*" pour shared)
 */
CategorySchema.methods.getAccessibleApps = function() {
  return this.appId === "shared" ? ["*"] : [this.appId];
};

module.exports = mongoose.model("Category", CategorySchema);