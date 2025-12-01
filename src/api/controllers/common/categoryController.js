// controllers/common/categoryController.js

const categoryService = require('../../services/common/categoryService');
const { formatSuccess, formatError } = require('../../../utils/responseFormatter');

class CategoryController {

  async getCategories(req, res) {
    try {
     console.log('[CategoryController] req.query BRUT:', req.query); // ⭐ AJOUTE CETTE LIGNE
    
    const appId = req.appId;
    const { offset = 0, limit = 10, isVip, isActive } = req.query;
    
    console.log('[CategoryController] isVip:', isVip); // ⭐ AJOUTE CETTE LIGNE
    console.log('[CategoryController] isActive:', isActive); // ⭐ AJOUTE CETTE LIGNE
    
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

  async getCategoryById(req, res) {
    try {
      const appId = req.appId; // ⭐ AJOUT
      const { id } = req.params;
      const category = await categoryService.getCategoryById(appId, id); // ⭐ AJOUT appId

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

  async createCategory(req, res) {
    try {
      const appId = req.appId; // ⭐ AJOUT
      const { name, description, icon, successRate, isVip, isActive } = req.body;

      if (!name) {
        return formatError(res, 'Name is required', 400);
      }

      if (successRate !== undefined && (successRate < 0 || successRate > 100)) {
        return formatError(res, 'Success rate must be between 0 and 100', 400);
      }

      const categoryData = {
        name,
        description,
        icon,
        successRate,
        isActive,
        isVip
      };

      const category = await categoryService.createCategory(appId, categoryData); // ⭐ AJOUT appId
      
      res.status(201);
      formatSuccess(res, {
        data: category,
        message: 'Category created successfully'
      });
    } catch (error) {
      if (error.code === 11000) {
        return formatError(res, 'Category name already exists', 409);
      }
      formatError(res, error.message, 500);
    }
  }

  async updateCategory(req, res) {
    try {
      const appId = req.appId; // ⭐ AJOUT
      const { id } = req.params;
      const updates = req.body;

      if (updates.successRate !== undefined && (updates.successRate < 0 || updates.successRate > 100)) {
        return formatError(res, 'Success rate must be between 0 and 100', 400);
      }

      const category = await categoryService.updateCategory(appId, id, updates); // ⭐ AJOUT appId

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

  async deleteCategory(req, res) {
    try {
      const appId = req.appId; // ⭐ AJOUT
      const { id } = req.params;
      const category = await categoryService.deactivateCategory(appId, id); // ⭐ AJOUT appId

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