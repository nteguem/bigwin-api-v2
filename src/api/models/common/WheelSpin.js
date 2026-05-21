// src/api/models/common/WheelSpin.js
//
// Historique des spins de la roue — scopé par app (multi-tenant).
// Un document par tour terminé (lot tiré). L'idempotence est garantie par
// l'index unique (appId, nonce) : un même cycle de spin ne peut produire
// qu'un seul WheelSpin.

const mongoose = require('mongoose');

const WheelSpinSchema = new mongoose.Schema({
  // Tenant propriétaire du spin.
  appId: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    ref: 'App'
  },

  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  prize: { type: mongoose.Schema.Types.ObjectId, ref: 'WheelPrize', default: null, index: true },

  // Snapshot du lot au moment du gain — résistant aux modifications admin
  // ultérieures (renommage, suppression, changement de montant cash, etc.)
  prizeSnapshot: {
    name: { fr: String, en: String },
    type: { type: String },
    cash: { amount: Number, currency: String },
    physical: { label: String },
    subscription: {
      packageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Package' },
      durationHours: Number
    },
    freeSpin: { count: Number },
    gift: { tierId: { type: mongoose.Schema.Types.ObjectId, ref: 'GiftTier' } }
  },

  // Référence à l'unlock qui a généré ce spin — pour audit. Dans le flow V2
  // (tickets), le spin est synchrone et n'utilise pas d'UserAccessUnlock —
  // ce champ est donc nullable.
  unlockId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserAccessUnlock',
    default: null,
    index: true
  },

  // Nonce du cycle de spin — UNIQUE par app (cf. index ci-dessous). C'est lui
  // qui garantit l'idempotence, y compris pour les retries client.
  nonce: { type: String, required: true, index: true },

  adsRequired: { type: Number, default: 0 },
  wasFreeSpin: { type: Boolean, default: false },

  // Cycle de vie :
  //   won              : lot tiré (état initial transitoire)
  //   claimed_auto     : crédit auto réussi (cash → wallet | sub créée |
  //                      free spin crédité | cadeau débloqué | dommage)
  //   pending_delivery : lot physique en attente de livraison admin
  //   delivered        : lot physique livré (admin a marqué)
  //   paid             : cash payé hors app (admin a marqué)
  status: {
    type: String,
    enum: ['won', 'claimed_auto', 'pending_delivery', 'delivered', 'paid'],
    default: 'won'
  },

  // Références créées selon le type de lot
  walletTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'WalletTransaction', default: null },
  subscriptionCreated: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription', default: null },
  giftUnlockCreated: { type: mongoose.Schema.Types.ObjectId, ref: 'UserGiftUnlock', default: null },

  // Notes admin (motif livraison, no transaction, etc.)
  adminNotes: { type: String, default: null }
}, { timestamps: true });

// Idempotence du spin — un nonce ne peut produire qu'un WheelSpin par app.
WheelSpinSchema.index({ appId: 1, nonce: 1 }, { unique: true });
WheelSpinSchema.index({ appId: 1, user: 1, createdAt: -1 });
WheelSpinSchema.index({ appId: 1, prize: 1, createdAt: -1 });
WheelSpinSchema.index({ appId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('WheelSpin', WheelSpinSchema);
