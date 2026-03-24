const mongoose = require('mongoose');

const DayOffSchema = new mongoose.Schema({
  appId: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    ref: 'App'
  },
  date: {
    type: String,
    required: true
  },
  message: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DayOffMessage',
    required: true
  }
}, {
  timestamps: true
});

DayOffSchema.index({ appId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('DayOff', DayOffSchema);
