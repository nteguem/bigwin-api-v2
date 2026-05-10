// src/api/models/affiliate/PayoutRequest.js
//
// Demande de retrait d'un affilié, traitée automatiquement via AfribaPay
// (api-payout.afribapay.com). Stratégie pay-on-demand : si le compte
// AfribaPay du pays n'est pas alimenté, on bascule en `awaiting_funds` +
// crée une AdminFundingRequest pour que l'admin alimente manuellement et
// relance.
//
// Cycle de vie :
//   queued          : créé, en attente du worker
//   processing      : POST AfribaPay envoyé, attente webhook ou réconciliation
//   awaiting_funds  : AfribaPay refus solde insuffisant — admin doit alimenter
//   paid            : webhook AfribaPay confirme SUCCESS
//   failed          : échec définitif (numéro invalide, erreur récupérable épuisée)
//   cancelled       : annulé par admin (raison obligatoire)

const mongoose = require('mongoose');

const payoutRequestSchema = new mongoose.Schema(
  {
    appId: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    amount: { type: Number, required: true },
    currency: { type: String, required: true, uppercase: true },

    // Coordonnées du payout (snapshot au moment de la demande)
    country: { type: String, required: true, uppercase: true },
    operator: { type: String, required: true }, // 'orange' | 'mtn' | 'wave' | ...
    phoneNumber: { type: String, required: true },

    status: {
      type: String,
      enum: [
        'queued',
        'processing',
        'awaiting_funds',
        'paid',
        'failed',
        'cancelled',
      ],
      default: 'queued',
      required: true,
    },

    // Commissions agrégées dans ce payout (status=locked|paid|available selon transition)
    commissionsIncluded: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Commission',
      },
    ],

    // ===== AfribaPay tracking =====
    afribaPayOrderId: {
      type: String,
      // = `payout-${this._id}` — utilisé comme idempotency key chez AfribaPay
    },
    afribaPayTransactionId: String, // POM... renvoyé par AfribaPay
    afribaPayProviderId: String,    // provider_id (ex: pt-1tf343fvr11nt)
    afribaPayLastResponse: mongoose.Schema.Types.Mixed, // dernier payload reçu

    // ===== Audit trail immuable =====
    attempts: [
      {
        at: { type: Date, default: Date.now },
        type: {
          type: String,
          enum: ['request', 'webhook', 'reconciliation', 'admin_action'],
        },
        status: String,                       // status à la fin de l'attempt
        payload: mongoose.Schema.Types.Mixed, // payload envoyé / reçu
        response: mongoose.Schema.Types.Mixed,
        error: String,
        actor: String,                        // user._id si admin, 'system' sinon
        _id: false,
      },
    ],

    failureReason: String,         // user-facing si status=failed
    webhookReceivedAt: Date,
    reconciledAt: Date,
    requestedAt: { type: Date, default: Date.now },
    paidAt: Date,
    cancelledAt: Date,
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    cancelReason: String,
  },
  { timestamps: true }
);

payoutRequestSchema.index({ appId: 1, user: 1, status: 1 });
payoutRequestSchema.index({ appId: 1, status: 1, requestedAt: -1 });
payoutRequestSchema.index({ afribaPayOrderId: 1 }, { unique: true, sparse: true });
// Pour le worker : pickup les queued
payoutRequestSchema.index({ status: 1, requestedAt: 1 });

module.exports = mongoose.model('PayoutRequest', payoutRequestSchema);
