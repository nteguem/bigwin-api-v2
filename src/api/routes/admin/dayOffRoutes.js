const express = require('express');
const adminAuth = require('../../middlewares/admin/adminAuth');
const DayOff = require('../../models/common/DayOff');
const DayOffMessage = require('../../models/common/DayOffMessage');
const { formatSuccess, formatError } = require('../../../utils/responseFormatter');

const router = express.Router();

router.use(adminAuth.protect);

// ===== MESSAGES PRÉDÉFINIS =====

// GET /admin/day-off/messages — lister les messages disponibles
router.get('/messages', async (req, res) => {
  try {
    const appId = req.appId;
    const messages = await DayOffMessage.find({ appId }).sort({ createdAt: -1 });

    formatSuccess(res, {
      data: messages,
      message: `${messages.length} message(s) trouvé(s)`
    });
  } catch (error) {
    formatError(res, error.message, 500);
  }
});

// POST /admin/day-off/messages — créer un message
router.post('/messages', async (req, res) => {
  try {
    const appId = req.appId;
    const { message } = req.body;

    if (!message?.fr || !message?.en) {
      return formatError(res, 'Message fr et en requis', 400);
    }

    const created = await DayOffMessage.create({ appId, message });

    formatSuccess(res, {
      data: created,
      message: 'Message créé',
      statusCode: 201
    });
  } catch (error) {
    formatError(res, error.message, 500);
  }
});

// DELETE /admin/day-off/messages/:id — supprimer un message
router.delete('/messages/:id', async (req, res) => {
  try {
    const appId = req.appId;
    const deleted = await DayOffMessage.findOneAndDelete({ _id: req.params.id, appId });

    if (!deleted) {
      return formatError(res, 'Message non trouvé', 404);
    }

    formatSuccess(res, { data: null, message: 'Message supprimé' });
  } catch (error) {
    formatError(res, error.message, 500);
  }
});

// ===== JOURS OFF =====

// GET /admin/day-off — lister les jours off
router.get('/', async (req, res) => {
  try {
    const appId = req.appId;
    const { all } = req.query;

    const filter = { appId };
    if (!all) {
      const today = new Date().toISOString().split('T')[0];
      filter.date = { $gte: today };
    }

    const dayOffs = await DayOff.find(filter).populate('message').sort({ date: 1 });

    formatSuccess(res, {
      data: dayOffs,
      message: `${dayOffs.length} jour(s) off trouvé(s)`
    });
  } catch (error) {
    formatError(res, error.message, 500);
  }
});

// POST /admin/day-off — activer un jour off
router.post('/', async (req, res) => {
  try {
    const appId = req.appId;
    const { date, messageId } = req.body;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return formatError(res, 'Date requise (format YYYY-MM-DD)', 400);
    }

    if (!messageId) {
      return formatError(res, 'messageId requis', 400);
    }

    const messageExists = await DayOffMessage.findOne({ _id: messageId, appId });
    if (!messageExists) {
      return formatError(res, 'Message non trouvé', 404);
    }

    const dayOff = await DayOff.findOneAndUpdate(
      { appId, date },
      { appId, date, message: messageId },
      { upsert: true, new: true }
    );

    const populated = await dayOff.populate('message');

    formatSuccess(res, {
      data: populated,
      message: `Jour off activé pour le ${date}`,
      statusCode: 201
    });
  } catch (error) {
    formatError(res, error.message, 500);
  }
});

// DELETE /admin/day-off/:date — désactiver un jour off
router.delete('/:date', async (req, res) => {
  try {
    const appId = req.appId;
    const { date } = req.params;

    const deleted = await DayOff.findOneAndDelete({ appId, date });

    if (!deleted) {
      return formatError(res, `Aucun jour off pour le ${date}`, 404);
    }

    formatSuccess(res, { data: null, message: `Jour off du ${date} désactivé` });
  } catch (error) {
    formatError(res, error.message, 500);
  }
});

module.exports = router;
