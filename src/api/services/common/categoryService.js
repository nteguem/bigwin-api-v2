// services/common/categoryService.js

const Category = require('../../models/common/Category');

class CategoryService {
  
  async createCategory(appId, data) { // ⭐ AJOUT appId
    const category = new Category({ ...data, appId }); // ⭐ AJOUT appId
    return await category.save();
  }

  async getCategories(appId, { offset = 0, limit = 10, isVip = null, isActive = null }) { // ⭐ AJOUT appId
    const filter = { appId }; // ⭐ AJOUT appId
    
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

  async getCategoryById(appId, id) { // ⭐ AJOUT appId
    return await Category.findOne({ _id: id, appId }); // ⭐ AJOUT appId
  }

  async getCategoryByName(appId, name) { // ⭐ AJOUT appId
    return await Category.findOne({ name, appId, isActive: true }); // ⭐ AJOUT appId
  }

  async updateCategory(appId, id, data) { // ⭐ AJOUT appId
    return await Category.findOneAndUpdate({ _id: id, appId }, data, { new: true }); // ⭐ AJOUT appId
  }

  async deactivateCategory(appId, id) { // ⭐ AJOUT appId
    return await Category.findOneAndUpdate({ _id: id, appId }, { isActive: false }, { new: true }); // ⭐ AJOUT appId
  }

  async getCategoriesByType(appId, isVip, { offset = 0, limit = 10 }) { // ⭐ AJOUT appId
    return await this.getCategories(appId, { offset, limit, isVip, isActive: true }); // ⭐ AJOUT appId
  }

  async categoryExists(appId, id) { // ⭐ AJOUT appId
    const category = await Category.findOne({ _id: id, appId, isActive: true }); // ⭐ AJOUT appId
    return !!category;
  }
}

module.exports = new CategoryService();