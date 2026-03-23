// controllers/common/ticketController.js

const ticketService = require('../../services/common/ticketService');
const categoryService = require('../../services/common/categoryService');
const { formatSuccess, formatError } = require('../../../utils/responseFormatter');

class TicketController {

  async getTickets(req, res) {
    try {
      const appId = req.appId; // ⭐ AJOUT
      const { offset = 0, limit = 10, category, date, isVisible, lang = 'fr' } = req.query;

      const result = await ticketService.getTickets(appId, { // ⭐ AJOUT appId
        offset: parseInt(offset),
        limit: parseInt(limit),
        category,
        date: date ? new Date(date) : null,
        isVisible: isVisible !== undefined ? isVisible === 'true' : null
      });

      // Formater les catégories pour la langue demandée
      const data = result.data.map(ticket => {
        if (ticket.category && ticket.category.name && typeof ticket.category.name === 'object') {
          return {
            ...ticket,
            category: {
              ...ticket.category,
              name: ticket.category.name[lang] || ticket.category.name.fr || ticket.category.name,
              description: ticket.category.description ? (ticket.category.description[lang] || ticket.category.description.fr || ticket.category.description) : null
            }
          };
        }
        return ticket;
      });

      formatSuccess(res, {
        data,
        pagination: result.pagination,
        message: 'Tickets retrieved successfully'
      });
    } catch (error) {
      formatError(res, error.message, 500);
    }
  }

  async getTicketById(req, res) {
    try {
      const appId = req.appId; // ⭐ AJOUT
      const { id } = req.params;
      const { lang = 'fr' } = req.query;
      const ticket = await ticketService.getTicketById(appId, id); // ⭐ AJOUT appId

      if (!ticket) {
        return formatError(res, 'Ticket not found', 404);
      }

      // Formater la catégorie pour la langue demandée
      let data = ticket;
      if (ticket.category && ticket.category.name && typeof ticket.category.name === 'object') {
        data = {
          ...ticket,
          category: {
            ...ticket.category,
            name: ticket.category.name[lang] || ticket.category.name.fr || ticket.category.name,
            description: ticket.category.description ? (ticket.category.description[lang] || ticket.category.description.fr || ticket.category.description) : null
          }
        };
      }

      formatSuccess(res, {
        data,
        message: 'Ticket retrieved successfully'
      });
    } catch (error) {
      formatError(res, error.message, 500);
    }
  }

  async createTicket(req, res) {
    try {
      const appId = req.appId; // ⭐ AJOUT
      const { title, date, category, closingAt } = req.body;

      if (!title || !date || !category) {
        return formatError(res, 'Title, date and category are required', 400);
      }

      const categoryExists = await categoryService.categoryExists(appId, category); // ⭐ AJOUT appId
      if (!categoryExists) {
        return formatError(res, 'Category not found', 404);
      }

      const ticketData = {
        title,
        date: new Date(date),
        category,
        closingAt: closingAt ? new Date(closingAt) : new Date(date)
      };

      const ticket = await ticketService.createTicket(appId, ticketData); // ⭐ AJOUT appId
      
      res.status(201);
      formatSuccess(res, {
        data: ticket,
        message: 'Ticket created successfully'
      });
    } catch (error) {
      formatError(res, error.message, 500);
    }
  }

  async updateTicket(req, res) {
    try {
      const appId = req.appId; // ⭐ AJOUT
      const { id } = req.params;
      const updates = req.body;

      if (updates.category) {
        const categoryExists = await categoryService.categoryExists(appId, updates.category); // ⭐ AJOUT appId
        if (!categoryExists) {
          return formatError(res, 'Category not found', 404);
        }
      }

      if (updates.date) {
        updates.date = new Date(updates.date);
      }
      if (updates.closingAt) {
        updates.closingAt = new Date(updates.closingAt);
      }

      const ticket = await ticketService.updateTicket(appId, id, updates); // ⭐ AJOUT appId

      if (!ticket) {
        return formatError(res, 'Ticket not found', 404);
      }

      formatSuccess(res, {
        data: ticket,
        message: 'Ticket updated successfully'
      });
    } catch (error) {
      formatError(res, error.message, 500);
    }
  }

  async deleteTicket(req, res) {
    try {
      const appId = req.appId; // ⭐ AJOUT
      const { id } = req.params;
      
      const result = await ticketService.deleteTicket(appId, id); // ⭐ AJOUT appId

      if (!result) {
        return formatError(res, 'Ticket not found', 404);
      }

      formatSuccess(res, {
        data: null,
        message: 'Ticket and associated predictions deleted successfully'
      });
    } catch (error) {
      formatError(res, error.message, 500);
    }
  }
}

module.exports = new TicketController();