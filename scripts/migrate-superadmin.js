// scripts/migrate-superadmin.js
//
// One-shot migration to seed RBAC + 2FA refactor.
//   1. Deletes the legacy production super_admin (identified by SUPERADMIN_LEGACY_EMAIL).
//   2. Creates a fresh super_admin from SUPERADMIN_NEW_EMAIL / SUPERADMIN_NEW_PASSWORD.
//      mustChangePassword=true so the new owner is forced to set their own password
//      via the 2FA login flow on first login.
//
// Usage:
//   SUPERADMIN_LEGACY_EMAIL=oldadmin@example.com \
//   SUPERADMIN_NEW_EMAIL=newadmin@proxidream.com \
//   SUPERADMIN_NEW_PASSWORD=Strong!Temp123 \
//   SUPERADMIN_NEW_FIRSTNAME=Roland \
//   SUPERADMIN_NEW_LASTNAME=Nteguem \
//   node scripts/migrate-superadmin.js
//
// Safety: the script aborts unless --confirm is passed.

require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('../src/api/models/admin/Admin');
const AdminOtpCode = require('../src/api/models/admin/AdminOtpCode');

async function main() {
  if (!process.argv.includes('--confirm')) {
    console.error('\nRefusing to run without --confirm flag. This script DELETES an admin in production.\n');
    process.exit(1);
  }

  const legacyEmail = process.env.SUPERADMIN_LEGACY_EMAIL;
  const newEmail = process.env.SUPERADMIN_NEW_EMAIL;
  const newPassword = process.env.SUPERADMIN_NEW_PASSWORD;
  const newFirstName = process.env.SUPERADMIN_NEW_FIRSTNAME || '';
  const newLastName = process.env.SUPERADMIN_NEW_LASTNAME || '';

  if (!legacyEmail || !newEmail || !newPassword) {
    console.error('Missing env: SUPERADMIN_LEGACY_EMAIL, SUPERADMIN_NEW_EMAIL, SUPERADMIN_NEW_PASSWORD are required.');
    process.exit(1);
  }
  if (!process.env.MONGO_URI) {
    console.error('Missing MONGO_URI');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('[migrate] connected to Mongo');

  // Step 1: delete legacy admin
  const legacy = await Admin.findOneAndDelete({ email: legacyEmail.toLowerCase() });
  if (legacy) {
    await AdminOtpCode.deleteMany({ admin: legacy._id });
    console.log(`[migrate] deleted legacy admin: ${legacy.email} (id=${legacy._id})`);
  } else {
    console.log(`[migrate] no legacy admin found for ${legacyEmail} — skipping deletion`);
  }

  // Step 2: create fresh super_admin
  const existing = await Admin.findOne({ email: newEmail.toLowerCase() });
  if (existing) {
    console.error(`[migrate] new email ${newEmail} already exists — aborting to avoid overwrite`);
    process.exit(1);
  }

  const created = await Admin.create({
    email: newEmail.toLowerCase(),
    password: newPassword,
    firstName: newFirstName,
    lastName: newLastName,
    role: 'super_admin',
    assignedApps: [],
    mustChangePassword: true,
    isActive: true,
  });

  console.log(`[migrate] created super_admin: ${created.email} (id=${created._id})`);
  console.log('[migrate] mustChangePassword=true — first login will prompt password reset via 2FA flow');

  await mongoose.disconnect();
  console.log('[migrate] done');
}

main().catch(err => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
