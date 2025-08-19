const mongoose = require("mongoose");

const TicketSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  date: { 
    type: Date, 
    required: true
  },
  category: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Category",
    required: true
  },
  isVisible: {
    type: Boolean,
    default: false
  },
  closingAt: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'closed', 'draft'],
    default: 'active'
  }
}, {
  timestamps: true
});

// Index composé pour les requêtes principales
TicketSchema.index({ 
  date: -1, 
  category: 1, 
  isVisible: 1 
});

// Index simple sur la date pour les requêtes par plage de dates
TicketSchema.index({ 
  date: -1 
});

// Index sur la catégorie pour les filtres par catégorie
TicketSchema.index({ 
  category: 1 
});

// Index sur le status pour les requêtes filtrées par status
TicketSchema.index({ 
  status: 1 
});

// Index composé pour les requêtes fréquentes de tickets visibles par date
TicketSchema.index({ 
  isVisible: 1,
  date: -1 
});

module.exports = mongoose.model("Ticket", TicketSchema);