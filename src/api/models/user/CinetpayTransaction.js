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

  // IDs de transaction
  transactionId: {       // Notre ID interne (merchant_transaction_id envoyé à CinetPay)
    type: String,
    required: true
  },
  cinetpayTransactionId: { // transaction_id retourné par CinetPay
    type: String
  },
  paymentToken: {          // payment_token retourné par CinetPay
    type: String
  },

  // Sécurité webhook
  notifyToken: {           // notify_token retourné à l'init, à valider lors du webhook
    type: String
  },

  // Références
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

  // Montant & devise
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    enum: ['XOF', 'XAF', 'GNF', 'CDF'],
    required: true
  },

  // Statut — aligné sur les statuts de la nouvelle API
  status: {
    type: String,
    enum: ['PENDING', 'INITIATED', 'SUCCESS', 'FAILED', 'EXPIRED'],
    default: 'PENDING'
  },

  // Infos client
  phoneNumber: {
    type: String,
    required: true
  },
  customerFirstName: {
    type: String,
    required: true
  },
  customerLastName: {
    type: String,
    required: true
  },
  customerEmail: {
    type: String,
    required: true
  },

  // Détails paiement
  designation: String,
  paymentMethod: String,
  paymentUrl: String,

  // URLs callbacks
  notifyUrl: String,
  successUrl: String,
  failedUrl: String,

  // Traitement interne
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
cinetpayTransactionSchema.index({ paymentToken: 1 });
cinetpayTransactionSchema.index({ notifyToken: 1 });
cinetpayTransactionSchema.index({ transactionId: 1 });
cinetpayTransactionSchema.index({ processed: 1 });

// Methods
cinetpayTransactionSchema.methods.isSuccessful = function () {
  return this.status === 'SUCCESS';
};

cinetpayTransactionSchema.methods.isPending = function () {
  return ['PENDING', 'INITIATED'].includes(this.status);
};

module.exports = mongoose.model('CinetpayTransaction', cinetpayTransactionSchema);