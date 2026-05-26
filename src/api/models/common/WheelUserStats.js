// src/api/models/common/WheelUserStats.js
//
// Stats par user pour la roue — scopé par app (multi-tenant) : tours gratuits
// accumulés, dernier spin (pour cooldown), compteur total.
// Créé à la 1re interaction (lazy via getOrCreate).

const mongoose = require('mongoose');

const WheelUserStatsSchema = new mongoose.Schema({
  // Tenant propriétaire des stats.
  appId: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    ref: 'App'
  },

  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Solde de TOURS disponibles. L'user gagne des tours en regardant des pubs
  // via un pack (ticketPacks configurables). Chaque spin consomme 1 tour.
  ticketsBalance: { type: Number, default: 0, min: 0 },

  // Compteur total de tickets gagnés (jamais décrémenté — pour stats)
  totalTicketsEarned: { type: Number, default: 0 },

  lastSpinAt: { type: Date, default: null },
  totalSpins: { type: Number, default: 0 }
}, { timestamps: true });

// Un seul document par couple (app, user).
WheelUserStatsSchema.index({ appId: 1, user: 1 }, { unique: true });

WheelUserStatsSchema.statics.getOrCreate = async function (appId, userId) {
  let doc = await this.findOne({ appId, user: userId });
  if (!doc) doc = await this.create({ appId, user: userId });
  return doc;
};

module.exports = mongoose.model('WheelUserStats', WheelUserStatsSchema);
