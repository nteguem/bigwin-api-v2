// src/api/models/common/Category.js

const mongoose = require("mongoose");

const CategorySchema = new mongoose.Schema({
  appId: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    ref: 'App'
  },
  
  name: {
    type: String,
    required: true
  },
  
  description: String,
  
  icon: {
    type: String,
    default: "🧾"
  },
  
  successRate: {
    type: Number,
    default: 50,
    min: 0,
    max: 100,
    validate: {
      validator: function(v) {
        return v >= 0 && v <= 100;
      },
      message: 'Success rate must be between 0 and 100'
    }
  },
  
  isVip: {
    type: Boolean,
    default: false
  },
  
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes
CategorySchema.index({ appId: 1, name: 1 }, { unique: true });
CategorySchema.index({ appId: 1, isActive: 1 });
CategorySchema.index({ appId: 1, isVip: 1 });
CategorySchema.index({ isActive: 1 });
CategorySchema.index({ isVip: 1 });

module.exports = mongoose.model("Category", CategorySchema);