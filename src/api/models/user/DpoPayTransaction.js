// models/user/DpoPayTransaction.js
const mongoose = require('mongoose');

const dpoPayTransactionSchema = new mongoose.Schema({
  // Identifiants
  transactionToken: {
    type: String,
    required: true,
    unique: true // Token retourné par DPO
  },
  orderId: {
    type: String,
    required: true,
    unique: true // Notre référence unique
  },
  companyRef: {
    type: String,
    required: true // Référence pour DPO (peut être = orderId)
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
  
  // Informations de paiement
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    required: true // XAF, USD, etc.
  },
  phoneNumber: {
    type: String,
    required: true
  },
  
  // Configuration DPO
  companyToken: {
    type: String,
    required: true // 8F2ADF51-1B25-4FA8-94BD-0DB2AD4BDFC5
  },
  serviceType: {
    type: String,
    required: true // 106074
  },
  
  // URLs
  redirectUrl: String,
  backUrl: String,
  
  // Checkout
  checkoutUrl: {
    type: String // URL de paiement générée
  },
  
  // Statut
  status: {
    type: String,
    enum: ['PENDING', 'PAID', 'CANCELLED', 'FAILED'],
    default: 'PENDING'
  },
  
  // Données de vérification (verifyToken response)
  transactionApproval: String, // Code d'approbation
  transactionCurrency: String,
  transactionAmount: Number,
  transactionNetAmount: Number,
  transactionSettlementDate: Date,
  customerName: String,
  customerPhone: String,
  customerEmail: String,
  customerCountry: String,
  customerCity: String,
  fraudAlert: String,
  fraudExplanation: String,
  
  // Webhook
  webhookReceived: {
    type: Boolean,
    default: false
  },
  webhookData: mongoose.Schema.Types.Mixed,
  
  // Processing
  processed: {
    type: Boolean,
    default: false
  },
  verifiedAt: Date,
  
  // Metadata
  userAgent: String,
  clientIp: String,
  
}, {
  timestamps: true
});

// Index
dpoPayTransactionSchema.index({ transactionToken: 1 });
dpoPayTransactionSchema.index({ orderId: 1 });
dpoPayTransactionSchema.index({ user: 1, status: 1 });
dpoPayTransactionSchema.index({ processed: 1 });

// Méthodes
dpoPayTransactionSchema.methods.isSuccessful = function() {
  return this.status === 'PAID';
};

dpoPayTransactionSchema.methods.isPending = function() {
  return this.status === 'PENDING';
};

module.exports = mongoose.model('DpoPayTransaction', dpoPayTransactionSchema);