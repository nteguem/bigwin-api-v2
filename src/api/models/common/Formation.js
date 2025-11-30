// src/api/models/common/Formation.js

const mongoose = require('mongoose');

const formationSchema = new mongoose.Schema({
  appId: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    ref: 'App'
  },
  
  title: {
    fr: {
      type: String,
      required: [true, 'Le titre en français est requis']
    },
    en: {
      type: String,
      required: [true, 'Le titre en anglais est requis']
    }
  },
  
  description: {
    fr: {
      type: String,
      required: [true, 'La description en français est requise']
    },
    en: {
      type: String,
      required: [true, 'La description en anglais est requise']
    }
  },
  
  htmlContent: {
    fr: String,
    en: String
  },
  
  isAccessible: {
    type: Boolean,
    default: true
  },
  
  requiredPackages: [{
    type: mongoose.Schema.ObjectId,
    ref: 'Package'
  }],
  
  order: {
    type: Number,
    default: 0
  },
  
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes
formationSchema.index({ appId: 1, order: 1, createdAt: -1 });
formationSchema.index({ appId: 1, isActive: 1 });
formationSchema.index({ appId: 1, isAccessible: 1 });
formationSchema.index({ appId: 1, requiredPackages: 1 });
formationSchema.index({ isActive: 1 });
formationSchema.index({ isAccessible: 1 });
formationSchema.index({ requiredPackages: 1 });
formationSchema.index({ order: 1, createdAt: -1 });

module.exports = mongoose.model('Formation', formationSchema);