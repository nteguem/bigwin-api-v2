// src/api/controllers/user/accessController.js
//
// Endpoints utilisateur pour le déblocage de tickets free par visionnage de
// pubs récompensées :
//   POST /user/access/ticket/:ticketId/unlock   { durationMinutes: number|null }
//   GET  /user/access/ticket/:ticketId          → état courant (polling)

const mongoose = require('mongoose');
const TicketService = require('../../services/common/ticketService');
const accessGateService = require('../../services/common/accessGateService');
const catchAsync = require('../../../utils/catchAsync');
const { AppError, ErrorCodes } = require('../../../utils/AppError');

async function loadVisibleTicket(appId, ticketId) {
  if (!mongoose.Types.ObjectId.isValid(ticketId)) {
    throw new AppError('Identifiant de coupon invalide.', 400, ErrorCodes.VALIDATION_ERROR);
  }
  const ticket = await TicketService.getTicketById(appId, ticketId);
  if (!ticket || !ticket.isVisible) {
    throw new AppError('Coupon introuvable ou indisponible.', 404, ErrorCodes.NOT_FOUND);
  }
  return ticket;
}

/**
 * POST /user/access/ticket/:ticketId/unlock
 * Body: { durationMinutes: <number entier > 0, ou null pour "à vie"> }
 *
 * Démarre / re-choisit une tentative de déblocage. Renvoie le `nonce` à passer
 * dans le `customData` des pubs récompensées, ainsi que l'état courant.
 */
exports.unlockTicket = catchAsync(async (req, res) => {
  const appId = req.appId;
  const { ticketId } = req.params;
  const body = req.body || {};

  if (!Object.prototype.hasOwnProperty.call(body, 'durationMinutes')) {
    throw new AppError('Champ "durationMinutes" requis (null pour un déblocage à vie).', 400, ErrorCodes.VALIDATION_ERROR);
  }
  const { durationMinutes } = body;

  const ticket = await loadVisibleTicket(appId, ticketId);

  // Les portes ne concernent que les tickets free.
  if (ticket.category && ticket.category.isVip) {
    throw new AppError("Ce coupon n'est pas concerné par le déblocage par pub.", 400, ErrorCodes.VALIDATION_ERROR);
  }
  if (!accessGateService.ticketIsGated(ticket)) {
    throw new AppError('Ce coupon ne nécessite pas de déblocage.', 400, ErrorCodes.VALIDATION_ERROR);
  }

  const result = await accessGateService.startOrSwitchUnlock(appId, req.user._id, ticket, durationMinutes);

  return res.status(200).json({
    success: true,
    message: result.isAccessActive ? 'Coupon débloqué.' : 'Tentative de déblocage démarrée.',
    data: {
      ticketId: String(ticket._id),
      nonce: result.nonce,
      status: result.status,
      verifiedCount: result.verifiedCount,
      adsRequired: result.adsRequired,
      durationMinutes: result.durationMinutes,        // null = à vie
      unlockedAt: result.unlockedAt,
      unlockedUntil: result.expiresAt || null         // null = à vie ou non débloqué
    }
  });
});

/**
 * GET /user/access/ticket/:ticketId
 * État de la porte du ticket pour l'utilisateur (utilisé en polling après
 * chaque pub).
 */
exports.getTicketAccessState = catchAsync(async (req, res) => {
  const appId = req.appId;
  const { ticketId } = req.params;

  const ticket = await loadVisibleTicket(appId, ticketId);
  const gateState = await accessGateService.getTicketGateState(appId, req.user._id, ticket);

  return res.status(200).json({
    success: true,
    data: {
      ticketId: String(ticket._id),
      gated: gateState.gated,
      locked: gateState.locked,
      offers: gateState.offers,
      state: gateState.state
    }
  });
});
