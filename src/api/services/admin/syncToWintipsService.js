// src/api/services/admin/syncToWintipsService.js
//
// Synchronisation sortante bigwin -> wintips.
//
// Declenchee par le hook post('findOneAndUpdate') de Ticket quand un
// ticket bigwin passe a isVisible=true. Le service POUSSE l'info vers
// wintips sans connaitre la cible : wintips decide lui-meme si la
// categorie source bigwin matche une de ses externalSources, et clone
// dans la bonne categorie wintips.
//
// Cote bigwin : aucune config par categorie n'est necessaire. Toutes
// les publications sont poussees a wintips, qui filtre selon sa propre
// config (Category.externalSources).
//
// Fire-and-forget : toute erreur est loggee mais jamais propagee a la
// sauvegarde du Ticket bigwin.

const axios = require('axios');
const mongoose = require('mongoose');
const logger = require('../../../utils/logger');

const WINTIPS_API_URL = (process.env.WINTIPS_API_URL || '').replace(/\/$/, '');
const HTTP_TIMEOUT_MS = 10000;

function isConfigured() {
  return Boolean(WINTIPS_API_URL);
}

function url(path) {
  return `${WINTIPS_API_URL}/api/internal/sync${path}`;
}

/**
 * Entry point appele depuis le hook Ticket. Pousse l'info de publication
 * a wintips. Wintips decide quoi en faire selon ses externalSources.
 *
 * Idempotence : si externalRefs.wintips est deja set, on appelle juste
 * la route publish (re-broadcast notif si necessaire). Sinon, create + bulk
 * predictions + publish.
 *
 * @param {Object} doc  Ticket Mongoose document (peut etre lean ou doc)
 */
async function maybeSyncTicket(doc) {
  if (!isConfigured()) {
    logger.warn('[syncWintips] WINTIPS_API_URL non configure, skip');
    return;
  }
  if (!doc || !doc._id) return;

  // Re-fetch avec category populee pour avoir le nom + l'appId source
  const Ticket = mongoose.model('Ticket');
  const ticket = await Ticket.findById(doc._id).populate('category').lean();
  if (!ticket) return;
  if (!ticket.isVisible) return; // ne sync que les tickets publies

  const sourceAppId = ticket.appId || (ticket.category && ticket.category.appId) || null;
  const sourceCategoryId = ticket.category?._id ? String(ticket.category._id) : null;
  if (!sourceAppId || !sourceCategoryId) {
    logger.warn(`[syncWintips] ticket ${ticket._id} sans appId/category, skip`);
    return;
  }

  try {
    let wintipsTicketId = ticket.externalRefs?.wintips || null;

    if (!wintipsTicketId) {
      // 1ere sync : creer le ticket cote wintips (wintips resout la cat cible)
      const createResp = await axios.post(
        url('/tickets'),
        {
          sourceAppId,
          sourceCategoryId,
          title: ticket.title,
          date: ticket.date,
          closingAt: ticket.closingAt,
        },
        { timeout: HTTP_TIMEOUT_MS }
      );

      // wintips peut volontairement ignorer (pas de mapping configure)
      const data = createResp?.data?.data || {};
      if (data.ignored) {
        logger.info(`[syncWintips] ticket ${ticket._id} ignore par wintips (pas de mapping)`);
        return;
      }
      wintipsTicketId = data._id || null;
      if (!wintipsTicketId) {
        throw new Error('Reponse wintips sans _id sur create ticket');
      }

      // Memoriser pour idempotence
      await Ticket.updateOne(
        { _id: ticket._id },
        { $set: { 'externalRefs.wintips': wintipsTicketId } }
      );
      logger.info(`[syncWintips] Ticket ${ticket._id} -> wintips ${wintipsTicketId} cree`);

      // 2. Cloner les predictions
      const Prediction = mongoose.model('Prediction');
      const preds = await Prediction.find({ ticket: ticket._id }).lean();
      if (preds.length > 0) {
        const payload = preds.map((p) => ({
          matchData: p.matchData,
          event: p.event,
          odds: p.odds,
          sport: p.sport,
        }));
        await axios.post(
          url(`/tickets/${wintipsTicketId}/predictions`),
          { predictions: payload },
          { timeout: HTTP_TIMEOUT_MS }
        );
        logger.info(`[syncWintips] ${preds.length} predictions envoyees pour ${wintipsTicketId}`);
      }
    }

    // 3. Publier (isVisible=true) -> declenche la notif push wintips
    await axios.put(
      url(`/tickets/${wintipsTicketId}/publish`),
      {},
      { timeout: HTTP_TIMEOUT_MS }
    );
    logger.info(`[syncWintips] Ticket wintips ${wintipsTicketId} publie`);
  } catch (err) {
    const detail = err.response?.data || err.message;
    logger.error(`[syncWintips] echec sync ticket=${ticket._id} : ${JSON.stringify(detail)}`);
  }
}

module.exports = { maybeSyncTicket };
