// src/api/controllers/common/appInfoController.js
//
// Endpoint public retournant les infos non-sensibles d'une app pour
// l'identifiant fourni dans X-App-Id. Utilisé par les frontends
// (portail affilié, futur landing page, etc.) pour récupérer le
// branding (logo, couleurs, displayName, lien Play Store) sans avoir
// à hardcoder ces valeurs côté client.

const App = require('../../models/common/App');
const AffiliateConfig = require('../../models/affiliate/AffiliateConfig');
const catchAsync = require('../../../utils/catchAsync');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

const PUBLIC_FIELDS = [
  'appId',
  'name',
  'displayName',
  'description',
  'branding',
  'playStoreUrl',
  'supportEmail',
  'googlePlay.packageName',
];

/**
 * GET /app/info
 * Header: X-App-Id (résolu par identifyApp → req.appId)
 *
 * Retourne uniquement les champs publics (pas de clés API, pas de
 * service account, etc.).
 */
exports.getAppInfo = catchAsync(async (req, res) => {
  const appId = req.appId;
  if (!appId) {
    throw new AppError(
      'Header X-App-Id requis.',
      400,
      ErrorCodes.VALIDATION_ERROR
    );
  }

  const [app, affiliateConfig] = await Promise.all([
    App.findOne({ appId, isActive: true })
      .select(PUBLIC_FIELDS.join(' '))
      .lean(),
    AffiliateConfig.findOne({ appId })
      .select('isEnabled payoutCountries')
      .lean(),
  ]);

  if (!app) {
    throw new AppError(
      `Application ${appId} introuvable.`,
      404,
      ErrorCodes.NOT_FOUND
    );
  }

  // Codes pays activés pour l'affiliation (uppercase normalisé). Permet
  // au mobile non authentifié de cacher le bouton "Gagner de l'argent"
  // si le pays détecté par IP n'est pas dans cette liste.
  const enabledCountryCodes =
    affiliateConfig?.isEnabled === false
      ? []
      : (affiliateConfig?.payoutCountries || [])
          .filter((c) => c.enabled !== false)
          .map((c) => (c.code || '').toUpperCase());

  res.status(200).json({
    success: true,
    data: {
      appId: app.appId,
      name: app.name,
      displayName: app.displayName,
      description: app.description,
      branding: app.branding || null,
      playStoreUrl: app.playStoreUrl || null,
      supportEmail: app.supportEmail || null,
      googlePlay: {
        packageName: app.googlePlay?.packageName || null,
      },
      affiliate: {
        enabled: !!affiliateConfig?.isEnabled,
        enabledCountryCodes,
      },
    },
  });
});
