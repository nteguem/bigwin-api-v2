// src/api/models/common/Gift.js
//
// Catalogue de cadeaux. Modèle "tier access" : un Gift est attaché à un
// tier (Bronze/Argent/Or/Diamant/…). L'utilisateur a accès à un cadeau si
// son `package.giftTier.displayOrder` >= celui du cadeau (cumulatif).
//
// 2 types :
//   - 'static' : contenu fixe (PDF/HTML/audio/vidéo). Un déblocage = accès à vie.
//   - 'ai'    : contenu généré à la demande via IA, à partir d'un formulaire.
//               Un déblocage + rate-limit pour les générations futures.

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

    // Référence vers le tier (Bronze, Or, …). Détermine quels users ont
    // accès à ce cadeau via leur sub active.
    tier: {
      type: mongoose.Schema.ObjectId,
      ref: 'GiftTier',
      required: [true, 'tier requis'],
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

    // ===== Country targeting (multi-pays) =====
    //
    // Liste optionnelle de codes pays ISO-2 (ex: ['CM', 'CI', 'BJ']).
    //   - Tableau VIDE ou ABSENT → cadeau universel (visible partout)
    //   - Tableau avec codes      → visible UNIQUEMENT aux users de
    //                              ces pays
    //
    // Logique côté listCatalog :
    //   user country=CM → renvoie [countries vide] ∪ [countries contient 'CM']
    //   user country=null → renvoie [countries vide] uniquement
    countries: {
      type: [String],
      default: [],
      set: (arr) => (arr || [])
        .map((c) => (typeof c === 'string' ? c.trim().toUpperCase() : ''))
        .filter((c) => c.length === 2),
    },

    // ===== Médias localisables =====
    //
    // Stockés en `Mixed` pour accepter :
    //   - une string simple (legacy, non-localisée) → utilisée pour
    //     toutes les langues
    //   - un objet { fr, en } → URL différente par langue
    // `formatForLanguage` résout au runtime selon le `lang` demandé.
    thumbnail: { type: mongoose.Schema.Types.Mixed, default: null },
    previewImageUrl: { type: mongoose.Schema.Types.Mixed, default: null },

    // ===== Champs static =====
    staticFormat: {
      type: String,
      enum: ['pdf', 'video', 'audio', 'html', 'zip', 'image'],
    },
    contentUrl: { type: mongoose.Schema.Types.Mixed, default: null },
    htmlContent: { type: mongoose.Schema.Types.Mixed, default: null },

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

    // ===== Métadonnées d'enrichissement (page de détail mobile) =====
    //
    // Ces champs alimentent l'écran détail "rich" inspiré des stores
    // d'apps/livres : tags pour catégoriser, learning points en bullets,
    // métriques pages/temps de lecture pour donner une idée du contenu.
    // Tous OPTIONNELS — un cadeau peut être affiché sans mais ses
    // sections détail seront masquées si vides.

    /// Tags courts en mode catégorie (ex: ["Pari sportif", "Débutant"]).
    /// Localisés FR/EN. Affichés en chips sous la description du détail.
    tags: [
      {
        fr: { type: String, trim: true },
        en: { type: String, trim: true },
        _id: false,
      },
    ],

    /// "Ce que tu vas apprendre" — bullets list des points clés du
    /// contenu. Localisés. Skippés si vide à l'affichage.
    learningPoints: [
      {
        fr: { type: String, trim: true },
        en: { type: String, trim: true },
        _id: false,
      },
    ],

    /// Pour les contenus paginables (PDF, Article) — nombre de pages.
    /// Affiché dans la grid de stats du détail. null si non applicable.
    pages: { type: Number, min: 0, default: null },

    /// Estimation du temps de lecture/écoute/visionnage en minutes.
    /// Affiché dans la grid de stats. null si non applicable.
    durationMinutes: { type: Number, min: 0, default: null },

    // Marketing : cadeau accessible aux non-payants comme appât/teaser.
    isFreeTeaser: { type: Boolean, default: false },

    // Compteur de lectures — incrémenté atomiquement à chaque ouverture
    // de contenu (getStaticContent / generate). Sert pour les analytics
    // et l'affichage social proof côté mobile ("234 lectures").
    readCount: { type: Number, default: 0, min: 0 },

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

// ===== Methods =====
giftSchema.methods.formatForLanguage = function (lang = 'fr') {
  const obj = this.toObject();
  const pickI18n = (f) => (f ? f[lang] || f.fr || '' : '');

  /// Résout un champ "media" qui peut être stocké soit comme :
  ///   - string legacy → utilisé pour toutes les langues
  ///   - objet { fr, en } → la bonne URL par langue, fallback sur fr
  /// Renvoie une string ou null.
  const pickLocalizedMedia = (field) => {
    if (field == null || field === '') return null;
    if (typeof field === 'string') return field;
    if (typeof field === 'object') {
      const v = field[lang] || field.fr || field.en || null;
      return (typeof v === 'string' && v.length > 0) ? v : null;
    }
    return null;
  };

  // Sérialisation propre du tier (populé ou non)
  let tierSerialized = null;
  if (obj.tier && typeof obj.tier === 'object' && obj.tier.key) {
    tierSerialized = {
      _id: obj.tier._id,
      key: obj.tier.key,
      label: pickI18n(obj.tier.label),
      emoji: obj.tier.emoji || '',
      color: obj.tier.color || '6B7280',
      displayOrder: obj.tier.displayOrder,
    };
  }

  // Localisation des collections de strings i18n (tags, learningPoints).
  // On filtre les entrées vides pour garder un payload propre.
  const localizeI18nList = (arr) =>
    (arr || [])
      .map((it) => pickI18n(it))
      .filter((s) => typeof s === 'string' && s.length > 0);

  return {
    _id: obj._id,
    appId: obj.appId,
    type: obj.type,
    tier: tierSerialized,
    category: obj.category,
    title: pickI18n(obj.title),
    description: pickI18n(obj.description),
    thumbnail: pickLocalizedMedia(obj.thumbnail),
    previewImageUrl: pickLocalizedMedia(obj.previewImageUrl),
    contentUrl: pickLocalizedMedia(obj.contentUrl),
    htmlContent: pickLocalizedMedia(obj.htmlContent),
    countries: Array.isArray(obj.countries) ? obj.countries : [],
    staticFormat: obj.staticFormat || null,
    outputFormat: obj.outputFormat || null,
    rateLimitPerWeek: obj.rateLimitPerWeek || null,

    // Métadonnées d'enrichissement page détail
    tags: localizeI18nList(obj.tags),
    learningPoints: localizeI18nList(obj.learningPoints),
    pages: obj.pages ?? null,
    durationMinutes: obj.durationMinutes ?? null,
    readCount: obj.readCount ?? 0,

    isFreeTeaser: obj.isFreeTeaser,
    isActive: obj.isActive,
    sortOrder: obj.sortOrder,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
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
  return obj;
};

module.exports = mongoose.model('Gift', giftSchema);
