// src/api/models/common/UserGiftUnlock.js
//
// Trace de quel utilisateur a débloqué quel cadeau.
// Une fois débloqué : accès à vie (le contenu reste accessible).
//
// Pour les cadeaux IA : la collection `generations` enregistre chaque
// génération (input formulaire + output produit). Sert aussi à appliquer
// le rate limit (X générations par semaine).
//
// Index unique (appId, user, gift) : garantit qu'on ne peut pas débloquer
// 2 fois le même cadeau, MÊME SI l'API foire ou qu'il y a un double-clic.

const mongoose = require('mongoose');

const generationSchema = new mongoose.Schema(
  {
    formData: { type: mongoose.Schema.Types.Mixed }, // input utilisateur
    output: { type: String }, // HTML/text/URL pdf
    outputFormat: {
      type: String,
      enum: ['html', 'pdf', 'text'],
      default: 'html',
    },
    aiModel: { type: String },
    tokensUsed: { type: Number },
    durationMs: { type: Number },
    generatedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const userGiftUnlockSchema = new mongoose.Schema({
  appId: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    ref: 'App',
  },

  user: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true,
  },

  gift: {
    type: mongoose.Schema.ObjectId,
    ref: 'Gift',
    required: true,
  },

  unlockedAt: { type: Date, default: Date.now },

  generations: [generationSchema],

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// ===== Indexes =====
// Anti-doublon STRICT : 1 unlock max par (user, gift) sur un app donné
userGiftUnlockSchema.index(
  { appId: 1, user: 1, gift: 1 },
  { unique: true, name: 'unlock_user_gift_app_unique' }
);
userGiftUnlockSchema.index({ appId: 1, user: 1, unlockedAt: -1 });
userGiftUnlockSchema.index({ appId: 1, gift: 1 });

// ===== Methods =====

// Compte les générations dans les 7 derniers jours (rolling window)
userGiftUnlockSchema.methods.countGenerationsLast7Days = function () {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return (this.generations || []).filter(
    (g) => g.generatedAt && g.generatedAt > sevenDaysAgo
  ).length;
};

// Vérifie si l'user peut générer (dans la limite hebdomadaire du gift)
userGiftUnlockSchema.methods.canGenerate = function (rateLimitPerWeek) {
  const limit = rateLimitPerWeek || 1;
  return this.countGenerationsLast7Days() < limit;
};

userGiftUnlockSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('UserGiftUnlock', userGiftUnlockSchema);
