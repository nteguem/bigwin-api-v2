// src/api/models/affiliate/AffiliateConfig.js
//
// Configuration du programme d'affiliation, par app. 1 doc par appId
// (singleton scoped). Tous les paramètres business (taux, tiers, seuils,
// pays activés, etc.) sont éditables depuis le backoffice admin sans
// déploiement.

const mongoose = require('mongoose');

const tierSchema = new mongoose.Schema(
  {
    key: { type: String, required: true }, // 'rookie' | 'pro' | 'elite' | 'legend'
    label: {
      fr: String,
      en: String,
    },
    commissionRate: { type: Number, required: true }, // %, ex: 15
    recurringMonths: { type: Number, default: 0 },     // 0 = pas de recurring (V1)
    lifetimeCapMultiplier: { type: Number, default: 3 }, // commission max = 3× prix forfait
    promotionRule: {
      minConversionsPerMonth: Number,
      consecutiveMonths: Number,
    },
  },
  { _id: false }
);

const payoutCountrySchema = new mongoose.Schema(
  {
    code: { type: String, required: true, uppercase: true }, // ISO-2
    currency: { type: String, required: true, uppercase: true },
    operators: [String],            // ['orange', 'mtn', 'wave', ...]
    minAmountForPayout: { type: Number, default: 100 },     // min AfribaPay
    maxAmountForPayout: { type: Number, default: 2500000 }, // max AfribaPay
    payoutThreshold: { type: Number, default: 0 },          // seuil mini retrait (0 = pas de seuil)
    enabled: { type: Boolean, default: true },
    afribaPayAccountId: String, // ex: 'CMXAF-OUTAPM31923613' (info seulement)

    // Surveillance balance
    criticalBalanceThreshold: { type: Number, default: 50000 },  // alerte admin
    blockingBalanceThreshold: { type: Number, default: 10000 },  // bloque nouveaux retraits

    _id: false,
  }
);

const bonusSchema = new mongoose.Schema(
  {
    key: { type: String, required: true }, // 'first_win' | 'streak_3m' | ...
    label: {
      fr: String,
      en: String,
    },
    amount: Number,         // pour bonus en montant fixe
    currency: String,
    percentBonus: Number,   // pour bonus en %
    enabled: { type: Boolean, default: true },
    config: mongoose.Schema.Types.Mixed, // params spécifiques (consecutiveMonths, etc.)
  },
  { _id: false }
);

const affiliateConfigSchema = new mongoose.Schema(
  {
    appId: {
      type: String,
      required: true,
      unique: true, // 1 config par app
      lowercase: true,
      trim: true,
    },

    isEnabled: { type: Boolean, default: true },

    // Tier par défaut à l'activation d'un nouvel affilié
    defaultTier: { type: String, default: 'rookie' },

    // Taux de commission appliqué par défaut (V1: tier flat unique).
    // Override possible via `tiers[].commissionRate` quand on aura plusieurs tiers.
    defaultCommissionRate: { type: Number, default: 15 }, // %

    tiers: [tierSchema],
    payoutCountries: [payoutCountrySchema],
    bonuses: [bonusSchema],

    // Window d'attribution (jours entre install et 1er achat pour valider la commission)
    attributionWindowDays: { type: Number, default: 30 },

    // Limites anti-abus globales
    maxConcurrentPayoutsPerUser: { type: Number, default: 1 },
    maxPayoutsPerMonthPerUser: { type: Number, default: 2 },

    // Visibilité parrainage côté filleul (affichage "Tu as été parrainé par X")
    showReferrerToReferee: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AffiliateConfig', affiliateConfigSchema);
