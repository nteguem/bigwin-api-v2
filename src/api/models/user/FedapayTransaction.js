// src/api/models/user/FedapayTransaction.js

const mongoose = require('mongoose');

const fedapayTransactionSchema = new mongoose.Schema({
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
  
  paymentToken: String,
  paymentUrl: String,
  
  amount: {
    type: Number,
    required: true
  },
  
  currency: {
    type: String,
    enum: ['XOF', 'GNF', 'EUR', 'USD', 'GBP'],
    default: 'XOF'
  },
  
  status: {
    type: String,
    enum: ['pending', 'approved', 'declined', 'canceled', 'refunded', 'transferred', 'expired'],
    default: 'pending'
  },
  
  phoneNumber: String,
  customerName: String,
  customerEmail: String,
  description: String,
  
  paymentMethod: String,
  operatorTransactionId: String,
  paymentDate: Date,
  
  notifyUrl: String,
  returnUrl: String,
  
  // Champs webhook
  webhookData: mongoose.Schema.Types.Mixed,
  
  errorCode: String,
  errorMessage: String,
  
  processed: {
    type: Boolean,
    default: false
  },
  
  // Champs merchant_reference et custom_metadata
  merchantReference: String,
  customMetadata: mongoose.Schema.Types.Mixed
  
}, {
  timestamps: true
});

// Indexes
fedapayTransactionSchema.index({ appId: 1, transactionId: 1 }, { unique: true });
fedapayTransactionSchema.index({ appId: 1, user: 1, status: 1 });
fedapayTransactionSchema.index({ appId: 1, paymentToken: 1 });
fedapayTransactionSchema.index({ appId: 1, processed: 1 });
fedapayTransactionSchema.index({ appId: 1, merchantReference: 1 });
fedapayTransactionSchema.index({ transactionId: 1 });
fedapayTransactionSchema.index({ user: 1, status: 1 });
fedapayTransactionSchema.index({ processed: 1 });

// Methods
fedapayTransactionSchema.methods.isSuccessful = function() {
  return this.status === 'approved';
};

fedapayTransactionSchema.methods.isPending = function() {
  return this.status === 'pending';
};

module.exports = mongoose.model('FedapayTransaction', fedapayTransactionSchema);