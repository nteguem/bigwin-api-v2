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

// Le `code` (ISO-2) doit exister dans AppConfig (collection globale des
// pays plateforme). La devise est snapshotée ici depuis AppConfig au
// moment de l'enregistrement pour l'audit historique.
const payoutCountrySchema = new mongoose.Schema(
  {
    code: { type: String, required: true, uppercase: true }, // ISO-2 (référence AppConfig.countryCode)
    currency: { type: String, required: true, uppercase: true }, // snapshot AppConfig.currency
    minAmountForPayout: { type: Number, default: 100 },     // min de retrait demandé
    maxAmountForPayout: { type: Number, default: 2500000 }, // max de retrait demandé
    enabled: { type: Boolean, default: true },
    afribaPayAccountId: String, // ex: 'CMXAF-OUTAPM31923613' (info seulement)

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

/**
 * Porte publicitaire en amont de l'activation affilié.
 *
 * Si `enabled`, l'utilisateur doit avoir regardé `adsRequired` pubs récompensées
 * (SSV-vérifiées) AVANT que `POST /user/affiliate/activate` n'accepte sa
 * demande. Le compteur est cumulatif et persistant côté serveur : l'user
 * peut quitter à mi-chemin et reprendre plus tard. Une fois `adsRequired`
 * atteint, l'éligibilité reste acquise à vie (pas d'expiration).
 *
 * Réutilise l'infra `UserAccessUnlock` (resourceType: 'affiliate', resource:
 * null, durationMinutes: null = "à vie"). Le décompte est validé côté serveur
 * par le SSV AdMob, pas par le client → anti-triche.
 */
const adGateSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    // Nombre de pubs récompensées requises avant activation.
    adsRequired: { type: Number, default: 25, min: 1 },
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

    // Limites anti-abus globales
    maxConcurrentPayoutsPerUser: { type: Number, default: 1 },
    maxPayoutsPerMonthPerUser: { type: Number, default: 2 },

    // Visibilité parrainage côté filleul (affichage "Tu as été parrainé par X")
    showReferrerToReferee: { type: Boolean, default: true },

    // Porte ad-gate avant activation (voir doc du schema ci-dessus).
    adGate: { type: adGateSchema, default: () => ({}) },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AffiliateConfig', affiliateConfigSchema);
