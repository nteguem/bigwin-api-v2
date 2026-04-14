// controllers/admin/authController.js

const crypto = require('crypto');
const Admin = require('../../models/admin/Admin');
const AdminOtpCode = require('../../models/admin/AdminOtpCode');
const authService = require('../../services/common/authService');
const mailService = require('../../services/common/mailService');
const { AppError, ErrorCodes } = require('../../../utils/AppError');
const catchAsync = require('../../../utils/catchAsync');

const OTP_TTL_MS = (parseInt(process.env.OTP_TTL_MINUTES || '10', 10)) * 60 * 1000;

function generateOtp() {
  // 6-digit code, uniformly distributed
  return String(crypto.randomInt(100000, 1000000));
}

function maskEmail(email) {
  if (!email) return '';
  const [user, domain] = email.split('@');
  if (!domain) return email;
  const visible = user.slice(0, Math.min(2, user.length));
  return `${visible}${'*'.repeat(Math.max(1, user.length - visible.length))}@${domain}`;
}

async function issueOtpFor(admin) {
  await AdminOtpCode.deleteMany({ admin: admin._id });
  const code = generateOtp();
  await AdminOtpCode.create({
    admin: admin._id,
    code,
    expiresAt: new Date(Date.now() + OTP_TTL_MS)
  });
  await mailService.sendOtp({
    to: admin.email,
    code,
    firstName: admin.firstName
  });
}

async function finalizeLogin(admin) {
  const tokens = authService.generateTokens(admin._id, 'admin');
  admin.refreshTokens.push(tokens.refreshToken);
  admin.lastLogin = new Date();
  await admin.save();
  return {
    success: true,
    message: 'Connexion admin réussie',
    data: {
      admin: admin.toJSON(),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken
    }
  };
}

/**
 * Step 1 — credentials. Always triggers an OTP email, never returns a token.
 */
exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return next(new AppError('Email et mot de passe requis', 400, ErrorCodes.VALIDATION_ERROR));
  }

  const admin = await Admin.findOne({ email: email.toLowerCase() }).select('+password +refreshTokens');

  if (!admin || !(await admin.comparePassword(password))) {
    return next(new AppError('Email ou mot de passe incorrect', 401, ErrorCodes.AUTH_INVALID_CREDENTIALS));
  }

  if (!admin.isActive) {
    return next(new AppError('Compte administrateur désactivé', 401, ErrorCodes.AUTH_ACCOUNT_DISABLED));
  }

  await issueOtpFor(admin);

  res.status(200).json({
    success: true,
    message: 'Code de vérification envoyé par email',
    data: {
      adminId: admin._id,
      maskedEmail: maskEmail(admin.email),
      expiresInMinutes: parseInt(process.env.OTP_TTL_MINUTES || '10', 10)
    }
  });
});

/**
 * Step 2 — verify OTP. On first login (mustChangePassword), returns a flag
 * instead of a token so the client can prompt password change.
 */
exports.verifyOtp = catchAsync(async (req, res, next) => {
  const { adminId, code } = req.body;

  if (!adminId || !code) {
    return next(new AppError('adminId et code requis', 400, ErrorCodes.VALIDATION_ERROR));
  }

  const otp = await AdminOtpCode.findOne({
    admin: adminId,
    code: String(code).trim()
  });

  if (!otp) {
    return next(new AppError('Code invalide', 400, ErrorCodes.AUTH_INVALID_CREDENTIALS));
  }

  if (otp.expiresAt.getTime() < Date.now()) {
    await otp.deleteOne();
    return next(new AppError('Code expiré, veuillez en demander un nouveau', 400, ErrorCodes.AUTH_INVALID_CREDENTIALS));
  }

  const admin = await Admin.findById(adminId).select('+refreshTokens');
  if (!admin || !admin.isActive) {
    return next(new AppError('Compte invalide ou désactivé', 401, ErrorCodes.AUTH_ACCOUNT_DISABLED));
  }

  await otp.deleteOne();

  if (admin.mustChangePassword) {
    // Short-lived ticket so set-password cannot be called without passing OTP first
    const ticket = crypto.randomBytes(24).toString('hex');
    await AdminOtpCode.create({
      admin: admin._id,
      code: ticket,
      expiresAt: new Date(Date.now() + OTP_TTL_MS)
    });

    return res.status(200).json({
      success: true,
      message: 'Changement de mot de passe requis',
      data: {
        requirePasswordChange: true,
        adminId: admin._id,
        passwordResetTicket: ticket
      }
    });
  }

  const payload = await finalizeLogin(admin);
  res.status(200).json(payload);
});

/**
 * Resend OTP — requires knowing adminId (received from /login response).
 */
exports.resendOtp = catchAsync(async (req, res, next) => {
  const { adminId } = req.body;
  if (!adminId) {
    return next(new AppError('adminId requis', 400, ErrorCodes.VALIDATION_ERROR));
  }
  const admin = await Admin.findById(adminId);
  if (!admin || !admin.isActive) {
    return next(new AppError('Compte invalide', 401, ErrorCodes.AUTH_ACCOUNT_DISABLED));
  }
  await issueOtpFor(admin);
  res.status(200).json({
    success: true,
    message: 'Nouveau code envoyé',
    data: {
      maskedEmail: maskEmail(admin.email),
      expiresInMinutes: parseInt(process.env.OTP_TTL_MINUTES || '10', 10)
    }
  });
});

/**
 * Step 3 — first-time password set. Requires the ticket returned by verifyOtp.
 */
exports.setPassword = catchAsync(async (req, res, next) => {
  const { adminId, passwordResetTicket, newPassword } = req.body;

  if (!adminId || !passwordResetTicket || !newPassword) {
    return next(new AppError('adminId, passwordResetTicket et newPassword requis', 400, ErrorCodes.VALIDATION_ERROR));
  }
  if (newPassword.length < 6) {
    return next(new AppError('Le mot de passe doit faire au moins 6 caractères', 400, ErrorCodes.VALIDATION_ERROR));
  }

  const ticket = await AdminOtpCode.findOne({ admin: adminId, code: passwordResetTicket });
  if (!ticket || ticket.expiresAt.getTime() < Date.now()) {
    if (ticket) await ticket.deleteOne();
    return next(new AppError('Ticket invalide ou expiré', 400, ErrorCodes.AUTH_INVALID_TOKEN));
  }

  const admin = await Admin.findById(adminId).select('+password +refreshTokens');
  if (!admin || !admin.isActive) {
    return next(new AppError('Compte invalide', 401, ErrorCodes.AUTH_ACCOUNT_DISABLED));
  }

  admin.password = newPassword;
  admin.mustChangePassword = false;
  await admin.save();
  await ticket.deleteOne();

  const payload = await finalizeLogin(admin);
  res.status(200).json(payload);
});

exports.logout = catchAsync(async (req, res, next) => {
  const { refreshToken } = req.body;
  if (refreshToken && req.admin) {
    req.admin.refreshTokens = req.admin.refreshTokens.filter(token => token !== refreshToken);
    await req.admin.save();
  }
  res.status(200).json({ success: true, message: 'Déconnexion réussie' });
});

exports.logoutAll = catchAsync(async (req, res, next) => {
  req.admin.refreshTokens = [];
  await req.admin.save();
  res.status(200).json({ success: true, message: 'Déconnexion de tous les appareils réussie' });
});

exports.refresh = catchAsync(async (req, res, next) => {
  const tokens = authService.generateTokens(req.admin._id, 'admin');
  const tokenIndex = req.admin.refreshTokens.indexOf(req.refreshToken);
  req.admin.refreshTokens[tokenIndex] = tokens.refreshToken;
  await req.admin.save();
  res.status(200).json({
    success: true,
    message: 'Token renouvelé avec succès',
    data: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }
  });
});

exports.getMe = catchAsync(async (req, res, next) => {
  res.status(200).json({ success: true, data: { admin: req.admin } });
});

exports.updateMe = catchAsync(async (req, res, next) => {
  const { firstName, lastName, phone } = req.body;
  const updatedAdmin = await Admin.findByIdAndUpdate(
    req.admin._id,
    { firstName, lastName, phone },
    { new: true, runValidators: true }
  );
  res.status(200).json({
    success: true,
    message: 'Profil mis à jour avec succès',
    data: { admin: updatedAdmin }
  });
});

exports.changePassword = catchAsync(async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return next(new AppError('Mot de passe actuel et nouveau mot de passe requis', 400, ErrorCodes.VALIDATION_ERROR));
  }
  const admin = await Admin.findById(req.admin._id).select('+password');
  if (!(await admin.comparePassword(currentPassword))) {
    return next(new AppError('Mot de passe actuel incorrect', 400, ErrorCodes.AUTH_INVALID_CREDENTIALS));
  }
  admin.password = newPassword;
  admin.mustChangePassword = false;
  await admin.save();
  res.status(200).json({ success: true, message: 'Mot de passe modifié avec succès' });
});
