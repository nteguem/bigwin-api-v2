// src/api/controllers/admin/giftController.js

const giftService = require('../../services/admin/giftManagementService');
const catchAsync = require('../../../utils/catchAsync');

exports.getAllGifts = catchAsync(async (req, res) => {
  const appId = req.appId;
  const includeStats = req.query.stats === 'true';
  const gifts = await giftService.listGifts({ appId, includeStats });

  res.status(200).json({
    success: true,
    data: { gifts, count: gifts.length },
  });
});

exports.getGift = catchAsync(async (req, res) => {
  const appId = req.appId;
  const gift = await giftService.getGift({ appId, giftId: req.params.id });

  res.status(200).json({
    success: true,
    data: { gift },
  });
});

exports.createGift = catchAsync(async (req, res) => {
  const appId = req.appId;
  // createGift retourne TOUJOURS un tableau (1 gift par app cible).
  const gifts = await giftService.createGift({ appId, payload: req.body });

  res.status(201).json({
    success: true,
    message: gifts.length > 1
      ? `Cadeau créé sur ${gifts.length} apps`
      : 'Cadeau créé avec succès',
    data: {
      gifts,
      count: gifts.length,
      // Rétrocompat : `gift` = le premier (app du contexte)
      gift: gifts[0],
    },
  });
});

exports.reorderGifts = catchAsync(async (req, res) => {
  const appId = req.appId;
  const gifts = await giftService.reorderGifts({ appId, items: req.body.items });

  res.status(200).json({
    success: true,
    message: 'Ordre mis à jour',
    data: { gifts, count: gifts.length },
  });
});

exports.updateGift = catchAsync(async (req, res) => {
  const appId = req.appId;
  const gift = await giftService.updateGift({
    appId,
    giftId: req.params.id,
    payload: req.body,
  });

  res.status(200).json({
    success: true,
    message: 'Cadeau mis à jour',
    data: { gift },
  });
});

exports.deleteGift = catchAsync(async (req, res) => {
  const appId = req.appId;
  await giftService.deleteGift({ appId, giftId: req.params.id });

  res.status(200).json({
    success: true,
    message: 'Cadeau supprimé',
  });
});

exports.toggleGift = catchAsync(async (req, res) => {
  const appId = req.appId;
  const gift = await giftService.toggleGift({ appId, giftId: req.params.id });

  res.status(200).json({
    success: true,
    message: `Cadeau ${gift.isActive ? 'activé' : 'désactivé'}`,
    data: { gift },
  });
});
