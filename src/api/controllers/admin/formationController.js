// controllers/admin/formationController.js

const formationService = require('../../services/common/formationService');
const { formatSuccess, formatError } = require('../../../utils/responseFormatter');

class FormationController {

  // GET /formations - Récupérer toutes les formations
  async getFormations(req, res) {
    try {
      // ⭐ Récupérer appId
      const appId = req.appId;
      
      const { offset = 0, limit = 10, isActive, lang = 'fr' } = req.query;
      
      // ⭐ Passer appId au service
      const result = await formationService.getFormations(appId, {
        offset: parseInt(offset),
        limit: parseInt(limit),
        isActive: isActive !== undefined ? isActive === 'true' : null,
        lang
      });

      formatSuccess(res, {
        data: result.data,
        pagination: result.pagination,
        message: 'Formations retrieved successfully'
      });
    } catch (error) {
      formatError(res, error.message, 500);
    }
  }

  // GET /formations/:id - Récupérer une formation par ID
  async getFormationById(req, res) {
    try {
      // ⭐ Récupérer appId
      const appId = req.appId;
      
      const { id } = req.params;
      const { lang = 'fr' } = req.query;
      
      // ⭐ Passer appId au service
      const formation = await formationService.getFormationById(appId, id, lang);

      if (!formation) {
        return formatError(res, 'Formation not found', 404);
      }

      formatSuccess(res, {
        data: formation,
        message: 'Formation retrieved successfully'
      });
    } catch (error) {
      formatError(res, error.message, 500);
    }
  }

  // POST /formations - Créer une nouvelle formation
  async createFormation(req, res) {
    try {
      // ⭐ Récupérer appId
      const appId = req.appId;
      
      const { title, description, htmlContent, isAccessible, requiredPackages } = req.body;
      
      const formationData = {
        title,
        description,
        htmlContent: htmlContent || { fr: '', en: '' },
        isAccessible: isAccessible !== undefined ? isAccessible : true,
        requiredPackages: requiredPackages || []
      };

      // ⭐ Passer appId au service
      const formation = await formationService.createFormation(appId, formationData);
      
      res.status(201);
      formatSuccess(res, {
        data: formation,
        message: 'Formation created successfully'
      });
      
    } catch (error) {
      formatError(res, error.message, 500);
    }
  }

  // PUT /formations/:id - Mettre à jour une formation
  async updateFormation(req, res) {
    try {
      // ⭐ Récupérer appId
      const appId = req.appId;
      
      const { id } = req.params;
      const updates = req.body;

      // ⭐ Passer appId au service
      const formation = await formationService.updateFormation(appId, id, updates);

      if (!formation) {
        return formatError(res, 'Formation not found', 404);
      }

      formatSuccess(res, {
        data: formation,
        message: 'Formation updated successfully'
      });
    } catch (error) {
      formatError(res, error.message, 500);
    }
  }

  // DELETE /formations/:id - Désactiver une formation
  async deleteFormation(req, res) {
    try {
      // ⭐ Récupérer appId
      const appId = req.appId;
      
      const { id } = req.params;
      
      // ⭐ Passer appId au service
      const formation = await formationService.deactivateFormation(appId, id);

      if (!formation) {
        return formatError(res, 'Formation not found', 404);
      }

      formatSuccess(res, {
        data: formation,
        message: 'Formation deactivated successfully'
      });
    } catch (error) {
      formatError(res, error.message, 500);
    }
  }
}

module.exports = new FormationController();