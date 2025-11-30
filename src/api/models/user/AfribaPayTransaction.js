// models/user/AfribaPayTransaction.js

const mongoose = require('mongoose');

const afribaPayTransactionSchema = new mongoose.Schema({
  appId: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    ref: 'App'
  },
  
  transactionId: {
    type: String,
    required: true
  },
  
  orderId: {
    type: String,
    required: true
  },
  
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
  
  operator: {
    type: String,
    required: true
  },
  
  country: {
    type: String,
    required: true
  },
  
  phoneNumber: {
    type: String,
    required: true
  },
  
  otpCode: String,
  
  amount: {
    type: Number,
    required: true
  },
  
  currency: {
    type: String,
    required: true
  },
  
  status: {
    type: String,
    default: 'PENDING'
  },
  
  merchantKey: String,
  referenceId: String,
  
  notifyUrl: String,
  returnUrl: String,
  cancelUrl: String,
  
  providerId: String,
  providerLink: String,
  taxes: Number,
  fees: Number,
  feesTaxesTtc: Number,
  amountTotal: Number,
  dateCreated: Date,
  apiRequestId: String,
  apiRequestTime: String,
  apiRequestIp: String,
  
  operatorId: String,
  statusDate: Date,
  
  webhookReceived: {
    type: Boolean,
    default: false
  },
  webhookData: mongoose.Schema.Types.Mixed,
  webhookSignature: String,
  webhookVerified: {
    type: Boolean,
    default: false
  },
  
  lang: {
    type: String,
    default: 'fr'
  },
  clientIp: String,
  userAgent: String,
  
  processed: {
    type: Boolean,
    default: false
  },
  notificationSent: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Indexes
afribaPayTransactionSchema.index({ appId: 1, transactionId: 1 }, { unique: true });
afribaPayTransactionSchema.index({ appId: 1, orderId: 1 }, { unique: true });
afribaPayTransactionSchema.index({ appId: 1, user: 1, status: 1 });
afribaPayTransactionSchema.index({ appId: 1, processed: 1 });
afribaPayTransactionSchema.index({ transactionId: 1 });
afribaPayTransactionSchema.index({ orderId: 1 });
afribaPayTransactionSchema.index({ user: 1, status: 1 });
afribaPayTransactionSchema.index({ processed: 1 });

// Methods
afribaPayTransactionSchema.methods.isSuccessful = function() {
  return this.status === 'SUCCESS';
};

afribaPayTransactionSchema.methods.isPending = function() {
  return this.status === 'PENDING';
};

module.exports = mongoose.model('AfribaPayTransaction', afribaPayTransactionSchema);