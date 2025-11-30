// src/api/models/affiliate/AffiliateType.js

const mongoose = require('mongoose');

const affiliateTypeSchema = new mongoose.Schema({
  appId: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    ref: 'App'
  },
  
  name: {
    type: String,
    required: [true, 'Le nom du type d\'affilié est requis'],
    trim: true,
    enum: {
      values: ['AMBASSADEUR', 'TEAM LEADER', 'ELITE PARTNER'],
      message: 'Le type d\'affilié doit être AMBASSADEUR, TEAM LEADER ou ELITE PARTNER'
    }
  },
  
  description: {
    type: String,
    required: [true, 'La description est requise'],
    trim: true
  },
  
  minAccounts: {
    type: Number,
    required: [true, 'Le nombre minimum de comptes est requis'],
    min: [0, 'Le nombre minimum de comptes ne peut pas être négatif']
  },
  
  commissionRate: {
    type: Number,
    required: [true, 'Le taux de commission est requis']
  },
  
  createdAt: {
    type: Date,
    default: Date.now
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes
affiliateTypeSchema.index({ appId: 1, name: 1 }, { unique: true });
affiliateTypeSchema.index({ appId: 1, minAccounts: 1 });
affiliateTypeSchema.index({ name: 1 });
affiliateTypeSchema.index({ minAccounts: 1 });
affiliateTypeSchema.index({ isActive: 1 });

// Statics
affiliateTypeSchema.statics.getTypeByAccountCount = async function(appId, accountCount) {
  const types = await this.find({ appId, isActive: true })
    .sort({ minAccounts: -1 });
  
  for (const type of types) {
    if (accountCount >= type.minAccounts) {
      return type;
    }
  }
  
  return null;
};

// Methods
affiliateTypeSchema.methods.calculateCommission = function(amount) {
  return (amount * this.commissionRate) / 100;
};

// Hooks
affiliateTypeSchema.pre('save', function(next) {
  if (this.isModified() && !this.isNew) {
    this.updatedAt = Date.now();
  }
  next();
});

affiliateTypeSchema.pre(['updateOne', 'findOneAndUpdate'], function(next) {
  this.set({ updatedAt: Date.now() });
  next();
});

module.exports = mongoose.model('AffiliateType', affiliateTypeSchema);