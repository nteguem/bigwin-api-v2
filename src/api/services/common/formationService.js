// services/common/formationService.js

const Formation = require('../../models/common/Formation');

class FormationService {

  /**
   * Récupérer toutes les formations avec pagination
   * @param {String} appId - ID de l'application
   */
  async getFormations(appId, options = {}) {
    const { offset = 0, limit = 10, isActive = null, lang = 'fr' } = options;

    // Construire le filtre
    const filter = { appId }; // ⭐ AJOUT
    
    if (isActive !== null) {
      filter.isActive = isActive;
    }

    // Récupérer les formations avec pagination et populate des packages
    const formations = await Formation.find(filter)
      .populate('requiredPackages', 'name description pricing duration badge economy')
      .skip(offset)
      .limit(limit)
      .sort({ order: 1, createdAt: -1 });

    // ⭐ Compter le total POUR CETTE APP
    const total = await Formation.countDocuments(filter);

    // Formater selon la langue
    const formattedFormations = formations.map(formation => this.formatFormation(formation, lang));

    return {
      data: formattedFormations,
      pagination: {
        total,
        offset,
        limit,
        hasMore: offset + limit < total
      }
    };
  }

  /**
   * Récupérer une formation par ID
   * @param {String} appId - ID de l'application
   */
  async getFormationById(appId, id, lang = 'fr') {
    // ⭐ Filtrer par appId
    const formation = await Formation.findOne({ _id: id, appId })
      .populate('requiredPackages', 'name description pricing duration badge economy');
    
    if (!formation) {
      return null;
    }

    return this.formatFormation(formation, lang);
  }

  /**
   * Créer une nouvelle formation
   * @param {String} appId - ID de l'application
   */
  async createFormation(appId, formationData) {
    // ⭐ Ajouter appId aux données
    const formation = await Formation.create({ ...formationData, appId });
    
    // Populate après création pour retourner les données complètes
    return await Formation.findById(formation._id)
      .populate('requiredPackages', 'name description pricing duration badge economy');
  }

  /**
   * Mettre à jour une formation
   * @param {String} appId - ID de l'application
   */
  async updateFormation(appId, id, updates) {
    // ⭐ Filtrer par appId
    const formation = await Formation.findOneAndUpdate(
      { _id: id, appId }, // ⭐ AJOUT
      updates, 
      {
        new: true,
        runValidators: true
      }
    ).populate('requiredPackages', 'name description pricing duration badge economy');

    return formation;
  }

  /**
   * Désactiver une formation
   * @param {String} appId - ID de l'application
   */
  async deactivateFormation(appId, id) {
    // ⭐ Filtrer par appId
    const formation = await Formation.findOneAndUpdate(
      { _id: id, appId }, // ⭐ AJOUT
      { isActive: false }, 
      { new: true }
    ).populate('requiredPackages', 'name description pricing duration badge economy');

    return formation;
  }

  /**
   * Activer une formation
   * @param {String} appId - ID de l'application
   */
  async activateFormation(appId, id) {
    // ⭐ Filtrer par appId
    const formation = await Formation.findOneAndUpdate(
      { _id: id, appId }, // ⭐ AJOUT
      { isActive: true }, 
      { new: true }
    ).populate('requiredPackages', 'name description pricing duration badge economy');

    return formation;
  }

  /**
   * Méthode utilitaire pour formater une formation selon la langue
   */
  formatFormation(formation, lang = 'fr') {
    return {
      _id: formation._id,
      title: formation.title[lang] || formation.title.fr,
      description: formation.description[lang] || formation.description.fr,
      htmlContent: formation.htmlContent[lang] || formation.htmlContent.fr,
      isAccessible: formation.isAccessible,
      requiredPackages: formation.requiredPackages ? formation.requiredPackages.map(pkg => ({
        _id: pkg._id,
        name: pkg.name[lang] || pkg.name.fr,
        description: pkg.description ? (pkg.description[lang] || pkg.description.fr) : null,
        pricing: Object.fromEntries(pkg.pricing),
        duration: pkg.duration,
        badge: pkg.badge ? (pkg.badge[lang] || pkg.badge.fr) : null,
        economy: pkg.economy ? Object.fromEntries(pkg.economy) : null
      })) : [],
      isActive: formation.isActive,
      createdAt: formation.createdAt,
      updatedAt: formation.updatedAt
    };
  }

  /**
   * Récupérer toutes les formations actives (pour les packages)
   * @param {String} appId - ID de l'application
   */
  async getActiveFormations(appId, lang = 'fr') {
    // ⭐ Filtrer par appId
    const formations = await Formation.find({ appId, isActive: true })
      .populate('requiredPackages', 'name description pricing duration badge economy');
    
    return formations.map(formation => this.formatFormation(formation, lang));
  }
}

module.exports = new FormationService();