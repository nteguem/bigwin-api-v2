// src/api/models/affiliate/AdminFundingRequest.js
//
// Demande de validation admin créée quand un PayoutRequest passe en
// `awaiting_funds` (AfribaPay refuse pour solde insuffisant sur le pays).
// L'admin alimente manuellement le compte AfribaPay du pays concerné,
// puis clique "Valider et relancer" dans le backoffice → le PayoutRequest
// repart en `processing`.
//
// PAS de retry automatique. Toute relance passe par une action humaine.

const mongoose = require('mongoose');

const adminFundingRequestSchema = new mongoose.Schema(
  {
    appId: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    payoutRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PayoutRequest',
      required: true,
    },

    // Snapshot des infos pour faciliter le tri/filtrage côté admin
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    country: { type: String, required: true, uppercase: true },
    currency: { type: String, required: true, uppercase: true },
    amount: { type: Number, required: true },

    status: {
      type: String,
      enum: ['pending', 'validated', 'rejected'],
      default: 'pending',
      required: true,
    },

    // Résolution
    resolvedAt: Date,
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    rejectionReason: String,
    adminNote: String,

    // Snapshot AfribaPay au moment de l'erreur (pour debug)
    afribaPayErrorResponse: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

adminFundingRequestSchema.index({ appId: 1, status: 1, createdAt: -1 });
adminFundingRequestSchema.index({ payoutRequest: 1 }, { unique: true });
adminFundingRequestSchema.index({ appId: 1, country: 1, status: 1 });

module.exports = mongoose.model('AdminFundingRequest', adminFundingRequestSchema);
