// src/api/services/common/ticketService.js

const Ticket = require('../../models/common/Ticket');
const Prediction = require("../../models/common/Prediction");
const Category = require('../../models/common/Category');
const predictionService = require('./predictionService');

/**
 * TicketService
 * =============
 * 
 * GESTION DES TICKETS AVEC CATÉGORIES PARTAGÉES :
 * - Les tickets sont filtrés par CATÉGORIES accessibles (pas par appId du ticket)
 * - Si une catégorie est shared, TOUS les tickets de cette catégorie sont visibles (peu importe leur appId)
 * - Exemple : Ticket bigwin dans catégorie LIVE (shared) → Visible dans wisetips aussi
 */

class TicketService {
  
  /**
   * Créer un ticket
   * @param {String} appId - ID de l'application
   */
  async createTicket(appId, data) {
    const ticket = new Ticket({ ...data, appId });
    return await ticket.save();
  }

  /**
   * Récupérer les tickets (filtrés par catégories accessibles)
   * @param {String} appId - ID de l'application
   */
  async getTickets(appId, { offset = 0, limit = 10, category = null, date = null, isVisible = null }) {
    // ⭐ ÉTAPE 1 : Récupérer les catégories accessibles (app + shared)
    const accessibleCategories = await Category.find({
      appId: { $in: [appId, "shared"] },
      isActive: true
    }).select('_id');
    
    const categoryIds = accessibleCategories.map(cat => cat._id);
    
    // ⭐ ÉTAPE 2 : Filtrer les tickets par ces catégories (peu importe leur appId)
    const filter = { 
      category: { $in: categoryIds } // ✅ Filtre par catégories accessibles
    };
    
    // Filtres additionnels
    if (isVisible !== null && isVisible !== undefined) {
      filter.isVisible = isVisible;
    }
    
    if (category) {
      // Si une catégorie spécifique est demandée, vérifier qu'elle est accessible
      if (categoryIds.some(id => id.toString() === category.toString())) {
        filter.category = category;
      } else {
        // Catégorie non accessible, retourner vide
        return {
          data: [],
          pagination: { offset, limit, total: 0, hasNext: false }
        };
      }
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
   * Récupérer un ticket par ID (si sa catégorie est accessible)
   * @param {String} appId - ID de l'application
   */
  async getTicketById(appId, id) {
    // ⭐ ÉTAPE 1 : Récupérer le ticket
    const ticket = await Ticket.findOne({ _id: id }).populate('category');
    
    if (!ticket) return null;
    
    // ⭐ ÉTAPE 2 : Vérifier que la catégorie est accessible
    const categoryAccessible = await Category.findOne({
      _id: ticket.category._id,
      appId: { $in: [appId, "shared"] },
      isActive: true
    });
    
    if (!categoryAccessible) return null; // Catégorie non accessible
    
    const predictions = await predictionService.getPredictionsByTicket(appId, id);
    return { ...ticket.toObject(), predictions };
  }

  /**
   * Mettre à jour un ticket
   * @param {String} appId - ID de l'application
   * ⚠️ NOTE : Ne peut mettre à jour que les tickets de son app
   */
  async updateTicket(appId, id, data) {
    // Sécurité : On ne modifie QUE les tickets de l'app
    return await Ticket.findOneAndUpdate(
      { _id: id, appId },
      data, 
      { new: true }
    );
  }

  /**
   * Supprimer un ticket
   * @param {String} appId - ID de l'application
   * ⚠️ NOTE : Ne peut supprimer que les tickets de son app
   */
  async deleteTicket(appId, id) {
    const ticket = await Ticket.findOne({ _id: id, appId });
    if (!ticket) return null;
    
    await Prediction.deleteMany({ ticket: id });
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
   */
  async publishTicket(appId, id) {
    return await this.updateTicket(appId, id, { isVisible: true });
  }

  /**
   * Masquer un ticket
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
   * Vérifier si un ticket existe et est accessible
   * @param {String} appId - ID de l'application
   */
  async ticketExists(appId, id) {
    const ticket = await Ticket.findOne({ _id: id });
    if (!ticket) return false;
    
    // Vérifier que la catégorie est accessible
    const categoryAccessible = await Category.findOne({
      _id: ticket.category,
      appId: { $in: [appId, "shared"] },
      isActive: true
    });
    
    return !!categoryAccessible;
  }
}

module.exports = new TicketService();