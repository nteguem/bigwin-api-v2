// src/api/models/user/KorapayTransaction.js

const mongoose = require('mongoose');

const korapayTransactionSchema = new mongoose.Schema({
  appId: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    ref: 'App'
  },
  
  // Référence unique de la transaction (générée côté backend)
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
  
  // Référence retournée par KoraPay après initialize
  reference: {
    type: String,
    index: true
  },
  
  // URL de checkout retournée par KoraPay
  checkoutUrl: String,
  
  amount: {
    type: Number,
    required: true
  },
  
  currency: {
    type: String,
    required: true,
    enum: ['NGN', 'KES', 'GHS', 'XAF', 'XOF', 'EGP', 'TZS', 'ZAR', 'USD'],
    uppercase: true
  },
  
  // Statut de la transaction
  status: {
    type: String,
    enum: ['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED'],
    default: 'PENDING'
  },
  
  // Informations client
  customerName: {
    type: String,
    required: true
  },
  
  customerEmail: {
    type: String,
    required: true
  },
  
  customerPhone: String,
  
  description: String,
  
  // Méthode de paiement utilisée (retournée par KoraPay)
  paymentMethod: {
    type: String,
    enum: ['card', 'bank_transfer', 'mobile_money', 'pay_with_bank', 'virtual_account'],
    index: true
  },
  
  // Détails de paiement mobile money
  mobileMoneyDetails: {
    provider: String,
    number: String,
    authModel: {
      type: String,
      enum: ['OTP', 'STK_PROMPT']
    }
  },
  
  // Frais de transaction
  fee: Number,
  vat: Number,
  
  // Montant attendu vs montant payé
  amountExpected: Number,
  amountCharged: Number,
  
  // URLs de callback
  notificationUrl: String,
  redirectUrl: String,
  
  // Réponse de KoraPay lors de l'initialisation
  korapayReference: String, // KPY-xxx reference
  
  // Données webhook
  webhookReceived: {
    type: Boolean,
    default: false
  },
  
  webhookData: {
    event: String, // charge.success, charge.failed, etc.
    receivedAt: Date
  },
  
  // Message de réponse de KoraPay
  responseMessage: String,
  
  // Codes d'erreur
  errorCode: String,
  errorMessage: String,
  
  // Métadonnées supplémentaires de KoraPay
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  // Indique si la transaction a été traitée (abonnement créé)
  processed: {
    type: Boolean,
    default: false
  },
  
  // Date de paiement effective
  paymentDate: Date,
  
  // Merchant bears cost (le marchand paie les frais)
  merchantBearsCost: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// ==================== INDEXES ====================
korapayTransactionSchema.index({ appId: 1, transactionId: 1 }, { unique: true });
korapayTransactionSchema.index({ appId: 1, reference: 1 });
korapayTransactionSchema.index({ appId: 1, korapayReference: 1 });
korapayTransactionSchema.index({ appId: 1, user: 1, status: 1 });
korapayTransactionSchema.index({ appId: 1, processed: 1 });
korapayTransactionSchema.index({ transactionId: 1 });
korapayTransactionSchema.index({ reference: 1 });
korapayTransactionSchema.index({ korapayReference: 1 });
korapayTransactionSchema.index({ user: 1, status: 1 });
korapayTransactionSchema.index({ processed: 1 });
korapayTransactionSchema.index({ status: 1, createdAt: -1 });

// ==================== METHODS ====================

/**
 * Vérifier si la transaction est réussie
 */
korapayTransactionSchema.methods.isSuccessful = function() {
  return this.status === 'SUCCESS';
};

/**
 * Vérifier si la transaction est en attente
 */
korapayTransactionSchema.methods.isPending = function() {
  return this.status === 'PENDING' || this.status === 'PROCESSING';
};

/**
 * Vérifier si la transaction a échoué
 */
korapayTransactionSchema.methods.isFailed = function() {
  return this.status === 'FAILED' || this.status === 'CANCELLED';
};

/**
 * Marquer la transaction comme réussie
 */
korapayTransactionSchema.methods.markAsSuccess = function(paymentData = {}) {
  this.status = 'SUCCESS';
  this.paymentDate = paymentData.paymentDate || new Date();
  this.paymentMethod = paymentData.paymentMethod || this.paymentMethod;
  this.korapayReference = paymentData.korapayReference || this.korapayReference;
  this.responseMessage = paymentData.responseMessage || 'Payment successful';
  
  if (paymentData.fee !== undefined) this.fee = paymentData.fee;
  if (paymentData.vat !== undefined) this.vat = paymentData.vat;
  if (paymentData.amountCharged !== undefined) this.amountCharged = paymentData.amountCharged;
  
  if (paymentData.metadata) {
    this.metadata = { ...this.metadata, ...paymentData.metadata };
  }
  
  return this.save();
};

/**
 * Marquer la transaction comme échouée
 */
korapayTransactionSchema.methods.markAsFailed = function(errorData = {}) {
  this.status = 'FAILED';
  this.errorCode = errorData.errorCode || 'UNKNOWN_ERROR';
  this.errorMessage = errorData.errorMessage || 'Payment failed';
  this.responseMessage = errorData.responseMessage || this.errorMessage;
  
  if (errorData.metadata) {
    this.metadata = { ...this.metadata, ...errorData.metadata };
  }
  
  return this.save();
};

/**
 * Marquer la transaction comme annulée
 */
korapayTransactionSchema.methods.markAsCancelled = function(reason = 'Cancelled by user') {
  this.status = 'CANCELLED';
  this.errorMessage = reason;
  this.responseMessage = reason;
  
  return this.save();
};

/**
 * Enregistrer les données du webhook
 */
korapayTransactionSchema.methods.recordWebhook = function(webhookData) {
  this.webhookReceived = true;
  this.webhookData = {
    event: webhookData.event,
    receivedAt: new Date()
  };
  
  // Mettre à jour le statut selon l'event
  if (webhookData.event === 'charge.success') {
    this.status = 'SUCCESS';
    this.paymentDate = new Date();
  } else if (webhookData.event === 'charge.failed') {
    this.status = 'FAILED';
  }
  
  // Enregistrer les données additionnelles du webhook
  if (webhookData.data) {
    const data = webhookData.data;
    
    if (data.reference) this.korapayReference = data.reference;
    if (data.payment_method) this.paymentMethod = data.payment_method;
    if (data.fee !== undefined) this.fee = data.fee;
    if (data.amount_charged !== undefined) this.amountCharged = data.amount_charged;
    if (data.status) this.responseMessage = data.status;
  }
  
  return this.save();
};

// ==================== STATIC METHODS ====================

/**
 * Trouver une transaction par référence
 */
korapayTransactionSchema.statics.findByReference = function(appId, reference) {
  return this.findOne({ 
    appId, 
    $or: [
      { reference },
      { transactionId: reference },
      { korapayReference: reference }
    ]
  }).populate(['package', 'user']);
};

/**
 * Obtenir les transactions en attente de traitement
 */
korapayTransactionSchema.statics.getPendingTransactions = function(appId) {
  return this.find({
    appId,
    status: 'SUCCESS',
    processed: false
  }).populate(['package', 'user']);
};

/**
 * Obtenir les statistiques des transactions
 */
korapayTransactionSchema.statics.getStats = async function(appId, startDate, endDate) {
  const match = { appId };
  
  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) match.createdAt.$gte = new Date(startDate);
    if (endDate) match.createdAt.$lte = new Date(endDate);
  }
  
  const stats = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' },
        avgAmount: { $avg: '$amount' }
      }
    }
  ]);
  
  return stats;
};

module.exports = mongoose.model('KorapayTransaction', korapayTransactionSchema);