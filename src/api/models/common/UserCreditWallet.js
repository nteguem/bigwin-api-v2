// src/api/models/common/UserCreditWallet.js
//
// Portefeuille "crédits cadeau" par (user, app).
// En mobile l'utilisateur voit ces crédits sous le nom "cadeaux".
//
// Règle d'or : TOUTE opération wallet passe par les méthodes dédiées
// (creditWallet / debitWallet du service) qui :
//   - opèrent en atomique via findOneAndUpdate
//   - loggent dans `history` (audit complet)
//   - sont idempotentes côté credit (vérification de refId/source)
//
// Les crédits NE PÉRIMENT JAMAIS.
// Solde dispo = totalCredits - usedCredits.

const mongoose = require('mongoose');

const HISTORY_SOURCES = [
  'subscription',     // crédité suite à un achat de package
  'gift_unlock',      // débité suite au déblocage d'un cadeau
  'admin_grant',      // ajout manuel par un admin
  'admin_adjust',     // correction manuelle (peut être négatif)
  'promo',            // crédité via une promo / campagne
];

const historyEntrySchema = new mongoose.Schema(
  {
    delta: { type: Number, required: true }, // +N (credit) ou -N (debit)
    source: { type: String, enum: HISTORY_SOURCES, required: true },
    refId: { type: mongoose.Schema.Types.ObjectId }, // subscription / gift / admin
    refModel: { type: String }, // 'Subscription' | 'Gift' | 'Admin'
    note: { type: String, trim: true },
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);

const userCreditWalletSchema = new mongoose.Schema({
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

  totalCredits: {
    type: Number,
    default: 0,
    min: 0,
  },

  usedCredits: {
    type: Number,
    default: 0,
    min: 0,
  },

  history: [historyEntrySchema],

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// ===== Indexes =====
// Unicité : 1 wallet par (user, app)
userCreditWalletSchema.index(
  { appId: 1, user: 1 },
  { unique: true, name: 'wallet_user_app_unique' }
);
// Recherche idempotence credit
userCreditWalletSchema.index({ appId: 1, user: 1, 'history.source': 1, 'history.refId': 1 });

// ===== Methods =====
userCreditWalletSchema.methods.getAvailable = function () {
  return Math.max(0, (this.totalCredits || 0) - (this.usedCredits || 0));
};

userCreditWalletSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.__v;
  obj.availableCredits = Math.max(0, (obj.totalCredits || 0) - (obj.usedCredits || 0));
  return obj;
};

userCreditWalletSchema.statics.HISTORY_SOURCES = HISTORY_SOURCES;

module.exports = mongoose.model('UserCreditWallet', userCreditWalletSchema);
