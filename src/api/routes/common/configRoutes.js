/**
 * @fileoverview Routes de configuration par pays (GLOBAL)
 * Gère les routes publiques et admin
 */
const express = require('express');
const configController = require('../../controllers/common/configController');
const adminAuth = require('../../middlewares/admin/adminAuth');

const router = express.Router();

/**
 * Routes publiques (sans authentification, sans appId)
 */
// Obtenir config par IP (onboarding)
router.post('/', configController.getConfigByIp);

// Obtenir config par code pays
router.get('/:countryCode', configController.getConfigByCountryCode);

/**
 * Routes protégées admin (authentification requise, sans appId)
 */
// Lister toutes les configurations
router.get('/admin', adminAuth.protect, configController.getAllConfigs);

// Créer une nouvelle configuration
router.post('/admin', adminAuth.protect, configController.createConfig);

// Mettre à jour une configuration
router.put('/admin/:countryCode', adminAuth.protect, configController.updateConfig);

// Supprimer une configuration
router.delete('/admin/:countryCode', adminAuth.protect, configController.deleteConfig);

// Activer/désactiver un pays
router.patch('/admin/:countryCode/toggle', adminAuth.protect, configController.toggleCountry);

module.exports = router;