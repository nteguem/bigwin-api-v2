// models/user/FlutterwaveTransaction.js

const mongoose = require('mongoose');

const flutterwaveTransactionSchema = new mongoose.Schema({
  // Application
  appId: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    ref: 'App'
  },
  
  // Transaction unique ID (généré par notre système)
  transactionId: {
    type: String,
    required: true
  },
  
  // Flutterwave IDs
  customerId: {
    type: String,
    required: true
  },
  
  paymentMethodId: {
    type: String,
    required: true
  },
  
  chargeId: {
    type: String,
    required: true
  },
  
  // Relations
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
  
  // Montant
  amount: {
    type: Number,
    required: true
  },
  
  currency: {
    type: String,
    required: true,
    uppercase: true,
    enum: ['GHS', 'KES', 'UGX', 'TZS', 'RWF', 'ZMW', 'XOF', 'XAF', 'NGN']
  },
  
  // Status
  status: {
    type: String,
    enum: ['PENDING', 'ACCEPTED', 'REFUSED', 'WAITING_FOR_CUSTOMER', 'CANCELED'],
    default: 'PENDING'
  },
  
  // Mobile Money Information
  phoneNumber: {
    type: String,
    required: true
  },
  
  countryCode: {
    type: String,
    required: true
  },
  
  network: {
    type: String,
    required: true,
    uppercase: true
  },
  
  // Customer Information
  customerName: {
    type: String,
    required: true
  },
  
  customerEmail: {
    type: String
  },
  
  description: String,
  
  // Flutterwave Processor Response
  processorResponse: {
    type: {
      type: String
    },
    code: String
  },
  
  // Payment Details
  paymentDate: Date,
  
  // Next Action (pour le flow)
  nextAction: {
    type: {
      type: String
    },
    paymentInstruction: mongoose.Schema.Types.Mixed,
    redirectUrl: mongoose.Schema.Types.Mixed
  },
  
  // Webhook data
  webhookSignature: String,
  webhookId: String,
  webhookTimestamp: Number,
  webhookEventType: String,
  
  // Fees (si disponible dans la réponse)
  fees: [{
    type: {
      type: String
    },
    amount: Number
  }],
  
  // Processing flag
  processed: {
    type: Boolean,
    default: false
  },
  
  // Error handling
  errorCode: String,
  errorMessage: String,
  errorType: String,
  
  // Metadata for debugging
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Indexes pour performance
flutterwaveTransactionSchema.index({ appId: 1, transactionId: 1 }, { unique: true });
flutterwaveTransactionSchema.index({ appId: 1, user: 1, status: 1 });
flutterwaveTransactionSchema.index({ appId: 1, chargeId: 1 });
flutterwaveTransactionSchema.index({ appId: 1, customerId: 1 });
flutterwaveTransactionSchema.index({ appId: 1, processed: 1 });
flutterwaveTransactionSchema.index({ transactionId: 1 });
flutterwaveTransactionSchema.index({ chargeId: 1 });
flutterwaveTransactionSchema.index({ user: 1, status: 1 });
flutterwaveTransactionSchema.index({ processed: 1 });

// Methods
flutterwaveTransactionSchema.methods.isSuccessful = function() {
  return this.status === 'ACCEPTED';
};

flutterwaveTransactionSchema.methods.isPending = function() {
  return this.status === 'PENDING';
};

flutterwaveTransactionSchema.methods.isFailed = function() {
  return this.status === 'REFUSED' || this.status === 'CANCELED';
};

flutterwaveTransactionSchema.methods.isWaitingForCustomer = function() {
  return this.status === 'WAITING_FOR_CUSTOMER';
};

module.exports = mongoose.model('FlutterwaveTransaction', flutterwaveTransactionSchema);