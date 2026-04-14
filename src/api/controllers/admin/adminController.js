// controllers/admin/adminController.js
// Super admin only — manages admin accounts and RBAC assignment.

const crypto = require('crypto');
const Admin = require('../../models/admin/Admin');
const AdminOtpCode = require('../../models/admin/AdminOtpCode');
const mailService = require('../../services/common/mailService');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const catchAsync = require('../../../utils/catchAsync');

const ROLES = Admin.ROLES;

function generateTempPassword() {
  return crypto.randomBytes(6).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) + '!';
}

function sanitizeAssignedApps(role, assignedApps) {
  if (role === 'super_admin') return [];
  return Array.isArray(assignedApps) ? assignedApps : [];
}

exports.listAdmins = catchAsync(async (req, res) => {
  const admins = await Admin.find().populate('assignedApps', 'appId name displayName').sort({ createdAt: -1 });
  res.status(200).json({ success: true, data: { admins } });
});

exports.getAdmin = catchAsync(async (req, res, next) => {
  const admin = await Admin.findById(req.params.id).populate('assignedApps', 'appId name displayName');
  if (!admin) return next(new AppError('Administrateur introuvable', 404, ErrorCodes.NOT_FOUND));
  res.status(200).json({ success: true, data: { admin } });
});

exports.createAdmin = catchAsync(async (req, res, next) => {
  const { email, firstName, lastName, phone, role, assignedApps } = req.body;

  if (!email || !role) {
    return next(new AppError('Email et rôle requis', 400, ErrorCodes.VALIDATION_ERROR));
  }
  if (!ROLES.includes(role)) {
    return next(new AppError(`Rôle invalide (valeurs: ${ROLES.join(', ')})`, 400, ErrorCodes.VALIDATION_ERROR));
  }
  if (role !== 'super_admin' && (!assignedApps || assignedApps.length === 0)) {
    return next(new AppError('Au moins une app doit être assignée à ce rôle', 400, ErrorCodes.VALIDATION_ERROR));
  }

  const existing = await Admin.findOne({ email: email.toLowerCase() });
  if (existing) return next(new AppError('Cet email est déjà utilisé', 409, ErrorCodes.DUPLICATE_OPERATION));

  const tempPassword = generateTempPassword();

  const admin = await Admin.create({
    email: email.toLowerCase(),
    password: tempPassword,
    firstName,
    lastName,
    phone,
    role,
    assignedApps: sanitizeAssignedApps(role, assignedApps),
    mustChangePassword: true,
    isActive: true
  });

  try {
    await mailService.sendWelcome({ to: admin.email, firstName, tempPassword, role });
  } catch (err) {
    // Email failure should not prevent admin creation; surface warning in response.
    return res.status(201).json({
      success: true,
      message: 'Admin créé, mais envoi de l\'email a échoué',
      data: { admin, emailSent: false, emailError: err.message }
    });
  }

  res.status(201).json({
    success: true,
    message: 'Administrateur créé et email envoyé',
    data: { admin, emailSent: true }
  });
});

exports.updateAdmin = catchAsync(async (req, res, next) => {
  const { firstName, lastName, phone, role, assignedApps, isActive } = req.body;

  if (role && !ROLES.includes(role)) {
    return next(new AppError('Rôle invalide', 400, ErrorCodes.VALIDATION_ERROR));
  }

  const admin = await Admin.findById(req.params.id);
  if (!admin) return next(new AppError('Administrateur introuvable', 404, ErrorCodes.NOT_FOUND));

  if (firstName !== undefined) admin.firstName = firstName;
  if (lastName !== undefined) admin.lastName = lastName;
  if (phone !== undefined) admin.phone = phone;
  if (isActive !== undefined) admin.isActive = isActive;
  if (role !== undefined) admin.role = role;
  if (role !== undefined || assignedApps !== undefined) {
    admin.assignedApps = sanitizeAssignedApps(admin.role, assignedApps !== undefined ? assignedApps : admin.assignedApps);
  }

  await admin.save();
  res.status(200).json({ success: true, message: 'Administrateur mis à jour', data: { admin } });
});

exports.deleteAdmin = catchAsync(async (req, res, next) => {
  if (String(req.params.id) === String(req.admin._id)) {
    return next(new AppError('Vous ne pouvez pas supprimer votre propre compte', 400, ErrorCodes.VALIDATION_ERROR));
  }
  const admin = await Admin.findByIdAndDelete(req.params.id);
  if (!admin) return next(new AppError('Administrateur introuvable', 404, ErrorCodes.NOT_FOUND));
  await AdminOtpCode.deleteMany({ admin: admin._id });
  res.status(200).json({ success: true, message: 'Administrateur supprimé' });
});

/**
 * Reset password: generate a new temp password, set mustChangePassword=true,
 * invalidate existing refresh tokens, email the new temp password.
 */
exports.resetPassword = catchAsync(async (req, res, next) => {
  const admin = await Admin.findById(req.params.id).select('+password +refreshTokens');
  if (!admin) return next(new AppError('Administrateur introuvable', 404, ErrorCodes.NOT_FOUND));

  const tempPassword = generateTempPassword();
  admin.password = tempPassword;
  admin.mustChangePassword = true;
  admin.refreshTokens = [];
  await admin.save();
  await AdminOtpCode.deleteMany({ admin: admin._id });

  try {
    await mailService.sendWelcome({ to: admin.email, firstName: admin.firstName, tempPassword, role: admin.role });
  } catch (err) {
    return res.status(200).json({
      success: true,
      message: 'Mot de passe réinitialisé mais l\'envoi de l\'email a échoué',
      data: { emailSent: false, emailError: err.message }
    });
  }

  res.status(200).json({ success: true, message: 'Mot de passe réinitialisé et email envoyé' });
});
