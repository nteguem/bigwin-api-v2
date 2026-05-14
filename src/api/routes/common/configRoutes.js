/**
 * @fileoverview Routes de configuration par pays (GLOBAL)
 * Gère les routes publiques et admin
 */
const express = require('express');
const configController = require('../../controllers/common/configController');
const adminAuth = require('../../middlewares/admin/adminAuth');

const router = express.Router();

/**
 * Routes protégées admin (authentification requise, sans appId)
 * IMPORTANT: /admin AVANT /:countryCode sinon Express capture "admin" comme countryCode
 */
router.get('/admin', adminAuth.protect, configController.getAllConfigs);
router.post('/admin', adminAuth.protect, configController.createConfig);
router.put('/admin/:countryCode', adminAuth.protect, configController.updateConfig);
router.delete('/admin/:countryCode', adminAuth.protect, configController.deleteConfig);
router.patch('/admin/:countryCode/toggle', adminAuth.protect, configController.toggleCountry);

/**
 * Routes publiques (sans authentification, sans appId)
 * IMPORTANT: /countries AVANT /:countryCode sinon Express capture "countries"
 * comme un code pays de 9 lettres.
 */
router.get('/countries', configController.getActiveCountriesPublic);
router.post('/', configController.getConfigByIp);
router.get('/:countryCode', configController.getConfigByCountryCode);

module.exports = router;