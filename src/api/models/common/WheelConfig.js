// src/api/models/common/WheelConfig.js
//
// Configuration de la roue de la chance — UN document par app (multi-tenant).
// Accès via `WheelConfig.getSingleton(appId)`.
//
// Porté depuis win_tips (mono-tenant) : le marqueur `_singleton: 'wheel'` est
// remplacé par `appId` (unique) pour scoper la config à chaque tenant.

const mongoose = require('mongoose');

const WheelConfigSchema = new mongoose.Schema({
  // Tenant propriétaire de la config — unique : 1 config par app.
  appId: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    ref: 'App',
    unique: true
  },

  // Kill-switch global de la feature
  wheelEnabled: { type: Boolean, default: true },

  // Coût en pubs récompensées pour 1 tour (rétro-compat — remplacé par
  // ticketPacks ci-dessous). Conservé pour les anciennes apps.
  adsPerSpin: { type: Number, min: 0, default: 3 },

  // Packs de tours achetables par l'user en regardant des pubs.
  // Chaque pack : N tours pour M pubs visionnées. L'admin configure plusieurs
  // paliers (1 tour, 5 tours, 15 tours...) avec un ratio dégressif favorisant
  // les gros packs pour pousser l'user à voir + de pubs d'un coup.
  ticketPacks: {
    type: [{
      tickets: { type: Number, min: 1, required: true },
      adsRequired: { type: Number, min: 1, required: true },
      label: {
        fr: { type: String, default: '' },
        en: { type: String, default: '' }
      },
      featured: { type: Boolean, default: false }  // mis en avant côté UI
    }],
    default: () => ([
      { tickets: 1,  adsRequired: 3,  label: { fr: '1 tour',   en: '1 spin'   } },
      { tickets: 5,  adsRequired: 12, label: { fr: '5 tours',  en: '5 spins'  }, featured: true },
      { tickets: 15, adsRequired: 30, label: { fr: '15 tours', en: '15 spins' } }
    ])
  },

  // Cooldown entre 2 spins consécutifs en secondes (anti-bot)
  cooldownSec: { type: Number, min: 0, default: 5 },

  // Limite quotidienne de spins par user (anti-farm)
  dailyMaxSpinsPerUser: { type: Number, min: 1, default: 20 },

  // Seuil minimum de retrait du wallet (Map<currency, montant minimum>)
  withdrawalThresholds: {
    type: Map,
    of: Number,
    default: () => new Map([['XAF', 5000]])
  },

  // Devise par défaut pour les gains cash si non précisée sur le lot
  defaultCurrency: { type: String, default: 'XAF', uppercase: true }
}, { timestamps: true });

// Upsert atomique scopé par app : garantit une config unique par tenant.
// `setDefaultsOnInsert` applique les valeurs `default` du schéma à l'insertion.
WheelConfigSchema.statics.getSingleton = async function (appId) {
  if (!appId) throw new Error('WheelConfig.getSingleton: appId requis');
  return this.findOneAndUpdate(
    { appId },
    { $setOnInsert: { appId } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

WheelConfigSchema.methods.toAdminJSON = function () {
  const obj = this.toObject();
  if (obj.withdrawalThresholds instanceof Map) {
    obj.withdrawalThresholds = Object.fromEntries(obj.withdrawalThresholds);
  }
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('WheelConfig', WheelConfigSchema);
