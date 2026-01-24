// src/api/models/common/Subscription.js

const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  appId: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    ref: 'App'
  },
  
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
  
  startDate: {
    type: Date,
    default: Date.now
  },
  
  endDate: {
    type: Date,
    required: true
  },
  
  pricing: {
    amount: {
      type: Number,
      required: true
    },
    currency: {
      type: String,
      required: true,
      // ⭐ AJOUT DES DEVISES KORAPAY
      enum: [
        'XAF',  // CFA Franc BEAC (Cameroun, etc.)
        'XOF',  // CFA Franc BCEAO (Côte d'Ivoire, etc.)
        'GMD',  // Gambian Dalasi
        'CDF',  // Congolese Franc
        'GNF',  // Guinean Franc
        'USD',  // US Dollar
        'EUR',  // Euro
        // Nouvelles devises KoraPay
        'NGN',  // Nigerian Naira
        'KES',  // Kenyan Shilling
        'GHS',  // Ghanaian Cedi
        'EGP',  // Egyptian Pound
        'TZS',  // Tanzanian Shilling
        'ZAR'   // South African Rand
      ],
      default: 'XAF'
    }
  },
  
  status: {
    type: String,
    enum: ['active', 'expired', 'cancelled'],
    default: 'active'
  },
  
  paymentReference: String,
  
  paymentProvider: {
    type: String,
    enum: ['MOBILE_MONEY', 'GOOGLE_PLAY'],
    default: 'MOBILE_MONEY',
    required: true
  },

  googlePlayTransaction: {
    type: mongoose.Schema.ObjectId,
    ref: 'GooglePlayTransaction'
  },

  autoRenewing: {
    type: Boolean,
    default: false
  },

  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes
subscriptionSchema.index({ appId: 1, user: 1, status: 1 });
subscriptionSchema.index({ appId: 1, endDate: 1 });
subscriptionSchema.index({ appId: 1, status: 1 });
subscriptionSchema.index({ appId: 1, package: 1 });
subscriptionSchema.index({ appId: 1, user: 1, endDate: -1 });
subscriptionSchema.index({ user: 1, status: 1 });
subscriptionSchema.index({ endDate: 1 });
subscriptionSchema.index({ status: 1 });

// Methods
subscriptionSchema.methods.isActive = function() {
  return this.status === 'active' && this.endDate > new Date();
};

subscriptionSchema.methods.expire = function() {
  this.status = 'expired';
  return this.save();
};

subscriptionSchema.methods.cancel = function() {
  this.status = 'cancelled';
  return this.save();
};

subscriptionSchema.methods.toJSON = function() {
  const subscription = this.toObject();
  delete subscription.__v;
  return subscription;
};

// Hooks
subscriptionSchema.pre('find', function() {
  this.where({ endDate: { $gt: new Date() } });
});

subscriptionSchema.pre('findOne', function() {
  if (this.getQuery().status === 'active') {
    this.where({ endDate: { $gt: new Date() } });
  }
});

module.exports = mongoose.model('Subscription', subscriptionSchema);