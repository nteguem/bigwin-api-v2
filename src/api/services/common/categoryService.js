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
   * Creer une categorie
   * @param {String} appId - App proprietaire (creatrice, RBAC owner)
   * @param {Object} data  - Peut contenir `appIds` : liste de diffusion.
   *                          Default = [appId]. L'app proprietaire est
   *                          toujours incluse (invariant).
   */
  async createCategory(appId, data) {
    const ownerApp = String(appId).toLowerCase();
    let appIds;
    if (Array.isArray(data.appIds) && data.appIds.length > 0) {
      const normalized = data.appIds.map(a => String(a).toLowerCase()).filter(Boolean);
      const set = new Set(normalized);
      // Invariant : owner toujours present (sauf si shared, qui a sa propre logique)
      if (ownerApp !== 'shared') set.add(ownerApp);
      appIds = Array.from(set);
    } else {
      appIds = ownerApp !== 'shared' ? [ownerApp] : [];
    }
    const category = new Category({ ...data, appId: ownerApp, appIds });
    return await category.save();
  }

  /**
   * Recuperer les categories visibles depuis cette app
   * (nouveau pattern multi-app via appIds + retro-compat shared).
   */
  async getCategories(appId, { offset = 0, limit = 10, isVip = null, isActive = null }) {
    const filter = {
      $or: [
        { appIds: appId },
        { appId: 'shared' },
      ],
    };
    
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
    // Multi-app : visible depuis cette app via appIds OU retro-compat shared
    return await Category.findOne({
      _id: id,
      $or: [
        { appIds: appId },
        { appId: 'shared' },
      ],
    });
  }

  /**
   * Récupérer une catégorie par nom (inclut les catégories partagées)
   * @param {String} appId - ID de l'application
   */
  async getCategoryByName(appId, name) {
    // Multi-app : visible depuis cette app via appIds OU retro-compat shared
    return await Category.findOne({
      $or: [
        { 'name.fr': name, appIds: appId },
        { 'name.en': name, appIds: appId },
        { 'name.fr': name, appId: 'shared' },
        { 'name.en': name, appId: 'shared' },
      ],
      isActive: true
    });
  }

  /**
   * Mettre a jour une categorie
   * Acces : seul l'app proprietaire (appId match) peut modifier.
   * (Les categories shared restent intouchables, retro-compat.)
   *
   * Si data.appIds est fourni : invariant garanti (owner toujours present).
   */
  async updateCategory(appId, id, data) {
    const updateData = { ...data };
    if (Array.isArray(updateData.appIds)) {
      const normalized = updateData.appIds.map(a => String(a).toLowerCase()).filter(Boolean);
      const set = new Set(normalized);
      const owner = String(appId).toLowerCase();
      if (owner !== 'shared') set.add(owner);
      updateData.appIds = Array.from(set);
    }
    return await Category.findOneAndUpdate(
      { _id: id, appId }, // owner-only mutation
      updateData,
      { new: true }
    );
  }

  /**
   * Desactiver une categorie (RBAC owner-only)
   */
  async deactivateCategory(appId, id) {
    return await Category.findOneAndUpdate(
      { _id: id, appId },
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
    // Multi-app : visible depuis cette app via appIds OU shared retro-compat
    const category = await Category.findOne({
      _id: id,
      $or: [
        { appIds: appId },
        { appId: 'shared' },
      ],
      isActive: true
    });
    return !!category;
  }
}

module.exports = new CategoryService();