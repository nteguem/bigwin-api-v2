const Formation = require('../../models/common/Formation');

class FormationService {

  // Récupérer toutes les formations avec pagination
  async getFormations(options = {}) {
    const { offset = 0, limit = 10, isActive = null, lang = 'fr' } = options;

    // Construire le filtre
    const filter = {};
    if (isActive !== null) {
      filter.isActive = isActive;
    }

    // Récupérer les formations avec pagination
    const formations = await Formation.find(filter)
      .skip(offset)
      .limit(limit)
      .sort({ createdAt: -1 });

    // Compter le total pour la pagination
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

  // Récupérer une formation par ID
  async getFormationById(id, lang = 'fr') {
    const formation = await Formation.findById(id);
    
    if (!formation) {
      return null;
    }

    return this.formatFormation(formation, lang);
  }

  // Créer une nouvelle formation
  async createFormation(formationData) {
    const formation = await Formation.create(formationData);
    return formation;
  }

  // Mettre à jour une formation
  async updateFormation(id, updates) {
    const formation = await Formation.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true
    });

    return formation;
  }

  // Désactiver une formation
  async deactivateFormation(id) {
    const formation = await Formation.findByIdAndUpdate(
      id, 
      { isActive: false }, 
      { new: true }
    );

    return formation;
  }

  // Activer une formation
  async activateFormation(id) {
    const formation = await Formation.findByIdAndUpdate(
      id, 
      { isActive: true }, 
      { new: true }
    );

    return formation;
  }

  // Méthode utilitaire pour formater une formation selon la langue
  formatFormation(formation, lang = 'fr') {
    return {
      _id: formation._id,
      title: formation.title[lang] || formation.title.fr,
      description: formation.description[lang] || formation.description.fr,
      pdfUrl: formation.pdfUrl[lang] || formation.pdfUrl.fr,
      isActive: formation.isActive,
      createdAt: formation.createdAt,
      updatedAt: formation.updatedAt
    };
  }

  // Récupérer toutes les formations actives (pour les packages)
  async getActiveFormations(lang = 'fr') {
    const formations = await Formation.find({ isActive: true });
    return formations.map(formation => this.formatFormation(formation, lang));
  }
}

module.exports = new FormationService();