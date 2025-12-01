// controllers/admin/categoryController.js

const categoryService = require('../../services/common/categoryService');
const { formatSuccess, formatError } = require('../../../utils/responseFormatter');

class CategoryController {

  async getCategories(req, res) {
    try {
      const appId = req.appId;
      const { offset = 0, limit = 10, isVip, isActive } = req.query;
      
      // ⭐ CONVERSION CORRECTE
      const filters = {
        offset: parseInt(offset),
        limit: parseInt(limit),
        isVip: isVip === 'true' ? true : isVip === 'false' ? false : null,
        isActive: isActive === 'true' ? true : isActive === 'false' ? false : null
      };
      
      console.log('[CategoryController] Query:', req.query);
      console.log('[CategoryController] Filters:', filters);
      
      const result = await categoryService.getCategories(appId, filters);

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
      const appId = req.appId;
      const { id } = req.params;
      const category = await categoryService.getCategoryById(appId, id);
      if (!category) return formatError(res, 'Category not found', 404);
      formatSuccess(res, { data: category, message: 'Category retrieved successfully' });
    } catch (error) {
      formatError(res, error.message, 500);
    }
  }

  async createCategory(req, res) {
    try {
      const appId = req.appId;
      const { name, description, icon, successRate, isVip, isActive } = req.body;
      if (!name) return formatError(res, 'Name is required', 400);
      if (successRate !== undefined && (successRate < 0 || successRate > 100)) {
        return formatError(res, 'Success rate must be between 0 and 100', 400);
      }
      const category = await categoryService.createCategory(appId, { name, description, icon, successRate, isActive, isVip });
      res.status(201);
      formatSuccess(res, { data: category, message: 'Category created successfully' });
    } catch (error) {
      if (error.code === 11000) return formatError(res, 'Category name already exists', 409);
      formatError(res, error.message, 500);
    }
  }

  async updateCategory(req, res) {
    try {
      const appId = req.appId;
      const { id } = req.params;
      const updates = req.body;
      if (updates.successRate !== undefined && (updates.successRate < 0 || updates.successRate > 100)) {
        return formatError(res, 'Success rate must be between 0 and 100', 400);
      }
      const category = await categoryService.updateCategory(appId, id, updates);
      if (!category) return formatError(res, 'Category not found', 404);
      formatSuccess(res, { data: category, message: 'Category updated successfully' });
    } catch (error) {
      if (error.code === 11000) return formatError(res, 'Category name already exists', 409);
      formatError(res, error.message, 500);
    }
  }

  async deleteCategory(req, res) {
    try {
      const appId = req.appId;
      const { id } = req.params;
      const category = await categoryService.deactivateCategory(appId, id);
      if (!category) return formatError(res, 'Category not found', 404);
      formatSuccess(res, { data: category, message: 'Category deactivated successfully' });
    } catch (error) {
      formatError(res, error.message, 500);
    }
  }
}

module.exports = new CategoryController();