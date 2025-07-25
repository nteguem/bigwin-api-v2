const Ticket = require('../../models/common/Ticket');
const predictionService = require('./predictionService');

class TicketService {
  
  // Créer un nouveau ticket
  async createTicket(data) {
    const ticket = new Ticket(data);
    return await ticket.save();
  }

  // Récupérer tous les tickets avec pagination et leurs prédictions
  async getTickets({ offset = 0, limit = 10, category = null, date = null, isVisible = true }) {
    const filter = { isVisible };
    
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
        const predictions = await predictionService.getPredictionsByTicket(ticket._id);
        return {
          ...ticket.toObject(),
          predictions
        };
      })
    );

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

  // Récupérer un ticket par ID avec ses prédictions
  async getTicketById(id) {
    const ticket = await Ticket.findById(id).populate('category');
    if (!ticket) return null;

    const predictions = await predictionService.getPredictionsByTicket(id);
    
    return {
      ...ticket.toObject(),
      predictions
    };
  }

  // Mettre à jour un ticket
  async updateTicket(id, data) {
    return await Ticket.findByIdAndUpdate(id, data, { new: true });
  }

  // Calculer et mettre à jour le closingAt d'un ticket
  async updateClosingTime(ticketId) {
    const predictions = await predictionService.getPredictionsByTicket(ticketId);
    
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

    return await this.updateTicket(ticketId, { closingAt });
  }

  // Rendre un ticket visible
  async publishTicket(id) {
    return await this.updateTicket(id, { isVisible: true });
  }

  // Cacher un ticket
  async hideTicket(id) {
    return await this.updateTicket(id, { isVisible: false });
  }

  // Fermer un ticket
  async closeTicket(id) {
    return await this.updateTicket(id, { status: 'closed' });
  }

  // Vérifier si un ticket existe
  async ticketExists(id) {
    const ticket = await Ticket.findById(id);
    return !!ticket;
  }
}

module.exports = new TicketService();