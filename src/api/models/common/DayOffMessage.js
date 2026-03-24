const mongoose = require('mongoose');

const DayOffMessageSchema = new mongoose.Schema({
  appId: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    ref: 'App'
  },
  message: {
    fr: { type: String, required: true },
    en: { type: String, required: true }
  }
}, {
  timestamps: true
});

DayOffMessageSchema.index({ appId: 1 });

module.exports = mongoose.model('DayOffMessage', DayOffMessageSchema);
