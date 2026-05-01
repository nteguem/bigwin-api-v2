// src/api/models/common/Gift.js
//
// Catalogue de cadeaux débloquables via crédits.
//
// 2 types :
//   - 'static' : contenu fixe (PDF/HTML/audio/vidéo). Un déblocage = accès à vie.
//   - 'ai'    : contenu généré à la demande via IA, à partir d'un formulaire.
//               Un déblocage + rate-limit pour les générations futures.
//
// Le tier (Bronze/Argent/Or/Diamant/…) est référencé via le modèle GiftTier.
// Le coût effectif d'un cadeau = `customCreditCost` si défini,
// sinon `tier.defaultCreditCost`.
//
// Pas de cascade automatique : modifier un GiftTier ne change pas
// rétroactivement les Gifts qui n'ont pas customCreditCost. Le calcul est
// fait au runtime (via populate). Cohérent et prévisible.

const mongoose = require('mongoose');

const i18nField = {
  fr: { type: String, trim: true },
  en: { type: String, trim: true },
};

const formFieldSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    label: i18nField,
    type: {
      type: String,
      enum: ['text', 'textarea', 'select', 'number'],
      default: 'text',
    },
    options: [
      {
        value: { type: String },
        label: i18nField,
      },
    ],
    required: { type: Boolean, default: false },
    placeholder: i18nField,
  },
  { _id: false }
);

const giftSchema = new mongoose.Schema(
  {
    appId: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      ref: 'App',
    },

    type: {
      type: String,
      enum: ['static', 'ai'],
      required: true,
    },

    // Référence vers le tier (Bronze, Or, …). Source de vérité du coût par
    // défaut. Toujours populé en lecture pour calculer effectiveCost.
    tier: {
      type: mongoose.Schema.ObjectId,
      ref: 'GiftTier',
      required: [true, 'tier requis'],
    },

    // Override admin du coût défaut du tier. null/undefined → utiliser
    // tier.defaultCreditCost.
    customCreditCost: {
      type: Number,
      min: 0,
      default: null,
    },

    category: {
      type: String,
      enum: [
        'sports',
        'productivity',
        'career',
        'finance',
        'lifestyle',
        'mindset',
        'business',
      ],
      default: 'sports',
    },

    title: {
      fr: { type: String, required: true, trim: true },
      en: { type: String, required: true, trim: true },
    },

    description: {
      fr: { type: String, required: true, trim: true },
      en: { type: String, required: true, trim: true },
    },

    thumbnail: { type: String, trim: true },

    // Image preview affichée comme thumbnail dans le catalogue + hero sur
    // l'écran détail. Toujours une image (PNG/JPG/WebP) — uploadée ou URL externe.
    // Inspiré des plateformes type Gumroad : on voit toujours un visuel
    // avant de débloquer.
    previewImageUrl: { type: String, trim: true },

    // ===== Champs static =====
    staticFormat: {
      type: String,
      enum: ['pdf', 'video', 'audio', 'html', 'zip', 'image'],
    },
    contentUrl: { type: String, trim: true },
    htmlContent: { type: String },

    // ===== Champs ai =====
    formSchema: [formFieldSchema],
    promptTemplate: { type: String },
    outputFormat: {
      type: String,
      enum: ['html', 'pdf', 'text'],
      default: 'html',
    },
    rateLimitPerWeek: {
      type: Number,
      min: 1,
      default: 1,
    },
    aiModel: {
      type: String,
      default: 'gemini-2.5-flash-lite',
    },

    // Marketing : cadeau accessible aux non-payants comme appât/teaser.
    isFreeTeaser: { type: Boolean, default: false },

    isActive: { type: Boolean, default: true },

    sortOrder: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

// ===== Indexes =====
giftSchema.index({ appId: 1, isActive: 1, sortOrder: 1 });
giftSchema.index({ appId: 1, type: 1 });
giftSchema.index({ appId: 1, tier: 1 });
giftSchema.index({ appId: 1, isFreeTeaser: 1 });

// ===== Pre-save validation type-spécifique =====
giftSchema.pre('save', function (next) {
  if (this.type === 'static') {
    if (!this.contentUrl && !this.htmlContent) {
      return next(new Error('Un cadeau statique doit avoir contentUrl OU htmlContent'));
    }
    if (!this.staticFormat) {
      return next(new Error('Un cadeau statique doit avoir un staticFormat'));
    }
  } else if (this.type === 'ai') {
    if (!this.promptTemplate || this.promptTemplate.trim().length < 10) {
      return next(new Error('Un cadeau IA doit avoir un promptTemplate'));
    }
    if (!Array.isArray(this.formSchema) || this.formSchema.length === 0) {
      return next(new Error('Un cadeau IA doit avoir au moins 1 champ dans formSchema'));
    }
    const promptVars = (this.promptTemplate.match(/\{(\w+)\}/g) || []).map((v) =>
      v.slice(1, -1)
    );
    const fieldNames = this.formSchema.map((f) => f.name);
    const missing = promptVars.filter((v) => !fieldNames.includes(v));
    if (missing.length > 0) {
      return next(
        new Error(`Variables du prompt sans champ correspondant: ${missing.join(', ')}`)
      );
    }
  }
  next();
});

// ===== Calcul du coût effectif (nécessite un tier populé) =====
//
// Convention : on appelle ce helper UNIQUEMENT après populate('tier').
// En cas d'absence de tier populé, on retourne customCreditCost (ou 0).
function computeEffectiveCost(gift) {
  if (gift.isFreeTeaser) return 0;
  if (gift.customCreditCost !== null && gift.customCreditCost !== undefined) {
    return gift.customCreditCost;
  }
  // tier peut être un ObjectId (non populé) ou un doc populé
  if (gift.tier && typeof gift.tier === 'object' && 'defaultCreditCost' in gift.tier) {
    return gift.tier.defaultCreditCost;
  }
  return 0;
}

// ===== Methods =====
giftSchema.methods.getEffectiveCost = function () {
  return computeEffectiveCost(this);
};

giftSchema.methods.formatForLanguage = function (lang = 'fr') {
  const obj = this.toObject();
  const pickI18n = (f) => (f ? f[lang] || f.fr || '' : '');

  // Sérialisation propre du tier (populé ou non)
  let tierSerialized = null;
  if (obj.tier && typeof obj.tier === 'object' && obj.tier.key) {
    tierSerialized = {
      _id: obj.tier._id,
      key: obj.tier.key,
      label: pickI18n(obj.tier.label),
      defaultCreditCost: obj.tier.defaultCreditCost,
      emoji: obj.tier.emoji || '',
      color: obj.tier.color || '6B7280',
      displayOrder: obj.tier.displayOrder,
    };
  }

  return {
    _id: obj._id,
    appId: obj.appId,
    type: obj.type,
    tier: tierSerialized,
    customCreditCost: obj.customCreditCost ?? null,
    creditCost: computeEffectiveCost(this),
    category: obj.category,
    title: pickI18n(obj.title),
    description: pickI18n(obj.description),
    thumbnail: obj.thumbnail || null,
    previewImageUrl: obj.previewImageUrl || null,
    staticFormat: obj.staticFormat || null,
    outputFormat: obj.outputFormat || null,
    rateLimitPerWeek: obj.rateLimitPerWeek || null,
    isFreeTeaser: obj.isFreeTeaser,
    isActive: obj.isActive,
    sortOrder: obj.sortOrder,
    formSchema:
      obj.type === 'ai'
        ? (obj.formSchema || []).map((f) => ({
            name: f.name,
            label: pickI18n(f.label),
            type: f.type,
            options: (f.options || []).map((o) => ({
              value: o.value,
              label: pickI18n(o.label),
            })),
            required: f.required,
            placeholder: pickI18n(f.placeholder),
          }))
        : undefined,
  };
};

giftSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.__v;
  obj.creditCost = computeEffectiveCost(this);
  return obj;
};

// ===== Helper exposé =====
giftSchema.statics.computeEffectiveCost = computeEffectiveCost;

module.exports = mongoose.model('Gift', giftSchema);
