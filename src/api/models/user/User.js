// src/api/models/user/User.js

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  appId: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    ref: 'App'
  },
  
  phoneNumber: {
    type: String,
    sparse: true,
    required: function() {
      return this.authProvider === 'local';
    }
  },
  
  password: {
    type: String,
    minlength: 6,
    select: false,
    required: function() {
      return this.authProvider === 'local';
    }
  },
  
  googleId: {
    type: String,
    sparse: true
  },
  
  authProvider: {
    type: String,
    enum: ['local', 'google'],
    required: true,
    default: 'local'
  },
  
  email: {
    type: String,
    sparse: true,
    required: function() {
      return this.authProvider === 'google';
    }
  },
  
  pseudo: {
    type: String,
    required: true
  },
  
  firstName: String,
  lastName: String,
  profilePicture: String,
  
  emailVerified: {
    type: Boolean,
    default: false
  },
  
  city: String,
  dialCode: String,
  countryCode: String,
  
  referredBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'Affiliate'
  },
  
  isActive: {
    type: Boolean,
    default: true
  },
  
  refreshTokens: [{
    type: String,
    select: false
  }],

  // Firebase `app_instance_id` — capturé par le mobile et envoyé à chaque
  // login/register/googleAuth. Requis pour que les webhooks PSP puissent
  // envoyer des events GA4 Measurement Protocol (purchase / payment_failed)
  // attribués au bon user côté Google Ads.
  //
  // Peut être null si l'app mobile ne l'a pas encore envoyé (ancien client
  // avant le sprint tracking) — dans ce cas le webhook skip le MP event.
  firebaseAppInstanceId: {
    type: String,
    default: null,
    trim: true
  },

  // Source d'acquisition — capturée par le mobile via Play Install Referrer
  // API au premier lancement, envoyée au 1er register/login/googleAuth.
  // Immutable une fois set (premier capture wins).
  //   - google_ads : referrer contenait `gclid=` (clic sur pub Google Ads)
  //   - organique  : tout le reste (Play Store search, lien direct, partage,
  //                  iOS, Huawei sans GMS, install referrer indisponible)
  //
  // Pas de `default` sur les sous-champs : Mongoose ferait remonter null →
  // enum validation FAIL. On laisse le champ undefined par défaut, ce qui
  // skip le validateur enum tant que la valeur n'est pas explicitement set.
  acquisition: {
    source: {
      type: String,
      enum: ['google_ads', 'organique']
    },
    gclid: {
      type: String,
      trim: true
    },
    capturedAt: {
      type: Date
    }
  },

  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes
// ✅ CHANGEMENT: Unicité sur appId + dialCode + phoneNumber au lieu de appId + phoneNumber
userSchema.index({ appId: 1, dialCode: 1, phoneNumber: 1 }, { unique: true, sparse: true });
userSchema.index({ appId: 1, email: 1 }, { unique: true, sparse: true });
userSchema.index({ appId: 1, googleId: 1 }, { unique: true, sparse: true });
userSchema.index({ appId: 1, isActive: 1 });
userSchema.index({ referredBy: 1 });
userSchema.index({ isActive: 1 });
userSchema.index({ authProvider: 1 });

// Methods
userSchema.methods.comparePassword = async function(candidatePassword) {
  if (!this.password) return false;
  return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  delete user.refreshTokens;
  delete user.__v;
  return user;
};

// Hooks
userSchema.pre('save', async function(next) {
  if (!this.isModified('password') || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

module.exports = mongoose.model('User', userSchema);