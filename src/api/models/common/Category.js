const mongoose = require("mongoose");

const CategorySchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true,
    unique: true 
  },
  description: String,
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

module.exports = mongoose.model("Category", CategorySchema);