/**
 * @fileoverview Configuration de l'application Express
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const logger = require('./utils/logger');
const errorHandler = require('./api/middlewares/errorMiddleware');
const routes = require('./api/routes');

// Initialisation de l'application Express
const app = express();

// MIDDLEWARE DE DEBUG GLOBAL - EN PREMIER
app.use((req, res, next) => {
  if (req.url.includes('webhook')) {
    console.log('=== DEBUG APP.JS - WEBHOOK DÉTECTÉ ===');
    console.log('Method:', req.method);
    console.log('URL:', req.url);
    console.log('Original URL:', req.originalUrl);
    console.log('Headers Content-Type:', req.get('content-type'));
    console.log('User-Agent:', req.get('user-agent'));
  }
  next();
});

// Configuration spéciale pour les webhooks AVANT les middlewares généraux
app.use('/api/payments/afribapay/webhook', (req, res, next) => {
  console.log('=== MIDDLEWARE SPÉCIAL WEBHOOK ===');
  console.log('Webhook middleware called');
  next();
});

// Middleware essentiels
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(compression());
app.use(helmet());
app.use(cors());
app.use(cookieParser());

// Middleware de logging des requêtes
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`);
  if (req.url.includes('webhook')) {
    console.log('=== LOGGER MIDDLEWARE - WEBHOOK ===');
    console.log('Logger middleware called for webhook');
  }
  next();
});

// DEBUG: Middleware juste avant les routes
app.use((req, res, next) => {
  if (req.url.includes('webhook')) {
    console.log('=== AVANT ROUTES - WEBHOOK ===');
    console.log('About to enter routes');
    console.log('Body after parsing:', req.body);
  }
  next();
});

// Routes de l'API
app.use('/api', routes);

app.use(errorHandler);

// Middleware pour les routes non trouvées
app.use((req, res, next) => {
  const error = new Error(`Route ${req.originalUrl} not found`);
  error.statusCode = 404;
  console.log('=== ROUTE NOT FOUND ===', req.originalUrl);
  next(error);
});

// Gestion des signaux d'arrêt
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

// Export compatible avec votre structure
module.exports = app;