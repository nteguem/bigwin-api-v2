// models/user/CinetpayTransaction.js
//
// Transaction CinetPay — nouvelle API (api.cinetpay.co/v1).
// `transactionId` correspond au merchant_transaction_id envoyé à CinetPay
// (notre identifiant, max 30 chars). `cinetpayTransactionId` est l'ID
// retourné par CinetPay (référence dans leur backoffice).

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

  cinetpayTransactionId: String,

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
  notifyToken: String,
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
    enum: ['PENDING', 'INITIATED', 'ACCEPTED', 'REFUSED', 'WAITING_FOR_CUSTOMER', 'CANCELED'],
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
  paymentDate: Date,

  notifyUrl: String,
  successUrl: String,
  failedUrl: String,

  // Réponse `details` de l'API CinetPay (init + status check)
  detailsCode: Number,
  detailsStatus: String,
  detailsMessage: String,
  mustBeRedirected: Boolean,

  errorCode: String,
  errorMessage: String,

  processed: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

cinetpayTransactionSchema.index({ appId: 1, transactionId: 1 }, { unique: true });
cinetpayTransactionSchema.index({ appId: 1, user: 1, status: 1 });
cinetpayTransactionSchema.index({ appId: 1, processed: 1 });
cinetpayTransactionSchema.index({ transactionId: 1 });
cinetpayTransactionSchema.index({ cinetpayTransactionId: 1 });
cinetpayTransactionSchema.index({ notifyToken: 1 });

cinetpayTransactionSchema.methods.isSuccessful = function () {
  return this.status === 'ACCEPTED';
};

cinetpayTransactionSchema.methods.isPending = function () {
  return this.status === 'PENDING' || this.status === 'INITIATED' || this.status === 'WAITING_FOR_CUSTOMER';
};

module.exports = mongoose.model('CinetpayTransaction', cinetpayTransactionSchema);
