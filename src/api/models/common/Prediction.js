const mongoose = require("mongoose");

const PredictionSchema = new mongoose.Schema({
  ticket: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Ticket",
    required: true
  },

  matchData: {
    id: { type: String, required: true },
    date: { type: Date, required: true },
    league: {
      id: String,
      name: String,
      country: String,
      countryFlag: String,
      logo: String
    },
    teams: {
      home: {
        id: String,
        name: String,
        logo: String
      },
      away: {
        id: String,
        name: String,
        logo: String
      }
    },
    venue: {
      id: { type: Number, default: null },
      name: String,
      city: String
    },
    status: String,
    score: {
      home: Number,
      away: Number,
      details: mongoose.Schema.Types.Mixed
    },
    sportSpecific: mongoose.Schema.Types.Mixed
  },

  event: {
    id: { type: String, required: true },
    position: Number,
    priority: String,
    label: {
      fr: String,
      en: String,
      current: String
    },
    expression: String,
    category: String,
    description: {
      fr: String,
      en: String,
      current: String
    },
    parametric: Boolean,
    params: mongoose.Schema.Types.Mixed
  },

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

PredictionSchema.index(
  { ticket: 1, 'matchData.id': 1, 'event.id': 1 },
  { unique: true }
);

module.exports = mongoose.model("Prediction", PredictionSchema);
