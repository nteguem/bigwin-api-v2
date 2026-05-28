// models/user/PawapayTransaction.js
//
// Transaction pawaPay — collecte mobile money (deposit).
// `depositId` est un UUID v4 genere par nous et envoye dans la requete
// d'initiation; pawaPay le reutilise comme identifiant cote leur backend.
// Pas de mapping interne/externe a maintenir → un seul ID.

const mongoose = require('mongoose');

const pawapayTransactionSchema = new mongoose.Schema({
  appId: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    ref: 'App'
  },

  // ID principal — UUID v4. Sert AUSSI bien cote nous que cote pawaPay.
  depositId: {
    type: String,
    required: true
  },

  // Identifiant business optionnel (notre transaction interne BW-xxxxx)
  // utile pour faire le lien avec les emails / support / analytics.
  clientReferenceId: String,

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

  // Pays (ISO-2) — utile pour reporting / filtres BO. Le compte pawaPay
  // est multi-pays (1 token = 20 pays) donc pas necessaire pour resoudre
  // la config (contrairement a InTouch).
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
    enum: ['XAF', 'XOF', 'CDF', 'GNF', 'NGN', 'KES', 'GHS', 'TZS', 'UGX', 'ZAR', 'ZMW', 'MWK', 'RWF', 'SLE', 'MZN', 'LSL'],
    required: true
  },

  // Statut — aligne sur CinetPay/InTouch pour coherence cross-PSP.
  // INITIATED = pawaPay a accepte la requete (ACCEPTED), en attente USSD client.
  // SUCCESS   = paiement confirme par operateur (COMPLETED cote pawaPay).
  // FAILED    = rejete par pawaPay (REJECTED) ou par operateur (FAILED).
  // EXPIRED   = timeout cote pawaPay (FAILED avec failureCode EXPIRED).
  status: {
    type: String,
    enum: ['PENDING', 'INITIATED', 'SUCCESS', 'FAILED', 'EXPIRED'],
    default: 'PENDING'
  },

  // Provider pawaPay (ex: MTN_MOMO_CMR, ORANGE_MONEY_CMR, AIRTEL_OAPI_CIV).
  // Le format est {OPERATEUR}_{ISO3} dans la doc pawaPay v2.
  provider: {
    type: String,
    required: true,
    trim: true
  },

  // Numero du client qui paie (format international, sans + ni espaces,
  // ex: 237679711656). pawaPay attend MSISDN brut.
  phoneNumber: {
    type: String,
    required: true
  },

  // Infos client (denormalisees pour reporting)
  customerEmail:     String,
  customerFirstName: String,
  customerLastName:  String,
  customerMessage:   String,   // libelle affiche au client (USSD prompt)

  // Environnement utilise lors de l'init (sandbox vs production) — fige
  // a la creation pour eviter qu'un flip de l'env corrompe la trace.
  environment: {
    type: String,
    enum: ['sandbox', 'production'],
    required: true
  },

  // Detail debug
  designation: String,
  failureCode: String,
  failureMessage: String,

  // Reponse brute pawaPay pour audit (init + check_status + webhook).
  // Permet de rejouer / debugger sans re-taper l'API si pawaPay change.
  providerData: mongoose.Schema.Types.Mixed,

  // Idempotency (set a true une fois la subscription creee)
  processed: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Indexes
pawapayTransactionSchema.index({ appId: 1, depositId: 1 }, { unique: true });
pawapayTransactionSchema.index({ appId: 1, user: 1, status: 1 });
pawapayTransactionSchema.index({ depositId: 1 });
pawapayTransactionSchema.index({ clientReferenceId: 1 });
pawapayTransactionSchema.index({ processed: 1 });

// Methods (interface compatible avec paymentMiddleware)
pawapayTransactionSchema.methods.isSuccessful = function () {
  return this.status === 'SUCCESS';
};

pawapayTransactionSchema.methods.isPending = function () {
  return ['PENDING', 'INITIATED'].includes(this.status);
};

module.exports = mongoose.model('PawapayTransaction', pawapayTransactionSchema);
