// models/user/CinetpayTransaction.js

const mongoose = require('mongoose');

const cinetpayTransactionSchema = new mongoose.Schema({
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
    default: 'XOF'
  },
  
  status: {
    type: String,
    enum: ['PENDING', 'ACCEPTED', 'REFUSED', 'WAITING_FOR_CUSTOMER', 'CANCELED'],
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
  
  description: String,
  paymentMethod: String,
  operatorTransactionId: String,
  paymentDate: Date,
  fundAvailabilityDate: Date,
  
  notifyUrl: String,
  returnUrl: String,
  
  apiResponseId: String,
  
  cpmTransDate: Date,
  cpmErrorMessage: String,
  cpmPhonePrefix: String,
  cpmLanguage: String,
  cpmVersion: String,
  cpmPaymentConfig: String,
  cpmPageAction: String,
  cpmCustom: String,
  cpmDesignation: String,
  webhookSignature: String,
  
  errorCode: String,
  errorMessage: String,
  
  processed: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Indexes
cinetpayTransactionSchema.index({ appId: 1, transactionId: 1 }, { unique: true });
cinetpayTransactionSchema.index({ appId: 1, user: 1, status: 1 });
cinetpayTransactionSchema.index({ appId: 1, paymentToken: 1 });
cinetpayTransactionSchema.index({ appId: 1, processed: 1 });
cinetpayTransactionSchema.index({ transactionId: 1 });
cinetpayTransactionSchema.index({ user: 1, status: 1 });
cinetpayTransactionSchema.index({ paymentToken: 1 });
cinetpayTransactionSchema.index({ processed: 1 });

// Methods
cinetpayTransactionSchema.methods.isSuccessful = function() {
  return this.status === 'ACCEPTED';
};

cinetpayTransactionSchema.methods.isPending = function() {
  return this.status === 'PENDING';
};

module.exports = mongoose.model('CinetpayTransaction', cinetpayTransactionSchema);