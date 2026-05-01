// src/api/controllers/admin/giftTierController.js

const tierService = require('../../services/admin/giftTierManagementService');
const catchAsync = require('../../../utils/catchAsync');

exports.getAllTiers = catchAsync(async (req, res) => {
  const activeOnly = req.query.activeOnly === 'true';
  const [tiers, usage] = await Promise.all([
    tierService.listTiers({ activeOnly }),
    tierService.getTierUsage(),
  ]);

  res.status(200).json({
    success: true,
    data: {
      tiers: tiers.map((t) => ({
        ...t.toJSON(),
        giftCount: usage[t._id.toString()] || 0,
      })),
      count: tiers.length,
    },
  });
});

exports.getTier = catchAsync(async (req, res) => {
  const tier = await tierService.getTier(req.params.id);
  res.status(200).json({ success: true, data: { tier } });
});

exports.createTier = catchAsync(async (req, res) => {
  const tier = await tierService.createTier(req.body);
  res.status(201).json({
    success: true,
    message: 'Tier créé avec succès',
    data: { tier },
  });
});

exports.updateTier = catchAsync(async (req, res) => {
  const tier = await tierService.updateTier(req.params.id, req.body);
  res.status(200).json({
    success: true,
    message: 'Tier mis à jour',
    data: { tier },
  });
});

exports.deleteTier = catchAsync(async (req, res) => {
  await tierService.deleteTier(req.params.id);
  res.status(200).json({ success: true, message: 'Tier supprimé' });
});
