// src/api/services/common/categoryService.js

const Category = require('../../models/common/Category');

/**
 * CategoryService
 * ===============
 * 
 * GESTION DES CATÉGORIES PARTAGÉES :
 * - Toutes les méthodes incluent automatiquement les catégories avec appId = "shared"
 * - Exemple : getCategories("app1") retourne les catégories de app1 + les catégories shared
 * - Les catégories partagées sont visibles dans toutes les applications
 */

class CategoryService {
  
  /**
   * Créer une catégorie
   * @param {String} appId - ID de l'application (ou "shared" pour catégorie partagée)
   */
  async createCategory(appId, data) {
    const category = new Category({ ...data, appId });
    return await category.save();
  }

  /**
   * Récupérer les catégories (inclut les catégories partagées)
   * @param {String} appId - ID de l'application
   */
  async getCategories(appId, { offset = 0, limit = 10, isVip = null, isActive = null }) {
    // ⭐ MODIFIÉ : Inclure les catégories partagées
    const filter = { appId: { $in: [appId, "shared"] } };
    
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

  /**
   * Récupérer une catégorie par ID (inclut les catégories partagées)
   * @param {String} appId - ID de l'application
   */
  async getCategoryById(appId, id) {
    // ⭐ MODIFIÉ : Inclure les catégories partagées
    return await Category.findOne({ 
      _id: id, 
      appId: { $in: [appId, "shared"] } 
    });
  }

  /**
   * Récupérer une catégorie par nom (inclut les catégories partagées)
   * @param {String} appId - ID de l'application
   */
  async getCategoryByName(appId, name) {
    // ⭐ MODIFIÉ : Inclure les catégories partagées
    // Recherche sur name.fr ou name.en
    return await Category.findOne({
      $or: [{ 'name.fr': name }, { 'name.en': name }],
      appId: { $in: [appId, "shared"] },
      isActive: true
    });
  }

  /**
   * Mettre à jour une catégorie
   * @param {String} appId - ID de l'application
   * ⚠️ NOTE : Ne peut mettre à jour que les catégories de son app (pas les shared)
   */
  async updateCategory(appId, id, data) {
    // ⭐ SÉCURITÉ : On ne modifie QUE les catégories de l'app (pas les shared)
    return await Category.findOneAndUpdate(
      { _id: id, appId }, // Pas de $in ici pour éviter modification des shared
      data, 
      { new: true }
    );
  }

  /**
   * Désactiver une catégorie
   * @param {String} appId - ID de l'application
   * ⚠️ NOTE : Ne peut désactiver que les catégories de son app (pas les shared)
   */
  async deactivateCategory(appId, id) {
    // ⭐ SÉCURITÉ : On ne désactive QUE les catégories de l'app (pas les shared)
    return await Category.findOneAndUpdate(
      { _id: id, appId }, // Pas de $in ici pour éviter désactivation des shared
      { isActive: false }, 
      { new: true }
    );
  }

  /**
   * Récupérer les catégories par type (inclut les catégories partagées)
   * @param {String} appId - ID de l'application
   */
  async getCategoriesByType(appId, isVip, { offset = 0, limit = 10 }) {
    return await this.getCategories(appId, { offset, limit, isVip, isActive: true });
  }

  /**
   * Vérifier si une catégorie existe (inclut les catégories partagées)
   * @param {String} appId - ID de l'application
   */
  async categoryExists(appId, id) {
    // ⭐ MODIFIÉ : Inclure les catégories partagées
    const category = await Category.findOne({ 
      _id: id, 
      appId: { $in: [appId, "shared"] },
      isActive: true 
    });
    return !!category;
  }
}

module.exports = new CategoryService();