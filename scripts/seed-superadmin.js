// scripts/seed-superadmin.js
//
// Quick seed: creates a super_admin (or upgrades an existing admin to super_admin
// with mustChangePassword=true) without deleting anything.
//
// Usage:
//   SEED_EMAIL=test@proxidream.com SEED_PASSWORD=TempPass123! \
//   node scripts/seed-superadmin.js

require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('../src/api/models/admin/Admin');

async function main() {
  const email = process.env.SEED_EMAIL;
  const password = process.env.SEED_PASSWORD;
  if (!email || !password) {
    console.error('Missing env: SEED_EMAIL and SEED_PASSWORD are required.');
    process.exit(1);
  }
  if (!process.env.MONGO_URI) {
    console.error('Missing MONGO_URI');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('[seed] connected to Mongo');

  const lower = email.toLowerCase();
  let admin = await Admin.findOne({ email: lower }).select('+password');

  if (admin) {
    admin.password = password;
    admin.role = 'super_admin';
    admin.mustChangePassword = true;
    admin.isActive = true;
    admin.refreshTokens = [];
    await admin.save();
    console.log(`[seed] updated existing admin → super_admin: ${admin.email}`);
  } else {
    admin = await Admin.create({
      email: lower,
      password,
      firstName: process.env.SEED_FIRSTNAME || 'Test',
      lastName: process.env.SEED_LASTNAME || 'Admin',
      role: 'super_admin',
      assignedApps: [],
      mustChangePassword: true,
      isActive: true,
    });
    console.log(`[seed] created super_admin: ${admin.email}`);
  }

  console.log(`[seed] login with: ${email} / ${password}`);
  console.log('[seed] mustChangePassword=true → first login will prompt password reset via OTP');

  await mongoose.disconnect();
}

main().catch(err => { console.error('[seed] failed:', err); process.exit(1); });
