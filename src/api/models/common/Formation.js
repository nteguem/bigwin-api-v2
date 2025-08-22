const mongoose = require('mongoose');

const formationSchema = new mongoose.Schema({
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
  pdfUrl: {
    fr: {
      type: String,
    },
    en: {
      type: String,
    }
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Index pour optimiser les requêtes
formationSchema.index({ isActive: 1 });

const Formation = mongoose.model('Formation', formationSchema);

module.exports = Formation;