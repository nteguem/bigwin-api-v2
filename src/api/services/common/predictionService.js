// src/api/services/common/predictionService.js

const Prediction = require('../../models/common/Prediction');

/**
 * PredictionService
 * =================
 * 
 * GESTION DES PREDICTIONS PARTAGÉES :
 * - Toutes les méthodes de lecture incluent automatiquement les predictions avec appId = "shared"
 * - Exemple : getPredictions("app1") retourne les predictions de app1 + les predictions shared
 * - Les predictions partagées sont généralement liées à des tickets partagés
 * - Les méthodes de modification ne peuvent PAS modifier les predictions shared (sécurité)
 */

class PredictionService {
  
  /**
   * Créer une nouvelle prédiction
   * @param {String} appId - ID de l'application (ou "shared" pour prediction partagée)
   */
  async createPrediction(appId, data) {
    // ⭐ Ajouter appId aux données
    const prediction = new Prediction({ ...data, appId });
    
    if (prediction.ticket) {
      const ticketService = require('./ticketService'); 
      // ⭐ Passer appId au service
      await ticketService.updateClosingTime(appId, prediction.ticket);
    }
    
    return await prediction.save();
  }

  /**
   * Récupérer toutes les prédictions avec pagination (inclut les predictions partagées)
   * @param {String} appId - ID de l'application
   */
  async getPredictions(appId, { offset = 0, limit = 10, ticket = null, sport = null, status = null }) {
    // ⭐ MODIFIÉ : Inclure les predictions partagées
    const filter = { appId: { $in: [appId, "shared"] } };
    
    if (ticket) {
      filter.ticket = ticket;
    }

    if (sport) {
      filter.sport = sport;
    }

    if (status) {
      filter.status = status;
    }

    const predictions = await Prediction.find(filter)
      .populate('ticket')
      .skip(offset)
      .limit(limit)
      .sort({ createdAt: -1 });

    // ⭐ Compter avec appId
    const total = await Prediction.countDocuments(filter);

    return {
      data: predictions,
      pagination: {
        offset,
        limit,
        total,
        hasNext: (offset + limit) < total
      }
    };
  }

  /**
   * Récupérer une prédiction par ID (inclut les predictions partagées)
   * @param {String} appId - ID de l'application
   */
  async getPredictionById(appId, id) {
    // ⭐ MODIFIÉ : Inclure les predictions partagées
    return await Prediction.findOne({ 
      _id: id, 
      appId: { $in: [appId, "shared"] } 
    }).populate('ticket');
  }

  /**
   * Récupérer les prédictions d'un ticket (inclut les predictions partagées)
   * @param {String} appId - ID de l'application
   */
  async getPredictionsByTicket(appId, ticketId) {
    // ⭐ MODIFIÉ : Inclure les predictions partagées
    return await Prediction.find({ 
      ticket: ticketId, 
      appId: { $in: [appId, "shared"] } 
    });
  }

  /**
   * Mettre à jour une prédiction
   * @param {String} appId - ID de l'application
   * ⚠️ NOTE : Ne peut mettre à jour que les predictions de son app (pas les shared)
   */
  async updatePrediction(appId, id, data) {
    // ⭐ SÉCURITÉ : On ne modifie QUE les predictions de l'app (pas les shared)
    return await Prediction.findOneAndUpdate(
      { _id: id, appId }, // Pas de $in ici pour éviter modification des shared
      data, 
      { new: true }
    );
  }

  /**
   * Supprimer une prédiction
   * @param {String} appId - ID de l'application
   * ⚠️ NOTE : Ne peut supprimer que les predictions de son app (pas les shared)
   */
  async deletePrediction(appId, id) {
    // ⭐ SÉCURITÉ : On ne supprime QUE les predictions de l'app (pas les shared)
    return await Prediction.findOneAndDelete({ _id: id, appId }); // Pas de $in
  }

  /**
   * Mettre à jour le statut d'une prédiction
   * @param {String} appId - ID de l'application
   * ⚠️ NOTE : Ne peut mettre à jour que les predictions de son app (pas les shared)
   */
  async updatePredictionStatus(appId, id, status) {
    return await this.updatePrediction(appId, id, { status });
  }

  /**
   * Vérifier si une prédiction existe (inclut les predictions partagées)
   * @param {String} appId - ID de l'application
   */
  async predictionExists(appId, id) {
    // ⭐ MODIFIÉ : Inclure les predictions partagées
    const prediction = await Prediction.findOne({ 
      _id: id, 
      appId: { $in: [appId, "shared"] } 
    });
    return !!prediction;
  }

  /**
   * Récupérer les prédictions par statut (inclut les predictions partagées)
   * @param {String} appId - ID de l'application
   */
  async getPredictionsByStatus(appId, status, { offset = 0, limit = 10 }) {
    return await this.getPredictions(appId, { offset, limit, status });
  }

  /**
   * Récupérer les prédictions par sport (inclut les predictions partagées)
   * @param {String} appId - ID de l'application
   */
  async getPredictionsBySport(appId, sport, { offset = 0, limit = 10 }) {
    return await this.getPredictions(appId, { offset, limit, sport });
  }

  /**
   * Ajouter plusieurs prédictions à un ticket
   * @param {String} appId - ID de l'application (ou "shared" pour predictions partagées)
   */
  async addPredictionsToTicket(appId, ticketId, predictionsData) {
    const predictions = [];
    
    for (const data of predictionsData) {
      const predictionData = { ...data, ticket: ticketId };
      // ⭐ Passer appId
      const prediction = await this.createPrediction(appId, predictionData);
      predictions.push(prediction);
    }
    
    return predictions;
  }
}

module.exports = new PredictionService();