// controllers/admin/ticketController.js

const ticketService = require('../../services/common/ticketService');
const categoryService = require('../../services/common/categoryService');
const { formatSuccess, formatError } = require('../../../utils/responseFormatter');

class TicketController {

  // GET /tickets - Récupérer tous les tickets
  async getTickets(req, res) {
    try {
      // ⭐ Récupérer appId
      const appId = req.appId;
      
      const { offset = 0, limit = 10, category, date, isVisible } = req.query;
      
      // ⭐ Passer appId au service
      const result = await ticketService.getTickets(appId, {
        offset: parseInt(offset),
        limit: parseInt(limit),
        category,
        date: date ? new Date(date) : null,
        isVisible: isVisible !== undefined ? isVisible === 'true' : null
      });

      formatSuccess(res, {
        data: result.data,
        pagination: result.pagination,
        message: 'Tickets retrieved successfully'
      });
    } catch (error) {
      formatError(res, error.message, 500);
    }
  }

  // GET /tickets/:id - Récupérer un ticket par ID
  async getTicketById(req, res) {
    try {
      // ⭐ Récupérer appId
      const appId = req.appId;
      
      const { id } = req.params;
      
      // ⭐ Passer appId au service
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

  // POST /tickets - Créer un nouveau ticket
  async createTicket(req, res) {
    try {
      // ⭐ Récupérer appId
      const appId = req.appId;
      
      const { title, date, category, closingAt } = req.body;

      if (!title || !date || !category) {
        return formatError(res, 'Title, date and category are required', 400);
      }

      // ⭐ Vérifier que la catégorie existe POUR CETTE APP
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

      // ⭐ Passer appId au service
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

  // PUT /tickets/:id - Mettre à jour un ticket
  async updateTicket(req, res) {
    try {
      // ⭐ Récupérer appId
      const appId = req.appId;
      
      const { id } = req.params;
      const updates = req.body;

      // ⭐ Si on change la catégorie, vérifier qu'elle existe POUR CETTE APP
      if (updates.category) {
        const categoryExists = await categoryService.categoryExists(appId, updates.category);
        if (!categoryExists) {
          return formatError(res, 'Category not found', 404);
        }
      }

      // Convertir les dates si présentes
      if (updates.date) {
        updates.date = new Date(updates.date);
      }
      if (updates.closingAt) {
        updates.closingAt = new Date(updates.closingAt);
      }

      // ⭐ Passer appId au service
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

  // DELETE /tickets/:id - Supprimer un ticket et ses prédictions
  async deleteTicket(req, res) {
    try {
      // ⭐ Récupérer appId
      const appId = req.appId;
      
      const { id } = req.params;
      
      // ⭐ Passer appId au service
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