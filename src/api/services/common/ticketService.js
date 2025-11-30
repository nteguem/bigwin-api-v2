// services/common/ticketService.js

const Ticket = require('../../models/common/Ticket');
const Prediction = require("../../models/common/Prediction");
const predictionService = require('./predictionService');

class TicketService {
  
  /**
   * Créer un nouveau ticket
   * @param {String} appId - ID de l'application
   */
  async createTicket(appId, data) {
    // ⭐ Ajouter appId aux données
    const ticket = new Ticket({ ...data, appId });
    return await ticket.save();
  }

  /**
   * Récupérer tous les tickets avec pagination et leurs prédictions
   * @param {String} appId - ID de l'application
   */
  async getTickets(appId, { offset = 0, limit = 10, category = null, date = null, isVisible = null }) {
    // ⭐ Filtrer par appId
    const filter = { appId };
    
    // Seulement ajouter isVisible au filtre s'il est explicitement défini
    if (isVisible !== null) {
      filter.isVisible = isVisible;
    }
    
    if (category) {
      filter.category = category;
    }

    if (date) {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      
      filter.date = {
        $gte: startOfDay,
        $lte: endOfDay
      };
    }

    const tickets = await Ticket.find(filter)
      .populate('category')
      .skip(offset)
      .limit(limit)
      .sort({ date: -1 });

    // Récupérer les prédictions pour chaque ticket
    const ticketsWithPredictions = await Promise.all(
      tickets.map(async (ticket) => {
        // ⭐ Passer appId
        const predictions = await predictionService.getPredictionsByTicket(appId, ticket._id);
        return {
          ...ticket.toObject(),
          predictions
        };
      })
    );

    // ⭐ Compter avec appId
    const total = await Ticket.countDocuments(filter);

    return {
      data: ticketsWithPredictions,
      pagination: {
        offset,
        limit,
        total,
        hasNext: (offset + limit) < total
      }
    };
  }

  /**
   * Récupérer un ticket par ID avec ses prédictions
   * @param {String} appId - ID de l'application
   */
  async getTicketById(appId, id) {
    // ⭐ Filtrer par appId
    const ticket = await Ticket.findOne({ _id: id, appId }).populate('category');
    if (!ticket) return null;

    // ⭐ Passer appId
    const predictions = await predictionService.getPredictionsByTicket(appId, id);
    
    return {
      ...ticket.toObject(),
      predictions
    };
  }

  /**
   * Mettre à jour un ticket
   * @param {String} appId - ID de l'application
   */
  async updateTicket(appId, id, data) {
    // ⭐ Filtrer par appId
    return await Ticket.findOneAndUpdate(
      { _id: id, appId }, // ⭐ AJOUT
      data, 
      { new: true }
    );
  }

  /**
   * Supprimer un ticket et toutes ses prédictions
   * @param {String} appId - ID de l'application
   */
  async deleteTicket(appId, id) {
    // ⭐ Vérifier que le ticket existe POUR CETTE APP
    const ticket = await Ticket.findOne({ _id: id, appId });
    if (!ticket) {
      return null;
    }

    // ⭐ Supprimer toutes les prédictions associées au ticket POUR CETTE APP
    await Prediction.deleteMany({ ticket: id, appId });

    // Supprimer le ticket
    await Ticket.findByIdAndDelete(id);

    return { 
      deletedTicket: ticket,
      message: 'Ticket and associated predictions deleted successfully'
    };
  }

  /**
   * Calculer et mettre à jour le closingAt d'un ticket
   * @param {String} appId - ID de l'application
   */
  async updateClosingTime(appId, ticketId) {
    // ⭐ Passer appId
    const predictions = await predictionService.getPredictionsByTicket(appId, ticketId);
    
    if (predictions.length === 0) {
      return null;
    }

    // Trouver le match le plus tard
    const latestMatchDate = predictions.reduce((latest, pred) => {
      const matchDate = new Date(pred.matchData.date);
      return matchDate > latest ? matchDate : latest;
    }, new Date(0));

    // Ajouter 3 heures
    const closingAt = new Date(latestMatchDate.getTime() + (3 * 60 * 60 * 1000));

    // ⭐ Passer appId
    return await this.updateTicket(appId, ticketId, { closingAt });
  }

  /**
   * Rendre un ticket visible
   * @param {String} appId - ID de l'application
   */
  async publishTicket(appId, id) {
    return await this.updateTicket(appId, id, { isVisible: true });
  }

  /**
   * Cacher un ticket
   * @param {String} appId - ID de l'application
   */
  async hideTicket(appId, id) {
    return await this.updateTicket(appId, id, { isVisible: false });
  }

  /**
   * Fermer un ticket
   * @param {String} appId - ID de l'application
   */
  async closeTicket(appId, id) {
    return await this.updateTicket(appId, id, { status: 'closed' });
  }

  /**
   * Vérifier si un ticket existe
   * @param {String} appId - ID de l'application
   */
  async ticketExists(appId, id) {
    // ⭐ Filtrer par appId
    const ticket = await Ticket.findOne({ _id: id, appId });
    return !!ticket;
  }

  /**
   * Récupérer toutes les prédictions pour plusieurs tickets en une seule requête
   * @param {String} appId - ID de l'application
   */
  async getPredictionsByTicketIds(appId, ticketIds) {
    try {
      // ⭐ Une seule requête pour récupérer toutes les prédictions POUR CETTE APP
      const predictions = await Prediction.find({
        appId, // ⭐ AJOUT
        ticket: { $in: ticketIds }
      })
      .populate('event')
      .populate('matchData')
      .lean(); // Pour de meilleures performances

      return predictions;
    } catch (error) {
      console.error('Erreur lors de la récupération des prédictions:', error);
      return [];
    }
  }

  /**
   * Version alternative avec aggregation pipeline pour encore plus de performance
   * @param {String} appId - ID de l'application
   */
  async getPredictionsByTicketIdsOptimized(appId, ticketIds) {
    try {
      const mongoose = require('mongoose');
      
      const predictions = await Prediction.aggregate([
        {
          $match: {
            appId, // ⭐ AJOUT
            ticket: { $in: ticketIds.map(id => mongoose.Types.ObjectId(id)) }
          }
        },
        {
          $lookup: {
            from: 'events',
            localField: 'event',
            foreignField: '_id',
            as: 'event'
          }
        },
        {
          $unwind: {
            path: '$event',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $lookup: {
            from: 'matches',
            localField: 'matchData',
            foreignField: '_id',
            as: 'matchData'
          }
        },
        {
          $unwind: {
            path: '$matchData',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          // Projeter seulement les champs nécessaires
          $project: {
            _id: 1,
            ticket: 1,
            odds: 1,
            status: 1,
            sport: 1,
            'event._id': 1,
            'event.label': 1,
            'event.description': 1,
            'event.category': 1,
            'matchData._id': 1,
            'matchData.date': 1,
            'matchData.status': 1,
            'matchData.league': 1,
            'matchData.teams': 1,
            'matchData.venue': 1,
            'matchData.score': 1
          }
        }
      ]);

      return predictions;
    } catch (error) {
      console.error('Erreur lors de la récupération des prédictions:', error);
      return [];
    }
  }
}

module.exports = new TicketService();