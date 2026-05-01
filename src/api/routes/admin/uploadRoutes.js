// src/api/routes/admin/uploadRoutes.js

const express = require('express');
const adminAuth = require('../../middlewares/admin/adminAuth');
const { authorize } = require('../../middlewares/admin/rbac');
const { uploadSingle } = require('../../middlewares/admin/uploadMiddleware');
const uploadController = require('../../controllers/admin/uploadController');

const router = express.Router();

// Upload générique. Limité à super_admin pour éviter qu'un compte
// pronostiqueur/investisseur puisse écrire des fichiers sur le serveur.
router.post(
  '/',
  adminAuth.protect,
  authorize('super_admin'),
  uploadSingle,
  uploadController.uploadFile
);

module.exports = router;
