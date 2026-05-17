// src/api/controllers/common/publicCatalogController.js
//
// =====================================================================
// ⚠️  ROUTE PUBLIQUE LECTURE SEULE — V1 INTERNE
// =====================================================================
// Sert au backoffice wintips pour alimenter la dropdown de mapping
// "categorie source" : il faut pouvoir choisir parmi toutes les
// categories bigwin (toutes les apps multi-tenant : bigwin, goatips,
// goodtips, strategytips, wisetips + shared).
//
// V1 : pas d'auth. A proteger en V2.
// =====================================================================

const Category = require('../../models/common/Category');
const { formatSuccess, formatError } = require('../../../utils/responseFormatter');

/**
 * GET /api/public/catalog/categories
 *
 * Retourne toutes les categories ACTIVES de toutes les apps bigwin,
 * groupees par appId. Format optimise pour l'affichage dans une UI
 * multi-select (libelle = nom FR + appId).
 */
exports.listAllCategories = async (req, res) => {
  try {
    const cats = await Category.find({ isActive: true })
      .select('_id name description icon isVip appId appIds')
      .sort({ appId: 1 })
      .lean();

    // Format aplati friendly pour UI
    const formatted = cats.map((c) => {
      const nameFr = c.name?.fr || c.name?.en || '?';
      return {
        _id: String(c._id),
        appId: c.appId,                    // ex: 'bigwin', 'goatips', 'shared'
        appIds: c.appIds || [],            // liste des apps qui diffusent cette categorie
        name: nameFr,
        description: c.description?.fr || c.description?.en || '',
        icon: c.icon,
        isVip: !!c.isVip,
      };
    });

    return formatSuccess(res, { data: formatted });
  } catch (err) {
    return formatError(res, err.message, 500);
  }
};
