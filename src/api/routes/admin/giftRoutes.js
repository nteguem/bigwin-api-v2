// src/api/routes/admin/giftRoutes.js

const express = require('express');
const giftController = require('../../controllers/admin/giftController');

const router = express.Router();

router
  .route('/')
  .get(giftController.getAllGifts) // GET /api/admin/gifts
  .post(giftController.createGift); // POST /api/admin/gifts

// Réordonnancement en lot — AVANT /:id pour ne pas être capté par /:id
router.route('/reorder').patch(giftController.reorderGifts); // PATCH /api/admin/gifts/reorder

router
  .route('/:id')
  .get(giftController.getGift) // GET /api/admin/gifts/:id
  .put(giftController.updateGift) // PUT /api/admin/gifts/:id
  .delete(giftController.deleteGift); // DELETE /api/admin/gifts/:id

router.route('/:id/toggle').patch(giftController.toggleGift); // PATCH /api/admin/gifts/:id/toggle

module.exports = router;
