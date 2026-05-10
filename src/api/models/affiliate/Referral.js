// src/api/models/affiliate/Referral.js
//
// Trace un parrainage : un filleul (User) qui a été référencé par un
// affilié (User.affiliate). Créé au moment de l'inscription du filleul
// quand un `affiliateCode` valide est passé.
//
// Le scope par pays est appliqué ICI : si filleul.countryCode ≠
// affilié.affiliate.country, on crée quand même le Referral (pour
// analytics) mais avec status='country_mismatch' et aucune Commission ne
// sera générée par le hook de paiement.

const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema(
  {
    appId: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    // L'affilié qui parraine — User avec affiliate.isActive=true
    referrer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Le filleul — User créé via l'affiliateCode
    referee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Code utilisé au moment du signup (snapshot pour audit)
    code: {
      type: String,
      uppercase: true,
      required: true,
    },

    // Pays au moment du signup (snapshot pour debug country_mismatch)
    refereeCountry: {
      type: String,
      uppercase: true,
    },
    referrerCountry: {
      type: String,
      uppercase: true,
    },

    // Statut métier :
    //   - 'signed_up'         : filleul créé, country match → éligible à commission
    //   - 'country_mismatch'  : filleul créé mais pays ≠ → pas de commission
    //   - 'self_ref'          : même phone que le parrain → fraude
    //   - 'converted'         : 1 ou plusieurs Commissions ont été créées
    status: {
      type: String,
      enum: ['signed_up', 'country_mismatch', 'self_ref', 'converted'],
      default: 'signed_up',
      required: true,
    },

    convertedAt: Date,           // 1ère Commission créée
    firstCommissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Commission',
    },
  },
  { timestamps: true }
);

// Indexes
referralSchema.index({ appId: 1, referrer: 1, status: 1 });
referralSchema.index({ appId: 1, referee: 1 }, { unique: true }); // un filleul ne peut être parrainé qu'une fois par app
referralSchema.index({ appId: 1, code: 1 });

module.exports = mongoose.model('Referral', referralSchema);
