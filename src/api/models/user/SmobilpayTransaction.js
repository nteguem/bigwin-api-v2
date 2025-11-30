// models/user/SmobilpayTransaction.js

const mongoose = require('mongoose');

const smobilpayTransactionSchema = new mongoose.Schema({
  appId: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    ref: 'App'
  },
  
  paymentId: {
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
  
  serviceId: {
    type: String,
    required: true
  },
  
  operatorName: {
    type: String,
    required: true
  },
  
  payItemId: {
    type: String,
    required: true
  },
  
  amount: {
    type: Number,
    required: true
  },
  
  currency: {
    type: String,
    default: 'XAF',
    enum: ['XAF', 'XOF', 'GMD', 'CDF', 'GNF']
  },
  
  status: {
    type: String,
    enum: ['PENDING', 'SUCCESS', 'ERROR'],
    default: 'PENDING'
  },
  
  phoneNumber: {
    type: String,
    required: true
  },
  
  customerName: {
    type: String,
    required: true
  },
  
  email: String,
  
  ptn: String,
  quoteId: String,
  receiptNumber: String,
  veriCode: String,
  timestamp: Date,
  clearingDate: Date,
  priceLocalCur: String,
  pin: String,
  tag: String,
  errorCode: String,
  
  processed: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Indexes
smobilpayTransactionSchema.index({ appId: 1, paymentId: 1 }, { unique: true });
smobilpayTransactionSchema.index({ appId: 1, user: 1, status: 1 });
smobilpayTransactionSchema.index({ appId: 1, ptn: 1 });
smobilpayTransactionSchema.index({ appId: 1, processed: 1 });
smobilpayTransactionSchema.index({ user: 1, status: 1 });
smobilpayTransactionSchema.index({ paymentId: 1 });
smobilpayTransactionSchema.index({ ptn: 1 });
smobilpayTransactionSchema.index({ processed: 1 });

// Methods
smobilpayTransactionSchema.methods.isSuccessful = function() {
  return this.status === 'SUCCESS';
};

smobilpayTransactionSchema.methods.isPending = function() {
  return this.status === 'PENDING';
};

module.exports = mongoose.model('SmobilpayTransaction', smobilpayTransactionSchema);