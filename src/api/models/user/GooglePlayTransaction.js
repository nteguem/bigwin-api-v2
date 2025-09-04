const mongoose = require('mongoose');

const googlePlayTransactionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  package: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Package',
    required: true
  },
  purchaseToken: {
    type: String,
    required: true,
    unique: true
  },
  orderId: {
    type: String,
    required: true
  },
  productId: {
    type: String,
    required: true
  },
  purchaseTime: {
    type: Date,
    required: true
  },
  expiryTime: {
    type: Date // Pour les abonnements récurrents
  },
  autoRenewing: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: [
      'pending',
      'verified', 
      'cancelled',
      'expired',
      'revoked',
      'renewed'
    ],
    default: 'pending'
  },
  subscriptionState: {
    type: Number // État Google Play (0=pending, 1=active, etc.)
  },
  cancelReason: {
    type: Number // Raison annulation Google Play
  },
  priceAmountMicros: {
    type: String // Prix en micro-unités de Google
  },
  priceCurrencyCode: {
    type: String // Code devise de Google
  },
  googleResponse: {
    type: Object // Réponse complète Google Play API
  },
  webhookEvents: [{
    event_type: String,
    received_at: { type: Date, default: Date.now },
    processed: { type: Boolean, default: false }
  }]
}, {
  timestamps: true
});

// Index pour optimisation
googlePlayTransactionSchema.index({ user: 1, status: 1 });
googlePlayTransactionSchema.index({ purchaseToken: 1 });
googlePlayTransactionSchema.index({ productId: 1 });

module.exports = mongoose.model('GooglePlayTransaction', googlePlayTransactionSchema);