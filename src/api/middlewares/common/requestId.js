/**
 * Middleware requestId — attache un UUID à chaque requête entrante.
 *
 * Effets :
 *   - `req.requestId` garanti dispo dans tout le cycle de vie de la requête.
 *   - Header `X-Request-Id` ajouté à la réponse pour que le client (mobile,
 *     backoffice, curl) puisse le remonter en cas d'incident.
 *   - Si le client envoie déjà un `X-Request-Id` valide (UUID v4) dans la
 *     requête, on le respecte — utile pour corréler des appels chaînés
 *     cross-service (mobile → API, backoffice → API).
 *   - `req.log` = wrapper qui injecte requestId/appId/userId à CHAQUE appel.
 *     On n'utilise pas `logger.child()` car il fige les bindings au moment
 *     de la création — or `req.appId` et `req.user` sont résolus par des
 *     middlewares qui tournent APRÈS celui-ci.
 */
const { v4: uuidv4 } = require('uuid');
const logger = require('../../../core/logger');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LEVELS = ['fatal', 'error', 'warn', 'info', 'http', 'debug'];

function buildReqLogger(req, requestId) {
  const wrapped = {};
  for (const level of LEVELS) {
    wrapped[level] = (message, meta = {}) => {
      logger[level](message, {
        requestId,
        appId: req.appId || null,
        userId: req.user?._id ? String(req.user._id) : null,
        ...meta,
      });
    };
  }
  return wrapped;
}

function requestIdMiddleware(req, res, next) {
  const incoming = req.get('X-Request-Id');
  const requestId = incoming && UUID_RE.test(incoming) ? incoming : uuidv4();

  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  req.log = buildReqLogger(req, requestId);

  next();
}

module.exports = requestIdMiddleware;
