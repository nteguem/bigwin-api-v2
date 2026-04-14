// src/api/middlewares/admin/rbac.js

const { AppError, ErrorCodes } = require('../../../utils/AppError');

/**
 * Restrict access to given admin roles.
 * Assumes req.admin is already populated by adminAuth.protect.
 */
exports.authorize = (...allowedRoles) => (req, res, next) => {
  if (!req.admin) {
    return next(new AppError('Authentification requise', 401, ErrorCodes.AUTH_TOKEN_MISSING));
  }
  if (!allowedRoles.includes(req.admin.role)) {
    return next(new AppError('Accès refusé pour ce rôle', 403, ErrorCodes.FORBIDDEN));
  }
  next();
};

/**
 * For non-super_admin, require that the current request's appId is among
 * the admin's assignedApps. Must run after identifyApp (sets req.appId)
 * and adminAuth.protect (sets req.admin).
 */
exports.enforceAppScope = (req, res, next) => {
  if (!req.admin) {
    return next(new AppError('Authentification requise', 401, ErrorCodes.AUTH_TOKEN_MISSING));
  }
  if (req.admin.role === 'super_admin') return next();

  if (!req.appId) {
    return next(new AppError('En-tête X-App-Id requis', 400, ErrorCodes.VALIDATION_ERROR));
  }

  // assignedApps may be populated objects (with .appId) or plain ObjectIds.
  const assigned = (req.admin.assignedApps || []).map(a => (a && a.appId) ? a.appId : String(a));
  if (!assigned.includes(String(req.appId))) {
    return next(new AppError('Accès refusé sur cette application', 403, ErrorCodes.FORBIDDEN));
  }
  next();
};

/**
 * Only allow safe (read) HTTP methods. Use to enforce read-only scope
 * for roles like `investisseur` on resources they can view but not mutate.
 */
exports.readOnly = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  return next(new AppError('Ce rôle est en lecture seule', 403, ErrorCodes.FORBIDDEN));
};
