// src/api/controllers/admin/globalConfigController.js
//
// Gestion de la configuration GLOBALE (feature flags transverses, toutes apps).
// Toutes les routes sont super_admin only (cf. routes/index.js). Le toggle agit
// sur l'ENSEMBLE des apps d'un coup (singleton plateforme).

const GlobalConfig = require('../../models/common/GlobalConfig');
const catchAsync = require('../../../utils/catchAsync');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

/**
 * GET /admin/global-config
 * Retourne la config globale courante (crée le singleton si absent).
 */
exports.getGlobalConfig = catchAsync(async (req, res) => {
  const config = await GlobalConfig.getSingleton();

  res.status(200).json({
    success: true,
    data: {
      features: config.features
    }
  });
});

/**
 * PATCH /admin/global-config/weekly-report
 * Body: { enabled: boolean, daysBack?: number }
 * Active/désactive le bilan des coupons pour TOUTES les apps.
 */
exports.updateWeeklyReport = catchAsync(async (req, res) => {
  const { enabled, daysBack } = req.body;

  if (typeof enabled !== 'boolean') {
    throw new AppError(
      'Le champ "enabled" (booléen) est requis.',
      400,
      ErrorCodes.VALIDATION_ERROR
    );
  }

  const update = { 'features.weeklyReport.enabled': enabled };

  if (daysBack !== undefined) {
    const n = parseInt(daysBack, 10);
    if (Number.isNaN(n) || n < 1 || n > 30) {
      throw new AppError(
        'Le champ "daysBack" doit être un entier entre 1 et 30.',
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }
    update['features.weeklyReport.daysBack'] = n;
  }

  // Upsert : garantit la présence du singleton même au tout premier appel.
  const config = await GlobalConfig.findOneAndUpdate(
    { _singleton: 'global' },
    { $set: update, $setOnInsert: { _singleton: 'global' } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  res.status(200).json({
    success: true,
    message: `Bilan des coupons ${enabled ? 'activé' : 'désactivé'} pour toutes les apps`,
    data: {
      features: config.features
    }
  });
});
