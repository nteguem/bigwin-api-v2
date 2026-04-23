/**
 * Transport Winston → MongoDB.
 *
 * Écrit chaque log au-dessus d'un certain niveau dans la collection `logs`
 * de la connexion fournie. Sanitize les champs sensibles avant persistance.
 *
 * Principes :
 *   - Ne JAMAIS throw vers le logger (boucle infinie garantie). On catch tout
 *     silencieusement et on log sur stderr en dernier recours.
 *   - Buffer implicite : si la connexion Mongoose n'est pas prête, Mongoose
 *     bufferise les writes par défaut (10s). On laisse ce comportement.
 *   - Taille limite par document : on tronque les gros payloads pour éviter
 *     d'exploser la limite 16MB de BSON.
 */
const Transport = require('winston-transport');

// Clés à masquer automatiquement avant persistance.
// On masque les valeurs, pas les clés — on garde la visibilité structurelle.
const SENSITIVE_KEYS = new Set([
  'password', 'passwd', 'secret', 'token', 'apiKey', 'apikey', 'apiSecret',
  'api_key', 'api_secret', 'authorization', 'cookie', 'cvv', 'cvc',
  'cardNumber', 'card_number', 'pin', 'otp', 'otpCode', 'jwt',
  'refreshToken', 'refresh_token', 'accessToken', 'access_token',
]);

const MAX_FIELD_LENGTH = 10_000; // Tronque les strings trop longues
const MAX_DOC_SIZE_APPROX = 500_000; // ~500KB par doc, bien sous les 16MB BSON

function redact(value, depth = 0) {
  if (depth > 8) return '[truncated:depth]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_FIELD_LENGTH
      ? value.slice(0, MAX_FIELD_LENGTH) + `…[truncated:${value.length}]`
      : value;
  }
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => redact(v, depth + 1));

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = typeof v === 'string' && v.length > 4 ? `***${v.slice(-4)}` : '***';
    } else {
      out[k] = redact(v, depth + 1);
    }
  }
  return out;
}

function approxSize(obj) {
  try {
    return JSON.stringify(obj).length;
  } catch {
    return 0;
  }
}

class MongoTransport extends Transport {
  constructor(opts) {
    super(opts);
    this.connection = opts.connection;
    this.level = opts.level || 'info'; // par défaut on n'écrit pas les debug en DB
    this.modelName = opts.modelName || 'Log';
    this._model = null;
  }

  _getModel() {
    if (this._model) return this._model;
    // Import différé : le modèle dépend de la connexion qu'on vient de créer.
    // On require ici pour que `core/logger/index.js` ne dépende pas du modèle.
    const getLogModel = require('../../../api/models/common/Log');
    this._model = getLogModel(this.connection);
    return this._model;
  }

  log(info, callback) {
    // Winston attend que callback() soit appelée sync pour ne pas bloquer
    // la pipeline. On fait le write DB en fire-and-forget.
    setImmediate(() => this.emit('logged', info));

    try {
      const { timestamp, level, message, service, requestId, appId, userId, category, stack, ...rest } = info;

      const doc = {
        timestamp: timestamp ? new Date(timestamp) : new Date(),
        level,
        message: typeof message === 'string' ? message : JSON.stringify(message),
        service: service || null,
        category: category || null,
        requestId: requestId || null,
        appId: appId || null,
        userId: userId ? String(userId) : null,
        stack: stack || null,
        context: redact(rest),
      };

      // Garde-fou taille
      if (approxSize(doc) > MAX_DOC_SIZE_APPROX) {
        doc.context = { truncated: true, note: 'context stripped (too large)' };
      }

      const Model = this._getModel();
      Model.create(doc).catch((err) => {
        // Jamais ré-émettre dans le logger (boucle infinie). On tombe sur
        // stderr brut. Si Mongo est HS, les logs restent dans les fichiers.
        process.stderr.write(`[MongoTransport] write failed: ${err.message}\n`);
      });
    } catch (err) {
      process.stderr.write(`[MongoTransport] format error: ${err.message}\n`);
    }

    callback();
  }
}

/**
 * Factory : retourne une instance de transport liée à la connexion fournie.
 */
module.exports = function createMongoTransport(connection, opts = {}) {
  return new MongoTransport({
    connection,
    level: process.env.LOG_MONGO_LEVEL || 'info',
    ...opts,
  });
};
