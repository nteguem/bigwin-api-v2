// src/api/models/admin/AdminOtpCode.js

const mongoose = require('mongoose');

const adminOtpCodeSchema = new mongoose.Schema({
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true,
    index: true
  },
  code: {
    type: String,
    required: true,
    length: 6
  },
  expiresAt: {
    type: Date,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// TTL: Mongo will auto-delete documents once expiresAt is reached
adminOtpCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AdminOtpCode', adminOtpCodeSchema);
