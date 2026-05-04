// src/api/models/common/GiftReview.js
//
// Avis utilisateur sur un cadeau. Note 1-5 étoiles + commentaire libre.
//
// Règles métier :
//   - Un user ne peut laisser QU'UN seul avis par cadeau (index unique
//     `(gift, user)`). Pour modifier, il fait un upsert via le même
//     endpoint POST.
//   - L'user doit avoir débloqué le cadeau OU c'est un cadeau gratuit
//     (vérifié au niveau service, pas au niveau modèle — pour permettre
//     les avis sur les freeTeasers).
//   - Pas d'auto-modération : tous les avis sont visibles. Les admin
//     peuvent supprimer manuellement via le backoffice (Phase admin
//     plus tard).
//
// Pas de cascade automatique : si un cadeau est désactivé, ses avis
// restent en BD (historique préservé). Un script de cleanup peut être
// ajouté plus tard si besoin.

const mongoose = require('mongoose');

const giftReviewSchema = new mongoose.Schema(
  {
    appId: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    gift: {
      type: mongoose.Schema.ObjectId,
      ref: 'Gift',
      required: true,
    },

    user: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: true,
    },

    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },

    comment: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: '',
    },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

// ===== Indexes =====
// Un user = UN seul avis par cadeau (édition via upsert)
giftReviewSchema.index({ gift: 1, user: 1 }, { unique: true });
// Pour la liste paginée par cadeau (tri du plus récent)
giftReviewSchema.index({ gift: 1, createdAt: -1 });

giftReviewSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('GiftReview', giftReviewSchema);
