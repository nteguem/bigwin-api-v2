// src/api/models/common/GlobalConfig.js
//
// Configuration GLOBALE de la plateforme — UN SEUL document pour TOUTES les apps
// (contrairement à WheelConfig qui est scopé par appId). Sert de porte-drapeaux
// pour les feature flags transverses qui doivent s'activer/désactiver d'un coup
// sur l'ensemble des tenants.
//
// Accès via `GlobalConfig.getSingleton()`. Le marqueur `_singleton: 'global'`
// (unique) garantit qu'il n'existe jamais qu'un seul document.

const mongoose = require('mongoose');

const GlobalConfigSchema = new mongoose.Schema({
  // Clé d'unicité du singleton — toujours 'global', non modifiable.
  _singleton: {
    type: String,
    default: 'global',
    unique: true,
    immutable: true
  },

  // Feature flags transverses (toutes apps).
  features: {
    // Bilan / récap des coupons (taux de réussite sur les N derniers jours).
    // enabled=false ⇒ l'écran est masqué dans TOUTES les apps (le mobile lit
    // ce flag via /app/info et n'affiche pas l'onglet).
    weeklyReport: {
      enabled: { type: Boolean, default: false },
      // Fenêtre du bilan en jours (par défaut 5 derniers jours pleins).
      daysBack: { type: Number, default: 5, min: 1, max: 30 }
    }
  }
}, { timestamps: true });

// Upsert atomique du singleton global. `setDefaultsOnInsert` applique les
// valeurs `default` du schéma à la première création.
GlobalConfigSchema.statics.getSingleton = async function () {
  return this.findOneAndUpdate(
    { _singleton: 'global' },
    { $setOnInsert: { _singleton: 'global' } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

module.exports = mongoose.model('GlobalConfig', GlobalConfigSchema);
