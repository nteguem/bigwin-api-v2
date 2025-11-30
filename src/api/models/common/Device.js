// src/api/models/common/Device.js

const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  appId: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    ref: 'App'
  },
  
  deviceId: {
    type: String,
    required: true
  },
  
  playerId: {
    type: String,
    sparse: true
  },
  
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  
  platform: {
    type: String,
    enum: ['android', 'ios'],
    required: true
  },
  
  deviceInfo: {
    model: String,
    osVersion: String,
    appVersion: String
  },
  
  isActive: {
    type: Boolean,
    default: true
  },
  
  userType: {
    type: String,
    enum: ['guest', 'registered', 'vip'],
    default: 'guest'
  },
  
  lastActiveAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes
deviceSchema.index({ appId: 1, deviceId: 1 }, { unique: true });
deviceSchema.index({ appId: 1, playerId: 1 }, { sparse: true });
deviceSchema.index({ appId: 1, userType: 1, isActive: 1 });
deviceSchema.index({ appId: 1, user: 1, isActive: 1 });
deviceSchema.index({ userType: 1, isActive: 1 });
deviceSchema.index({ user: 1, isActive: 1 });
deviceSchema.index({ playerId: 1, isActive: 1 });

// Methods
deviceSchema.methods.linkToUser = function(userId) {
  this.user = userId;
  this.userType = 'registered';
  return this.save();
};

deviceSchema.methods.unlinkFromUser = function() {
  this.user = null;
  this.userType = 'guest';
  return this.save();
};

// Statics
deviceSchema.statics.getByUserType = function(userType) {
  return this.find({ 
    userType, 
    isActive: true,
    playerId: { $exists: true, $ne: null }
  });
};

module.exports = mongoose.model('Device', deviceSchema);