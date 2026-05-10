// src/api/models/affiliate/Commission.js
//
// Commission gagnée par un affilié quand un de ses filleuls achète un
// forfait. Créée AUTOMATIQUEMENT au webhook de paiement réussi, après
// vérification du scope pays + check self-ref.
//
// Cycle de vie :
//   available  : créée + valide, prête à être incluse dans un PayoutRequest
//   locked     : incluse dans un PayoutRequest en cours de traitement
//   paid       : PayoutRequest marqué payé par AfribaPay → versement effectif
//   cancelled  : annulée (refund filleul, self-ref détecté a posteriori, suspension affilié)

const mongoose = require('mongoose');

const commissionSchema = new mongoose.Schema(
  {
    appId: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    // L'affilié qui touche — User avec affiliate.isActive
    referrer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Le filleul qui a généré l'achat
    referee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    referral: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Referral',
      required: true,
    },

    // L'achat qui déclenche la commission
    subscription: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
      required: true,
    },

    // Snapshot du calcul pour audit (rate peut changer dans la config plus tard)
    subscriptionAmount: { type: Number, required: true },
    commissionRate: { type: Number, required: true }, // %, ex: 15
    amount: { type: Number, required: true },        // montant final commission
    currency: { type: String, required: true, uppercase: true },

    // Tier du parrain au moment du calcul (V1: 'rookie' uniquement)
    tier: { type: String, default: 'rookie' },

    status: {
      type: String,
      enum: ['available', 'locked', 'paid', 'cancelled'],
      default: 'available',
      required: true,
    },

    // Lié à un PayoutRequest si status=locked|paid
    payoutRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PayoutRequest',
      default: null,
    },

    // Métadonnées d'annulation
    cancelledAt: Date,
    cancelReason: {
      type: String,
      // 'refund' | 'self_ref_detected' | 'admin_suspended' | 'manual'
    },

    paidAt: Date,
  },
  { timestamps: true }
);

commissionSchema.index({ appId: 1, referrer: 1, status: 1 });
commissionSchema.index({ appId: 1, subscription: 1 }, { unique: true }); // 1 sub = 1 commission max
commissionSchema.index({ appId: 1, status: 1, createdAt: -1 });
commissionSchema.index({ appId: 1, payoutRequest: 1 });

module.exports = mongoose.model('Commission', commissionSchema);
