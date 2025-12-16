// src/api/routes/common/notificationRoutes.js
const express = require('express');
const notificationController = require('../../controllers/common/notificationController');

const router = express.Router();

/**
 * @route POST /api/notifications/send
 * @desc Envoyer une notification à des playerIds spécifiques
 * @body { playerIds: string[], notification: { contents: object, headings?: object, data?: object, options?: object } }
 * @access Private (Admin/System)
 */
router.post('/send', notificationController.send);

/**
 * @route POST /api/notifications/broadcast
 * @desc Envoyer une notification à tous les utilisateurs
 * @body { notification: { contents: object, headings?: object, data?: object, options?: object } }
 * @access Private (Admin/System)
 */
router.post('/broadcast', notificationController.broadcast);

/**
 * @route POST /api/notifications/send-with-filters
 * @desc Envoyer une notification avec des filtres OneSignal
 * @body { filters: array, notification: { contents: object, headings?: object, data?: object, options?: object } }
 * @access Private (Admin/System)
 */
router.post('/send-with-filters', notificationController.sendWithFilters);

/**
 * @route POST /api/notifications/check-players
 * @desc Vérifier si des player IDs sont valides et actifs
 * @body { playerIds: string[] }
 * @access Private (Admin/System)
 */
router.post('/check-players', notificationController.checkPlayers);

/**
 * @route GET /api/notifications/active-players
 * @desc Récupérer la liste des utilisateurs actifs
 * @query { limit?: number, offset?: number }
 * @access Private (Admin/System)
 */
router.get('/active-players', notificationController.getActivePlayers);

/**
 * @route POST /api/notifications/generate
 * @desc Générer des propositions de notifications via IA
 * @body { prompt: string, context?: object, count?: number (1-3) }
 * @example
 * {
 *   "prompt": "Notification pour souhaiter bonne année 2025 et promouvoir les abonnements VIP avec une réduction de 20%",
 *   "context": {
 *     "event": "new_year",
 *     "discount": "20%",
 *     "urgency": "high"
 *   },
 *   "count": 3
 * }
 * @access Private (Admin/System)
 */
router.post('/generate', notificationController.generateNotifications);

/**
 * @route GET /api/notifications/ai-status
 * @desc Vérifier si le service de génération IA est disponible
 * @access Private (Admin/System)
 */
router.get('/ai-status', notificationController.checkAIStatus);


/**
 * @route POST /api/notifications/send-to-countries
 * @desc Envoyer une notification à tous les utilisateurs de pays spécifiques
 * @body { 
 *   countryCodes: string[] (ex: ["SN", "CM", "CI"]),
 *   notification: { contents: object, headings?: object, data?: object, options?: object },
 *   options?: { includeGuests?: boolean, batchSize?: number }
 * }
 * @example
 * {
 *   "countryCodes": ["SN", "CM"],
 *   "notification": {
 *     "headings": {
 *       "en": "Special Offer",
 *       "fr": "Offre Spéciale"
 *     },
 *     "contents": {
 *       "en": "Get 20% off on all VIP subscriptions!",
 *       "fr": "Obtenez 20% de réduction sur tous les abonnements VIP !"
 *     },
 *     "data": {
 *       "type": "promotion",
 *       "discount": "20"
 *     }
 *   },
 *   "options": {
 *     "includeGuests": false,
 *     "batchSize": 2000
 *   }
 * }
 * @access Private (Admin/System)
 */
router.post('/send-to-countries', notificationController.sendToCountries);

module.exports = router;