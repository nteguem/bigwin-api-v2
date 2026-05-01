// src/api/models/common/GiftTier.js
//
// Entité GiftTier — palier de valeur d'un cadeau (free, bronze, silver, gold,
// diamond, platinum…). Globale (pas scopée par app) : un tier "Bronze" =
// "Bronze" partout, peu importe l'app.
//
// Relation : Gift → tier (ObjectId, ref)
//
// Pourquoi globale et non scopée par app :
//   - cohérence cross-app du modèle de valeur
//   - simplicité d'évolution : ajouter "Platinum" = 1 doc, dispo partout
//   - si besoin futur de variation par app, on ajoutera un override
//     `tierOverrides` au niveau App, pas en dupliquant les tiers

const mongoose = require('mongoose');

const giftTierSchema = new mongoose.Schema(
  {
    // Identifiant stable, lisible. Sert pour le seed, l'export, le code mobile.
    // Immutable une fois créé (l'admin ne devrait jamais avoir à le changer).
    // `immutable: true` empêche toute modification au niveau Mongoose, en plus
    // de la garde applicative dans giftTierManagementService.updateTier.
    key: {
      type: String,
      required: [true, 'key requis'],
      immutable: true,
      trim: true,
      lowercase: true,
      unique: true,
      match: [/^[a-z][a-z0-9_]*$/, 'key doit être en kebab/snake_case minuscule'],
    },

    label: {
      fr: { type: String, required: true, trim: true },
      en: { type: String, required: true, trim: true },
    },

    // Coût par défaut en crédits. Un Gift peut surcharger via `customCreditCost`.
    defaultCreditCost: {
      type: Number,
      required: true,
      min: 0,
    },

    emoji: { type: String, trim: true, default: '' },

    // Couleur d'accent (HEX sans #) pour les badges UI mobile/admin.
    color: {
      type: String,
      trim: true,
      default: '6B7280',
      match: [/^[0-9A-Fa-f]{6}$/, 'color doit être en HEX 6 chars (sans #)'],
    },

    displayOrder: {
      type: Number,
      default: 100,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true, // createdAt / updatedAt
  }
);

// ===== Indexes =====
// Le `unique` sur `key` est déjà déclaré au champ.
giftTierSchema.index({ isActive: 1, displayOrder: 1 });

// ===== Methods =====
giftTierSchema.methods.formatForLanguage = function (lang = 'fr') {
  const obj = this.toObject();
  return {
    _id: obj._id,
    key: obj.key,
    label: obj.label[lang] || obj.label.fr,
    defaultCreditCost: obj.defaultCreditCost,
    emoji: obj.emoji || '',
    color: obj.color || '6B7280',
    displayOrder: obj.displayOrder,
    isActive: obj.isActive,
  };
};

giftTierSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

// ===== Statics =====
giftTierSchema.statics.findByKey = function (key) {
  return this.findOne({ key: String(key).toLowerCase() });
};

module.exports = mongoose.model('GiftTier', giftTierSchema);
