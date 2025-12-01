// services/common/categoryService.js

const Category = require('../../models/common/Category');

class CategoryService {
  
  async createCategory(appId, data) {
    const category = new Category({ ...data, appId });
    return await category.save();
  }

  async getCategories(appId, { offset = 0, limit = 10, isVip = null, isActive = null }) {
    const filter = { appId };
    
    // Les valeurs arrivent déjà en boolean du controller
    if (isActive !== null) {
      filter.isActive = isActive;
    }
    
    if (isVip !== null) {
      filter.isVip = isVip;
    }

    const categories = await Category.find(filter)
      .skip(offset)
      .limit(limit)
      .sort({ createdAt: -1 });

    const total = await Category.countDocuments(filter);

    return {
      data: categories,
      pagination: {
        offset,
        limit,
        total,
        hasNext: (offset + limit) < total
      }
    };
  }

  async getCategoryById(appId, id) {
    return await Category.findOne({ _id: id, appId });
  }

  async getCategoryByName(appId, name) {
    return await Category.findOne({ name, appId, isActive: true });
  }

  async updateCategory(appId, id, data) {
    return await Category.findOneAndUpdate(
      { _id: id, appId },
      data, 
      { new: true }
    );
  }

  async deactivateCategory(appId, id) {
    return await Category.findOneAndUpdate(
      { _id: id, appId },
      { isActive: false }, 
      { new: true }
    );
  }

  async getCategoriesByType(appId, isVip, { offset = 0, limit = 10 }) {
    return await this.getCategories(appId, { offset, limit, isVip, isActive: true });
  }

  async categoryExists(appId, id) {
    const category = await Category.findOne({ _id: id, appId, isActive: true });
    return !!category;
  }
}

module.exports = new CategoryService();