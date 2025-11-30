// src/api/models/common/Prediction.js

const mongoose = require("mongoose");

const PredictionSchema = new mongoose.Schema({
  appId: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    ref: 'App'
  },
  
  ticket: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Ticket",
    required: true
  },
  
  correctionAttempts: { 
    type: Number, 
    default: 0 
  },
  
  matchData: mongoose.Schema.Types.Mixed,
  
  event: mongoose.Schema.Types.Mixed,
  
  odds: {
    type: Number,
    required: true
  },
  
  status: {
    type: String,
    enum: ['pending', 'won', 'lost', 'void'],
    default: 'pending'
  },
  
  sport: {
    id: String,
    name: String,
    icon: String
  }
}, {
  timestamps: true
});

// Indexes
PredictionSchema.index(
  { appId: 1, ticket: 1, 'matchData.id': 1, 'event.id': 1 },
  { unique: true }
);
PredictionSchema.index({ appId: 1, ticket: 1 });
PredictionSchema.index({ appId: 1, status: 1 });
PredictionSchema.index({ appId: 1, 'sport.id': 1 });
PredictionSchema.index({ ticket: 1 });
PredictionSchema.index({ status: 1 });

module.exports = mongoose.model("Prediction", PredictionSchema);