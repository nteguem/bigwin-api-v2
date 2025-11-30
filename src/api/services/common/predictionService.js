// services/common/predictionService.js

const Prediction = require('../../models/common/Prediction');

class PredictionService {
  
  /**
   * Créer une nouvelle prédiction
   * @param {String} appId - ID de l'application
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
   * Récupérer toutes les prédictions avec pagination
   * @param {String} appId - ID de l'application
   */
  async getPredictions(appId, { offset = 0, limit = 10, ticket = null, sport = null, status = null }) {
    // ⭐ Filtrer par appId
    const filter = { appId };
    
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
   * Récupérer une prédiction par ID
   * @param {String} appId - ID de l'application
   */
  async getPredictionById(appId, id) {
    // ⭐ Filtrer par appId
    return await Prediction.findOne({ _id: id, appId }).populate('ticket');
  }

  /**
   * Récupérer les prédictions d'un ticket
   * @param {String} appId - ID de l'application
   */
  async getPredictionsByTicket(appId, ticketId) {
    // ⭐ Filtrer par appId
    return await Prediction.find({ ticket: ticketId, appId });
  }

  /**
   * Mettre à jour une prédiction
   * @param {String} appId - ID de l'application
   */
  async updatePrediction(appId, id, data) {
    // ⭐ Filtrer par appId
    return await Prediction.findOneAndUpdate(
      { _id: id, appId }, // ⭐ AJOUT
      data, 
      { new: true }
    );
  }

  /**
   * Supprimer une prédiction
   * @param {String} appId - ID de l'application
   */
  async deletePrediction(appId, id) {
    // ⭐ Filtrer par appId
    return await Prediction.findOneAndDelete({ _id: id, appId });
  }

  /**
   * Mettre à jour le statut d'une prédiction
   * @param {String} appId - ID de l'application
   */
  async updatePredictionStatus(appId, id, status) {
    return await this.updatePrediction(appId, id, { status });
  }

  /**
   * Vérifier si une prédiction existe
   * @param {String} appId - ID de l'application
   */
  async predictionExists(appId, id) {
    // ⭐ Filtrer par appId
    const prediction = await Prediction.findOne({ _id: id, appId });
    return !!prediction;
  }

  /**
   * Récupérer les prédictions par statut
   * @param {String} appId - ID de l'application
   */
  async getPredictionsByStatus(appId, status, { offset = 0, limit = 10 }) {
    return await this.getPredictions(appId, { offset, limit, status });
  }

  /**
   * Récupérer les prédictions par sport
   * @param {String} appId - ID de l'application
   */
  async getPredictionsBySport(appId, sport, { offset = 0, limit = 10 }) {
    return await this.getPredictions(appId, { offset, limit, sport });
  }

  /**
   * Ajouter plusieurs prédictions à un ticket
   * @param {String} appId - ID de l'application
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