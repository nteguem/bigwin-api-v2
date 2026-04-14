// src/api/models/admin/Admin.js

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const ADMIN_ROLES = ['super_admin', 'pronostiqueur', 'investisseur'];

const adminSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },

  password: {
    type: String,
    required: true,
    minlength: 6,
    select: false
  },

  firstName: String,
  lastName: String,
  phone: String,

  role: {
    type: String,
    enum: ADMIN_ROLES,
    required: true,
    default: 'super_admin'
  },

  // Apps the admin is allowed to operate on. Ignored for super_admin.
  assignedApps: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'App'
  }],

  mustChangePassword: {
    type: Boolean,
    default: true
  },

  isActive: {
    type: Boolean,
    default: true
  },

  lastLogin: Date,
  refreshTokens: [String],

  createdAt: {
    type: Date,
    default: Date.now
  }
});

adminSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

adminSchema.methods.toJSON = function() {
  const admin = this.toObject();
  delete admin.password;
  delete admin.refreshTokens;
  delete admin.__v;
  return admin;
};

adminSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

const Admin = mongoose.model('Admin', adminSchema);
Admin.ROLES = ADMIN_ROLES;

module.exports = Admin;
