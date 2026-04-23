/**
 * @fileoverview Configuration de l'application Express
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const logger = require('./core/logger');
const errorHandler = require('./api/middlewares/errorMiddleware');
const requestId = require('./api/middlewares/common/requestId');
const routes = require('./api/routes');


// Initialisation de l'application Express
const app = express();

// Middleware essentiels
// `verify` capture le raw body AVANT le parsing JSON — nécessaire pour la
// vérification HMAC des webhooks (AfribaPay, Flutterwave…) qui exigent le
// payload byte-for-byte, pas re-sérialisé.
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString('utf8');
  }
}));
app.use(express.urlencoded({ extended: true }));
app.use(compression());
app.use(helmet());
app.use(cors());
app.use(cookieParser());

// RequestId : attache un UUID + X-Request-Id header + req.log dès le premier
// middleware pour que TOUTES les lignes de log d'une requête soient corrélées.
// Doit être le tout premier middleware applicatif.
app.use(requestId);

// Logging HTTP structuré : à la fin de la requête, on log method/url/status/
// durée. Utilise le niveau `http` (pas `info`) pour pouvoir filtrer dans le
// backoffice (les logs HTTP sont bruyants, on veut les séparer du métier).
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    req.log.http(`${req.method} ${req.originalUrl} ${res.statusCode}`, {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - start,
      service: 'http',
    });
  });
  next();
});


// Routes de l'API
app.use('/api', routes);

// Middleware pour les routes non trouvées (AVANT errorHandler)
app.use((req, res, next) => {
  const error = new Error(`Route ${req.originalUrl} not found`);
  error.statusCode = 404;
  next(error);
});

// Gestionnaire d'erreurs global (TOUJOURS EN DERNIER)
app.use(errorHandler);

// Gestion des signaux d'arrêt
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

module.exports = app;