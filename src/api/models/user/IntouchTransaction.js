// models/user/IntouchTransaction.js
//
// Transaction InTouch / TouchPay — Paiement Marchand (C2B).
// `transactionId` = idFromClient envoye a InTouch (notre cle).
// `gutouchTransactionId` = gu_transaction_id retourne par InTouch.

const mongoose = require('mongoose');

const intouchTransactionSchema = new mongoose.Schema({
  appId: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    ref: 'App'
  },

  // IDs
  transactionId: {        // notre idFromClient envoye a InTouch
    type: String,
    required: true
  },
  gutouchTransactionId: { // gu_transaction_id retourne par InTouch
    type: String
  },

  // References
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

  // Pays (necessaire pour resoudre la config InTouch au moment du webhook /
  // check_status — chaque pays = compte e-marchand distinct chez InTouch)
  countryCode: {
    type: String,
    required: true,
    uppercase: true,
    trim: true
  },

  // Montant & devise
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    enum: ['XAF', 'XOF', 'GNF', 'CDF'],
    default: 'XAF'
  },
  commission: {           // frais preleves par InTouch (info reporting)
    type: Number,
    default: 0
  },

  // Statut — aligne sur CinetPay pour coherence cross-PSP
  status: {
    type: String,
    enum: ['PENDING', 'INITIATED', 'SUCCESS', 'FAILED', 'EXPIRED'],
    default: 'PENDING'
  },

  // Infos paiement
  operator: {             // mtn-money / orange-money
    type: String,
    enum: ['mtn', 'om'],
    required: true
  },
  serviceCode: {          // ex: PAIEMENTMARCHAND_MTN_CM, CM_PAIEMENTMARCHAND_OM_TP
    type: String,
    required: true
  },
  recipientNumber: {      // numero du client qui paie (sans prefixe pays)
    type: String,
    required: true
  },

  // Infos client (pour additionnalInfos InTouch)
  customerEmail: {
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

  // Detail paiement
  designation: String,
  callbackUrl: String,

  // Erreurs / messages InTouch
  errorCode: String,
  errorMessage: String,

  // Traitement interne (idempotency)
  processed: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Indexes
intouchTransactionSchema.index({ appId: 1, transactionId: 1 }, { unique: true });
intouchTransactionSchema.index({ appId: 1, user: 1, status: 1 });
intouchTransactionSchema.index({ gutouchTransactionId: 1 });
intouchTransactionSchema.index({ transactionId: 1 });
intouchTransactionSchema.index({ processed: 1 });

// Methods
intouchTransactionSchema.methods.isSuccessful = function () {
  return this.status === 'SUCCESS';
};

intouchTransactionSchema.methods.isPending = function () {
  return ['PENDING', 'INITIATED'].includes(this.status);
};

module.exports = mongoose.model('IntouchTransaction', intouchTransactionSchema);
