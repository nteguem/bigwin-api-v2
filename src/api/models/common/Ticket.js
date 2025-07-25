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

module.exports = mongoose.model("Ticket", TicketSchema);