// services/common/categoryService.js

const Category = require('../../models/common/Category');

class CategoryService {
  
  /**
   * Créer une nouvelle catégorie
   * @param {String} appId - ID de l'application
   */
  async createCategory(appId, data) {
    try {
      // ⭐ Ajouter appId aux données
      const category = new Category({ ...data, appId });
      return await category.save();
    } catch(e) {
      console.log("error", e);
    }
  }

  /**
   * Récupérer toutes les catégories avec pagination
   * @param {String} appId - ID de l'application
   */
  async getCategories(appId, { offset = 0, limit = 10, isVip = null, isActive = null }) {
    // ⭐ Filtrer par appId
    const filter = { appId };
    
    // Ne filtrer que si explicitement demandé
    if (isActive !== null) {
      filter.isActive = isActive;
    }
    
    if (isVip !== null) {
      filter.isVip = isVip;
    }

    console.log('Filter applied:', filter); // DEBUG

    const categories = await Category.find(filter)
      .skip(offset)
      .limit(limit)
      .sort({ createdAt: -1 });

    // ⭐ Compter avec appId
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

  /**
   * Récupérer une catégorie par ID
   * @param {String} appId - ID de l'application
   */
  async getCategoryById(appId, id) {
    // ⭐ Filtrer par appId
    return await Category.findOne({ _id: id, appId });
  }

  /**
   * Récupérer une catégorie par nom
   * @param {String} appId - ID de l'application
   */
  async getCategoryByName(appId, name) {
    // ⭐ Filtrer par appId
    return await Category.findOne({ name, appId, isActive: true });
  }

  /**
   * Mettre à jour une catégorie
   * @param {String} appId - ID de l'application
   */
  async updateCategory(appId, id, data) {
    // ⭐ Filtrer par appId
    return await Category.findOneAndUpdate(
      { _id: id, appId }, // ⭐ AJOUT
      data, 
      { new: true }
    );
  }

  /**
   * Désactiver une catégorie (soft delete)
   * @param {String} appId - ID de l'application
   */
  async deactivateCategory(appId, id) {
    // ⭐ Filtrer par appId
    return await Category.findOneAndUpdate(
      { _id: id, appId }, // ⭐ AJOUT
      { isActive: false }, 
      { new: true }
    );
  }

  /**
   * Récupérer les catégories par type (free/vip)
   * @param {String} appId - ID de l'application
   */
  async getCategoriesByType(appId, isVip, { offset = 0, limit = 10 }) {
    return await this.getCategories(appId, { offset, limit, isVip, isActive: true });
  }

  /**
   * Vérifier si une catégorie existe et est active
   * @param {String} appId - ID de l'application
   */
  async categoryExists(appId, id) {
    // ⭐ Filtrer par appId
    const category = await Category.findOne({ _id: id, appId, isActive: true });
    return !!category;
  }
}

module.exports = new CategoryService();