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