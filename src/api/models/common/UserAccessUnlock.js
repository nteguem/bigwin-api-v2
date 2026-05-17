// src/api/models/common/UserAccessUnlock.js
//
// Suivi du déblocage d'une ressource (aujourd'hui : une Category free de
// coupons) par visionnage de pubs récompensées AdMob, vérifiées via SSV.
// Débloquer la catégorie ⇒ tous ses coupons sont accessibles pendant la durée.
//
// Un seul document par couple (appId, user, resourceType, resource). Le cycle
// de vie d'une tentative :
//   1. startOrSwitchUnlock → crée/réinitialise le doc en `in_progress` avec
//      `selectedOption` (durée + nb de pubs) et un `nonce` neuf.
//   2. chaque callback SSV vérifié → `recordVerifiedReward` incrémente
//      `verifiedCount` (atomique, dédup sur `rewards.transactionId`).
//   3. quand `verifiedCount >= selectedOption.adsRequired` → `unlocked`,
//      `unlockedAt = now`, `expiresAt = unlockedAt + durationMinutes`
//      (null si l'offre est "à vie").
//   4. une fois `expiresAt` passé, l'accès n'est plus actif ; le doc est
//      réinitialisé au prochain startOrSwitchUnlock (les pubs déjà consommées
//      ne sont pas reportées d'une période expirée à la suivante).
//
// La progression partielle (`in_progress`, pas encore atteint le seuil) est
// conservée indéfiniment et reportée si l'utilisateur change d'offre.

const mongoose = require('mongoose');

/**
 * Une récompense vérifiée reçue via le callback SSV AdMob.
 * `transactionId` sert de clé de déduplication (un même reward ne compte
 * jamais deux fois, même si AdMob renvoie le callback plusieurs fois).
 */
const VerifiedRewardSchema = new mongoose.Schema({
  transactionId: { type: String, required: true },
  adUnitId: { type: String, default: null },
  adNetwork: { type: String, default: null },
  rewardAmount: { type: Number, default: null },
  rewardItem: { type: String, default: null },
  // Horodatage AdMob du moment où l'utilisateur a été récompensé (epoch ms).
  rewardedAt: { type: Date, default: null },
  // Moment où notre serveur a traité le callback.
  receivedAt: { type: Date, default: Date.now }
}, { _id: false });

const UserAccessUnlockSchema = new mongoose.Schema({
  appId: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    ref: 'App'
  },

  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Type de ressource déblocable.
  //   - 'category'  : déblocage d'une CATÉGORIE free de coupons (avec offre
  //     `selectedOption` : durée + nb de pubs, expiration via `expiresAt`).
  //   - 'affiliate' : déblocage de l'INSCRIPTION AFFILIÉ (compteur cumulatif,
  //     pas de durée, `resource` absent — un seul doc par user).
  resourceType: {
    type: String,
    enum: ['category', 'affiliate'],
    default: 'category'
  },

  // ObjectId de la ressource (ex: Category). Absent pour les `resourceType`
  // sans cible (ex: 'affiliate', qui se réfère à l'user lui-même). Volontairement
  // sans `ref` figée pour rester générique.
  resource: {
    type: mongoose.Schema.Types.ObjectId,
    required: false,
    default: null
  },

  status: {
    type: String,
    enum: ['in_progress', 'unlocked'],
    default: 'in_progress'
  },

  // Offre choisie pour la tentative en cours (et figée une fois `unlocked`).
  selectedOption: {
    // null ⇒ "à vie" (pas d'expiration)
    durationMinutes: { type: Number, default: null },
    adsRequired: { type: Number, default: null }
  },

  // Nombre de pubs récompensées VÉRIFIÉES par le SSV. N'est jamais incrémenté
  // par le client.
  verifiedCount: { type: Number, default: 0 },

  // Jeton opaque transmis dans le `custom_data` de la pub : relie les
  // callbacks SSV à cette tentative. Régénéré à chaque (re)démarrage.
  nonce: { type: String, default: null, index: true },

  unlockedAt: { type: Date, default: null },
  // null quand pas (encore) débloqué OU quand l'offre est "à vie".
  expiresAt: { type: Date, default: null },

  // Historique des récompenses vérifiées (audit + déduplication via la clé
  // `transactionId`). La dédup est appliquée atomiquement dans le service.
  rewards: { type: [VerifiedRewardSchema], default: [] }
}, { timestamps: true });

// Un seul enregistrement par couple user ↔ ressource.
UserAccessUnlockSchema.index(
  { appId: 1, user: 1, resourceType: 1, resource: 1 },
  { unique: true }
);
UserAccessUnlockSchema.index({ appId: 1, user: 1, status: 1 });

/**
 * L'accès est-il débloqué ET encore valide à l'instant présent ?
 */
UserAccessUnlockSchema.methods.isAccessActive = function () {
  if (this.status !== 'unlocked') return false;
  if (!this.expiresAt) return true; // "à vie"
  return this.expiresAt.getTime() > Date.now();
};

module.exports = mongoose.model('UserAccessUnlock', UserAccessUnlockSchema);
