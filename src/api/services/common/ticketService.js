// services/common/ticketService.js

const Ticket = require('../../models/common/Ticket');
const Prediction = require("../../models/common/Prediction");
const predictionService = require('./predictionService');

class TicketService {
  
  async createTicket(appId, data) {
    const ticket = new Ticket({ ...data, appId });
    return await ticket.save();
  }

  async getTickets(appId, { offset = 0, limit = 10, category = null, date = null, isVisible = null }) {
    const filter = { appId };
    
    // Les valeurs arrivent déjà converties du controller
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

    const ticketsWithPredictions = await Promise.all(
      tickets.map(async (ticket) => {
        const predictions = await predictionService.getPredictionsByTicket(appId, ticket._id);
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

  async getTicketById(appId, id) {
    const ticket = await Ticket.findOne({ _id: id, appId }).populate('category');
    if (!ticket) return null;

    const predictions = await predictionService.getPredictionsByTicket(appId, id);
    
    return {
      ...ticket.toObject(),
      predictions
    };
  }

  async updateTicket(appId, id, data) {
    return await Ticket.findOneAndUpdate(
      { _id: id, appId },
      data, 
      { new: true }
    );
  }

  async deleteTicket(appId, id) {
    const ticket = await Ticket.findOne({ _id: id, appId });
    if (!ticket) return null;

    await Prediction.deleteMany({ ticket: id, appId });
    await Ticket.findByIdAndDelete(id);

    return { 
      deletedTicket: ticket,
      message: 'Ticket and associated predictions deleted successfully'
    };
  }

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

  async publishTicket(appId, id) {
    return await this.updateTicket(appId, id, { isVisible: true });
  }

  async hideTicket(appId, id) {
    return await this.updateTicket(appId, id, { isVisible: false });
  }

  async closeTicket(appId, id) {
    return await this.updateTicket(appId, id, { status: 'closed' });
  }

  async ticketExists(appId, id) {
    const ticket = await Ticket.findOne({ _id: id, appId });
    return !!ticket;
  }
}

module.exports = new TicketService();