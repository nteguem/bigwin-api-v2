// controllers/admin/categoryController.js

const categoryService = require('../../services/common/categoryService');
const { formatSuccess, formatError } = require('../../../utils/responseFormatter');

class CategoryController {

  // GET /categories - Récupérer toutes les catégories
  async getCategories(req, res) {
    try {
      // ⭐ Récupérer appId
      const appId = req.appId;
      
      const { offset = 0, limit = 10, isVip, isActive } = req.query;
      
      // ⭐ Passer appId au service
      const result = await categoryService.getCategories(appId, {
        offset: parseInt(offset),
        limit: parseInt(limit),
        isVip: isVip !== undefined ? isVip === 'true' : null,
        isActive: isActive !== undefined ? isActive === 'true' : null
      });

      formatSuccess(res, {
        data: result.data,
        pagination: result.pagination,
        message: 'Categories retrieved successfully'
      });
    } catch (error) {
      formatError(res, error.message, 500);
    }
  }

  // GET /categories/:id - Récupérer une catégorie par ID
  async getCategoryById(req, res) {
    try {
      // ⭐ Récupérer appId
      const appId = req.appId;
      
      const { id } = req.params;
      
      // ⭐ Passer appId au service
      const category = await categoryService.getCategoryById(appId, id);

      if (!category) {
        return formatError(res, 'Category not found', 404);
      }

      formatSuccess(res, {
        data: category,
        message: 'Category retrieved successfully'
      });
    } catch (error) {
      formatError(res, error.message, 500);
    }
  }

  // POST /categories - Créer une nouvelle catégorie
  async createCategory(req, res) {
    try {
      // ⭐ Récupérer appId
      const appId = req.appId;
      
      const { name, description, icon, successRate, isVip, isActive } = req.body;

      if (!name) {
        return formatError(res, 'Name is required', 400);
      }

      // Validation du successRate
      if (successRate !== undefined && (successRate < 0 || successRate > 100)) {
        return formatError(res, 'Success rate must be between 0 and 100', 400);
      }

      const categoryData = {
        name,
        description,
        icon,
        successRate,
        isActive,
        isVip: isVip
      };

      // ⭐ Passer appId au service
      const category = await categoryService.createCategory(appId, categoryData);
      
      res.status(201);
      formatSuccess(res, {
        data: category,
        message: 'Category created successfully'
      });
    } catch (error) {
      if (error.code === 11000) {
        return formatError(res, 'Category name already exists', 409);
      }
      console.error('Error creating category:', error);
      formatError(res, error.message, 500);
    }
  }

  // PUT /categories/:id - Mettre à jour une catégorie
  async updateCategory(req, res) {
    try {
      // ⭐ Récupérer appId
      const appId = req.appId;
      
      const { id } = req.params;
      const updates = req.body;

      // Validation du successRate si présent dans les updates
      if (updates.successRate !== undefined && (updates.successRate < 0 || updates.successRate > 100)) {
        return formatError(res, 'Success rate must be between 0 and 100', 400);
      }

      // ⭐ Passer appId au service
      const category = await categoryService.updateCategory(appId, id, updates);

      if (!category) {
        return formatError(res, 'Category not found', 404);
      }

      formatSuccess(res, {
        data: category,
        message: 'Category updated successfully'
      });
    } catch (error) {
      if (error.code === 11000) {
        return formatError(res, 'Category name already exists', 409);
      }
      formatError(res, error.message, 500);
    }
  }

  // DELETE /categories/:id - Désactiver une catégorie
  async deleteCategory(req, res) {
    try {
      // ⭐ Récupérer appId
      const appId = req.appId;
      
      const { id } = req.params;
      
      // ⭐ Passer appId au service
      const category = await categoryService.deactivateCategory(appId, id);

      if (!category) {
        return formatError(res, 'Category not found', 404);
      }

      formatSuccess(res, {
        data: category,
        message: 'Category deactivated successfully'
      });
    } catch (error) {
      formatError(res, error.message, 500);
    }
  }
}

module.exports = new CategoryController();