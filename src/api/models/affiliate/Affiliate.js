// src/api/models/affiliate/Affiliate.js

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const affiliateSchema = new mongoose.Schema({
  appId: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    ref: 'App'
  },
  
  phone: {
    type: String,
    required: true
  },
  
  password: {
    type: String,
    required: true,
    minlength: 6,
    select: false
  },
  
  email: String,
  firstName: String,
  lastName: String,
  country: String,
  city: String,
  district: String,
  
  affiliateCode: {
    type: String,
    required: true,
    uppercase: true
  },
  
  affiliateType: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AffiliateType',
    default: null
  },
  
  totalEarnings: {
    type: Number,
    default: 0
  },
  
  pendingBalance: {
    type: Number,
    default: 0
  },
  
  paidBalance: {
    type: Number,
    default: 0
  },
  
  paymentInfo: {
    method: {
      type: String,
      enum: ['MOBILE_MONEY', 'BANK_TRANSFER', 'CASH']
    },
    mobileNumber: String,
    bankDetails: {
      bankName: String,
      accountNumber: String,
      accountName: String
    }
  },
  
  isActive: {
    type: Boolean,
    default: true
  },
  
  refreshTokens: [String],
  
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes
affiliateSchema.index({ appId: 1, phone: 1 }, { unique: true });
affiliateSchema.index({ appId: 1, affiliateCode: 1 }, { unique: true });
affiliateSchema.index({ appId: 1, email: 1 }, { unique: true, sparse: true });
affiliateSchema.index({ appId: 1, isActive: 1 });
affiliateSchema.index({ isActive: 1 });
affiliateSchema.index({ affiliateType: 1 });

// Methods
affiliateSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

affiliateSchema.methods.toJSON = function() {
  const affiliate = this.toObject();
  delete affiliate.password;
  delete affiliate.refreshTokens;
  delete affiliate.__v;
  return affiliate;
};

// Hooks
affiliateSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

module.exports = mongoose.model('Affiliate', affiliateSchema);