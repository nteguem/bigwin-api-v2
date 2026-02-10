// src/api/services/common/predictionService.js

const Prediction = require('../../models/common/Prediction');
const Ticket = require('../../models/common/Ticket');
const Category = require('../../models/common/Category');

/**
 * PredictionService
 * =================
 * 
 * GESTION DES PREDICTIONS AVEC CATÉGORIES PARTAGÉES :
 * - Les predictions sont filtrées par TICKETS accessibles
 * - Un ticket est accessible si sa catégorie est accessible (app + shared)
 */

class PredictionService {
  
  /**
   * Créer une nouvelle prédiction
   * @param {String} appId - ID de l'application
   */
  async createPrediction(appId, data) {
    const prediction = new Prediction({ ...data, appId });
    
    if (prediction.ticket) {
      const ticketService = require('./ticketService'); 
      await ticketService.updateClosingTime(appId, prediction.ticket);
    }
    
    return await prediction.save();
  }

  /**
   * Récupérer toutes les prédictions avec pagination (filtrées par tickets accessibles)
   * @param {String} appId - ID de l'application
   */
  async getPredictions(appId, { offset = 0, limit = 10, ticket = null, sport = null, status = null }) {
    // ⭐ ÉTAPE 1 : Récupérer les catégories accessibles
    const accessibleCategories = await Category.find({
      appId: { $in: [appId, "shared"] },
      isActive: true
    }).select('_id');
    
    const categoryIds = accessibleCategories.map(cat => cat._id);
    
    // ⭐ ÉTAPE 2 : Récupérer les tickets de ces catégories
    const accessibleTickets = await Ticket.find({
      category: { $in: categoryIds }
    }).select('_id');
    
    const ticketIds = accessibleTickets.map(t => t._id);
    
    // ⭐ ÉTAPE 3 : Filtrer les predictions par ces tickets
    const filter = { 
      ticket: { $in: ticketIds } // ✅ Filtre par tickets accessibles
    };
    
    if (ticket) {
      // Si un ticket spécifique est demandé, vérifier qu'il est accessible
      if (ticketIds.some(id => id.toString() === ticket.toString())) {
        filter.ticket = ticket;
      } else {
        // Ticket non accessible, retourner vide
        return {
          data: [],
          pagination: { offset, limit, total: 0, hasNext: false }
        };
      }
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
   * Récupérer une prédiction par ID (si son ticket est accessible)
   * @param {String} appId - ID de l'application
   */
  async getPredictionById(appId, id) {
    const prediction = await Prediction.findOne({ _id: id }).populate('ticket');
    
    if (!prediction) return null;
    
    // Vérifier que le ticket est accessible
    const ticket = await Ticket.findOne({ _id: prediction.ticket._id });
    if (!ticket) return null;
    
    const categoryAccessible = await Category.findOne({
      _id: ticket.category,
      appId: { $in: [appId, "shared"] },
      isActive: true
    });
    
    if (!categoryAccessible) return null;
    
    return prediction;
  }

  /**
   * Récupérer les prédictions d'un ticket (si le ticket est accessible)
   * @param {String} appId - ID de l'application
   */
  async getPredictionsByTicket(appId, ticketId) {
    // Vérifier que le ticket est accessible
    const ticket = await Ticket.findOne({ _id: ticketId });
    if (!ticket) return [];
    
    const categoryAccessible = await Category.findOne({
      _id: ticket.category,
      appId: { $in: [appId, "shared"] },
      isActive: true
    });
    
    if (!categoryAccessible) return [];
    
    return await Prediction.find({ ticket: ticketId });
  }

  /**
   * Mettre à jour une prédiction
   * @param {String} appId - ID de l'application
   * ⚠️ NOTE : Ne peut mettre à jour que les predictions de son app
   */
  async updatePrediction(appId, id, data) {
    return await Prediction.findOneAndUpdate(
      { _id: id, appId },
      data, 
      { new: true }
    );
  }

  /**
   * Supprimer une prédiction
   * @param {String} appId - ID de l'application
   * ⚠️ NOTE : Ne peut supprimer que les predictions de son app
   */
  async deletePrediction(appId, id) {
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
   * Vérifier si une prédiction existe et est accessible
   * @param {String} appId - ID de l'application
   */
  async predictionExists(appId, id) {
    const prediction = await this.getPredictionById(appId, id);
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
      const prediction = await this.createPrediction(appId, predictionData);
      predictions.push(prediction);
    }
    
    return predictions;
  }
}

module.exports = new PredictionService();