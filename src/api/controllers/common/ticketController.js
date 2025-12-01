// controllers/admin/ticketController.js

const ticketService = require('../../services/common/ticketService');
const categoryService = require('../../services/common/categoryService');
const { formatSuccess, formatError } = require('../../../utils/responseFormatter');

class TicketController {

  async getTickets(req, res) {
    try {
      const appId = req.appId;
      
      const { offset = 0, limit = 10, category, date, isVisible } = req.query;
      
      // ⭐ CONVERTIR LES TYPES CORRECTEMENT
      const filters = {
        offset: parseInt(offset),
        limit: parseInt(limit),
        category: category || null,
        date: date ? new Date(date) : null,
        isVisible: isVisible !== undefined ? isVisible === 'true' : null
      };
      
      const result = await ticketService.getTickets(appId, filters);

      formatSuccess(res, {
        data: result.data,
        pagination: result.pagination,
        message: 'Tickets retrieved successfully'
      });
    } catch (error) {
      formatError(res, error.message, 500);
    }
  }

  async getTicketById(req, res) {
    try {
      const appId = req.appId;
      const { id } = req.params;
      
      const ticket = await ticketService.getTicketById(appId, id);

      if (!ticket) {
        return formatError(res, 'Ticket not found', 404);
      }

      formatSuccess(res, {
        data: ticket,
        message: 'Ticket retrieved successfully'
      });
    } catch (error) {
      formatError(res, error.message, 500);
    }
  }

  async createTicket(req, res) {
    try {
      const appId = req.appId;
      const { title, date, category, closingAt } = req.body;

      if (!title || !date || !category) {
        return formatError(res, 'Title, date and category are required', 400);
      }

      const categoryExists = await categoryService.categoryExists(appId, category);
      if (!categoryExists) {
        return formatError(res, 'Category not found', 404);
      }

      const ticketData = {
        title,
        date: new Date(date),
        category,
        closingAt: closingAt ? new Date(closingAt) : new Date(date)
      };

      const ticket = await ticketService.createTicket(appId, ticketData);
      
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
      const appId = req.appId;
      const { id } = req.params;
      const updates = req.body;

      if (updates.category) {
        const categoryExists = await categoryService.categoryExists(appId, updates.category);
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

      const ticket = await ticketService.updateTicket(appId, id, updates);

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
      const appId = req.appId;
      const { id } = req.params;
      
      const result = await ticketService.deleteTicket(appId, id);

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