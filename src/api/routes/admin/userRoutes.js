// src/api/routes/admin/userRoutes.js

const express = require('express');
const userController = require('../../controllers/admin/userController');
const adminAuth = require('../../middlewares/admin/adminAuth');

const router = express.Router();

/**
 * Toutes les routes nécessitent une authentification admin
 */
router.use(adminAuth.protect);

/**
 * Routes principales
 */
router.route('/')
  .get(userController.getAllUsers);      // GET /api/admin/users

router.route('/stats')
  .get(userController.getUserStats);     // GET /api/admin/users/stats

router.route('/:id')
  .get(userController.getUser)           // GET /api/admin/users/:id
  .put(userController.updateUser)        // PUT /api/admin/users/:id
  .delete(userController.deleteUser);    // DELETE /api/admin/users/:id

router.route('/:id/toggle-status')
  .patch(userController.toggleUserStatus); // PATCH /api/admin/users/:id/toggle-status

router.route('/:id/reset-password')
  .patch(userController.resetPassword);  // PATCH /api/admin/users/:id/reset-password

module.exports = router;