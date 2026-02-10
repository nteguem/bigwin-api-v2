// src/api/services/common/ticketService.js

const Ticket = require('../../models/common/Ticket');
const Prediction = require("../../models/common/Prediction");
const predictionService = require('./predictionService');

/**
 * TicketService
 * =============
 * 
 * GESTION DES TICKETS PARTAGÉS :
 * - Toutes les méthodes de lecture incluent automatiquement les tickets avec appId = "shared"
 * - Exemple : getTickets("app1") retourne les tickets de app1 + les tickets shared
 * - Les tickets partagés sont visibles dans toutes les applications
 * - Les méthodes de modification ne peuvent PAS modifier les tickets shared (sécurité)
 */

class TicketService {
  
  /**
   * Créer un ticket
   * @param {String} appId - ID de l'application (ou "shared" pour ticket partagé)
   */
  async createTicket(appId, data) {
    const ticket = new Ticket({ ...data, appId });
    return await ticket.save();
  }

  /**
   * Récupérer les tickets (inclut les tickets partagés)
   * @param {String} appId - ID de l'application
   */
  async getTickets(appId, { offset = 0, limit = 10, category = null, date = null, isVisible = null }) {
    // ⭐ MODIFIÉ : Inclure les tickets partagés
    const filter = { appId: { $in: [appId, "shared"] } };
    
    // ⭐ FIX : Vérifier !== null ET !== undefined
    if (isVisible !== null && isVisible !== undefined) {
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
      filter.date = { $gte: startOfDay, $lte: endOfDay };
    }

    console.log('[TicketService] Filter final:', JSON.stringify(filter));

    const tickets = await Ticket.find(filter)
      .populate('category')
      .skip(offset)
      .limit(limit)
      .sort({ date: -1 });

    const ticketsWithPredictions = await Promise.all(
      tickets.map(async (ticket) => {
        const predictions = await predictionService.getPredictionsByTicket(appId, ticket._id);
        return { ...ticket.toObject(), predictions };
      })
    );

    const total = await Ticket.countDocuments(filter);

    return {
      data: ticketsWithPredictions,
      pagination: { offset, limit, total, hasNext: (offset + limit) < total }
    };
  }

  /**
   * Récupérer un ticket par ID (inclut les tickets partagés)
   * @param {String} appId - ID de l'application
   */
  async getTicketById(appId, id) {
    // ⭐ MODIFIÉ : Inclure les tickets partagés
    const ticket = await Ticket.findOne({ 
      _id: id, 
      appId: { $in: [appId, "shared"] } 
    }).populate('category');
    
    if (!ticket) return null;
    
    const predictions = await predictionService.getPredictionsByTicket(appId, id);
    return { ...ticket.toObject(), predictions };
  }

  /**
   * Mettre à jour un ticket
   * @param {String} appId - ID de l'application
   * ⚠️ NOTE : Ne peut mettre à jour que les tickets de son app (pas les shared)
   */
  async updateTicket(appId, id, data) {
    // ⭐ SÉCURITÉ : On ne modifie QUE les tickets de l'app (pas les shared)
    return await Ticket.findOneAndUpdate(
      { _id: id, appId }, // Pas de $in ici pour éviter modification des shared
      data, 
      { new: true }
    );
  }

  /**
   * Supprimer un ticket
   * @param {String} appId - ID de l'application
   * ⚠️ NOTE : Ne peut supprimer que les tickets de son app (pas les shared)
   */
  async deleteTicket(appId, id) {
    // ⭐ SÉCURITÉ : On ne supprime QUE les tickets de l'app (pas les shared)
    const ticket = await Ticket.findOne({ _id: id, appId }); // Pas de $in
    if (!ticket) return null;
    
    // Supprimer les predictions associées (même logique)
    await Prediction.deleteMany({ ticket: id, appId });
    await Ticket.findByIdAndDelete(id);
    
    return { deletedTicket: ticket, message: 'Ticket and associated predictions deleted successfully' };
  }

  /**
   * Mettre à jour le closing time d'un ticket
   * @param {String} appId - ID de l'application
   */
  async updateClosingTime(appId, ticketId) {
    const predictions = await predictionService.getPredictionsByTicket(appId, ticketId);
    if (predictions.length === 0) return null;
    
    const latestMatchDate = predictions.reduce((latest, pred) => {
      const matchDate = new Date(pred.matchData.date);
      return matchDate > latest ? matchDate : latest;
    }, new Date(0));
    
    const closingAt = new Date(latestMatchDate.getTime() + (3 * 60 * 60 * 1000));
    return await this.updateTicket(appId, ticketId, { closingAt });
  }

  /**
   * Publier un ticket (rendre visible)
   * @param {String} appId - ID de l'application
   * ⚠️ NOTE : Ne peut publier que les tickets de son app (pas les shared)
   */
  async publishTicket(appId, id) {
    return await this.updateTicket(appId, id, { isVisible: true });
  }

  /**
   * Masquer un ticket
   * @param {String} appId - ID de l'application
   * ⚠️ NOTE : Ne peut masquer que les tickets de son app (pas les shared)
   */
  async hideTicket(appId, id) {
    return await this.updateTicket(appId, id, { isVisible: false });
  }

  /**
   * Fermer un ticket
   * @param {String} appId - ID de l'application
   * ⚠️ NOTE : Ne peut fermer que les tickets de son app (pas les shared)
   */
  async closeTicket(appId, id) {
    return await this.updateTicket(appId, id, { status: 'closed' });
  }

  /**
   * Vérifier si un ticket existe (inclut les tickets partagés)
   * @param {String} appId - ID de l'application
   */
  async ticketExists(appId, id) {
    // ⭐ MODIFIÉ : Inclure les tickets partagés
    const ticket = await Ticket.findOne({ 
      _id: id, 
      appId: { $in: [appId, "shared"] } 
    });
    return !!ticket;
  }
}

module.exports = new TicketService();