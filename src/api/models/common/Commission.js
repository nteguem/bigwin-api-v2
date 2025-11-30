// src/api/models/common/Commission.js

const mongoose = require('mongoose');

const commissionSchema = new mongoose.Schema({
  appId: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    ref: 'App'
  },
  
  affiliate: {
    type: mongoose.Schema.ObjectId,
    ref: 'Affiliate',
    required: true
  },
  
  user: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  },
  
  subscription: {
    type: mongoose.Schema.ObjectId,
    ref: 'Subscription',
    required: true
  },
  
  amount: {
    type: Number,
    required: true
  },
  
  currency: {
    type: String,
    required: true,
    enum: ['XAF', 'XOF', 'GMD', 'CDF', 'GNF', 'USD', 'EUR'],
    default: 'XAF'
  },
  
  commissionRate: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  
  commissionAmount: {
    type: Number,
    required: true
  },
  
  status: {
    type: String,
    enum: ['pending', 'paid', 'cancelled'],
    default: 'pending'
  },
  
  paidAt: Date,
  
  paymentReference: String,
  
  month: {
    type: Number,
    required: true,
    min: 1,
    max: 12
  },
  
  year: {
    type: Number,
    required: true
  },
  
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes
commissionSchema.index({ appId: 1, subscription: 1 }, { unique: true });
commissionSchema.index({ appId: 1, affiliate: 1, status: 1 });
commissionSchema.index({ appId: 1, month: 1, year: 1 });
commissionSchema.index({ appId: 1, status: 1 });
commissionSchema.index({ affiliate: 1, status: 1 });
commissionSchema.index({ month: 1, year: 1 });
commissionSchema.index({ status: 1 });

// Methods
commissionSchema.methods.markAsPaid = function(paymentReference) {
  this.status = 'paid';
  this.paidAt = new Date();
  this.paymentReference = paymentReference;
  return this.save();
};

commissionSchema.methods.cancel = function() {
  this.status = 'cancelled';
  return this.save();
};

commissionSchema.methods.toJSON = function() {
  const commission = this.toObject();
  delete commission.__v;
  return commission;
};

module.exports = mongoose.model('Commission', commissionSchema);