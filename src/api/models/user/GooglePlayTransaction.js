// models/user/GooglePlayTransaction.js

const mongoose = require('mongoose');

const googlePlayTransactionSchema = new mongoose.Schema({
  appId: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    ref: 'App'
  },
  
  purchaseToken: {
    type: String,
    required: true
  },
  orderId: String,
  productId: String,
  
  user: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  },
  
  package: {
    type: mongoose.Schema.ObjectId,
    ref: 'Package',
    required: true
  },
  
  subscription: {
    type: mongoose.Schema.ObjectId,
    ref: 'Subscription'
  },
  
  status: {
    type: String,
    enum: ['ACTIVE', 'EXPIRED', 'CANCELED', 'ON_HOLD', 'PAUSED'],
    default: 'ACTIVE'
  },
  
  startTime: Date,
  expiryTime: Date,
  purchaseTime: Date,
  
  priceAmountMicros: Number,
  priceCurrencyCode: String,
  
  autoRenewing: {
    type: Boolean,
    default: true
  },
  
  acknowledged: {
    type: Boolean,
    default: false
  },
  
  lastNotificationType: Number,
  lastNotificationTime: Date,

  purchaseType: {
    type: String,
    enum: ['SUBSCRIPTION', 'ONE_TIME_PRODUCT'],
    default: 'SUBSCRIPTION'
  },

  consumptionState: {
    type: String,
    enum: ['YET_TO_BE_CONSUMED', 'CONSUMED'],
    default: 'YET_TO_BE_CONSUMED'
  },

  quantity: {
    type: Number,
    default: 1,
    min: 1,
    validate: {
      validator: function(value) {
        return Number.isInteger(value) && value >= 1;
      },
      message: 'La quantité doit être un entier positif >= 1'
    }
  },

  refundableQuantity: {
    type: Number,
    default: function() {
      return this.quantity || 1;
    },
    min: 0
  }
}, {
  timestamps: true
});

// Indexes
googlePlayTransactionSchema.index({ appId: 1, purchaseToken: 1 }, { unique: true });
googlePlayTransactionSchema.index({ appId: 1, user: 1, status: 1 });
googlePlayTransactionSchema.index({ appId: 1, user: 1, purchaseType: 1 });
googlePlayTransactionSchema.index({ user: 1, status: 1 });
googlePlayTransactionSchema.index({ purchaseToken: 1 });
googlePlayTransactionSchema.index({ user: 1, purchaseType: 1 });

// Methods
googlePlayTransactionSchema.methods.isOneTimeProduct = function() {
  return this.purchaseType === 'ONE_TIME_PRODUCT';
};

googlePlayTransactionSchema.methods.isSubscription = function() {
  return this.purchaseType === 'SUBSCRIPTION' || !this.purchaseType;
};

googlePlayTransactionSchema.methods.isConsumed = function() {
  return this.consumptionState === 'CONSUMED';
};

googlePlayTransactionSchema.methods.consume = async function() {
  if (this.purchaseType !== 'ONE_TIME_PRODUCT') {
    throw new Error('Seuls les produits ponctuels peuvent être consommés');
  }
  
  this.consumptionState = 'CONSUMED';
  return await this.save();
};

googlePlayTransactionSchema.methods.isActive = function() {
  return this.status === 'ACTIVE' && this.expiryTime > new Date();
};

module.exports = mongoose.model('GooglePlayTransaction', googlePlayTransactionSchema);