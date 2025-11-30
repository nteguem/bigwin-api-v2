// src/api/models/common/Topic.js

const mongoose = require('mongoose');

const topicSchema = new mongoose.Schema({
  appId: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    ref: 'App'
  },
  
  name: {
    type: String,
    required: true,
    trim: true
  },
  
  city: {
    type: String,
    required: true,
    trim: true
  },
  
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes
topicSchema.index({ appId: 1, name: 1 }, { unique: true });
topicSchema.index({ appId: 1, city: 1 });
topicSchema.index({ appId: 1, isActive: 1 });
topicSchema.index({ name: 1 });
topicSchema.index({ city: 1 });
topicSchema.index({ isActive: 1 });

// Statics
topicSchema.statics.findOrCreate = async function(appId, name, city) {
  let topic = await this.findOne({ appId, name });
  
  if (!topic) {
    topic = await this.create({ appId, name, city });
  }
  
  return topic;
};

module.exports = mongoose.model('Topic', topicSchema);