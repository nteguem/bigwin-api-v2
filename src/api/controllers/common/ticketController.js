// controllers/common/ticketController.js

const ticketService = require('../../services/common/ticketService');
const categoryService = require('../../services/common/categoryService');
const correctAndNotifyService = require('../../services/admin/correctAndNotifyService');
const { formatSuccess, formatError } = require('../../../utils/responseFormatter');

class TicketController {

  async getTickets(req, res) {
    try {
      const appId = req.appId;
      const { offset = 0, limit = 10, category, date, isVisible, lang = 'fr' } = req.query;

      const result = await ticketService.getTickets(appId, {
        offset: parseInt(offset),
        limit: parseInt(limit),
        category,
        date: date ? new Date(date) : null,
        isVisible: isVisible !== undefined ? isVisible === 'true' : null
      });

      // Enrichissement : unlockCount par categorie pour les tickets dont la
      // categorie est gated (free + accessGate). Agregation MongoDB une seule
      // fois pour toutes les cats concernees -> attache sur chaque ticket.
      const accessGateService = require('../../services/common/accessGateService');
      const gatedCatIds = [];
      const seenCat = new Set();
      for (const t of result.data) {
        const cat = t.category;
        if (!cat || cat.isVip) continue;
        if (!accessGateService.categoryIsGated(cat)) continue;
        const id = String(cat._id);
        if (seenCat.has(id)) continue;
        seenCat.add(id);
        gatedCatIds.push(cat._id);
      }
      const unlockCountMap = gatedCatIds.length > 0
        ? await accessGateService.countCategoryUnlocks(appId, gatedCatIds)
        : new Map();

      // Formater les catégories pour la langue demandée + injecter unlockCount
      const data = result.data.map(ticket => {
        const catId = ticket.category?._id ? String(ticket.category._id) : null;
        const unlockCount = catId && unlockCountMap.get(catId) || 0;
        const base = { ...ticket, unlockCount };
        if (ticket.category && ticket.category.name && typeof ticket.category.name === 'object') {
          return {
            ...base,
            category: {
              ...ticket.category,
              name: ticket.category.name[lang] || ticket.category.name.fr || ticket.category.name,
              description: ticket.category.description ? (ticket.category.description[lang] || ticket.category.description.fr || ticket.category.description) : null
            }
          };
        }
        return base;
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
      const appId = req.appId;
      const { id } = req.params;
      const { lang = 'fr' } = req.query;
      const ticket = await ticketService.getTicketById(appId, id);

      if (!ticket) {
        return formatError(res, 'Ticket not found', 404);
      }

      // unlockCount par categorie (idem getTickets, version 1 seul ticket)
      const accessGateService = require('../../services/common/accessGateService');
      let unlockCount = 0;
      if (ticket.category && !ticket.category.isVip && accessGateService.categoryIsGated(ticket.category)) {
        const map = await accessGateService.countCategoryUnlocks(appId, [ticket.category._id]);
        unlockCount = map.get(String(ticket.category._id)) || 0;
      }

      // Formater la catégorie pour la langue demandée
      let data = { ...ticket, unlockCount };
      if (ticket.category && ticket.category.name && typeof ticket.category.name === 'object') {
        data = {
          ...data,
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

  /**
   * POST /admin/tickets/:id/notify-success
   *
   * Corrige les prédictions du ticket + le ticket lui-même, puis envoie la
   * notification de victoire SI le ticket est effectivement gagné.
   * Sinon, renvoie le statut sans notifier (sécurité contre fausses notifs).
   */
  async correctAndNotifySuccess(req, res) {
    try {
      const appId = req.appId;
      const { id } = req.params;
      if (!appId) return formatError(res, 'X-App-Id requis', 400);
      if (!id) return formatError(res, 'Ticket id requis', 400);

      const result = await correctAndNotifyService.correctAndNotifyTicket(id, appId);

      formatSuccess(res, {
        data: result,
        message: result.message,
      });
    } catch (error) {
      formatError(res, error.message, error.statusCode || 500);
    }
  }
}

module.exports = new TicketController();