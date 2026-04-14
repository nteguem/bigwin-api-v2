// src/api/routes/admin/adminRoutes.js
// RBAC — super_admin only.

const express = require('express');
const adminController = require('../../controllers/admin/adminController');
const adminAuth = require('../../middlewares/admin/adminAuth');
const { authorize } = require('../../middlewares/admin/rbac');

const router = express.Router();

router.use(adminAuth.protect, authorize('super_admin'));

router.route('/')
  .get(adminController.listAdmins)
  .post(adminController.createAdmin);

router.route('/:id')
  .get(adminController.getAdmin)
  .patch(adminController.updateAdmin)
  .delete(adminController.deleteAdmin);

router.post('/:id/reset-password', adminController.resetPassword);

module.exports = router;
