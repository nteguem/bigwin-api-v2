/**
 * Logger applicatif — Winston structuré (JSON) multi-transport.
 *
 * Niveaux custom (dans l'ordre de criticité décroissante) :
 *   fatal (0) → alerte immédiate (email), app compromise ou fraude
 *   error (1) → exception ou échec critique, doit être investigué
 *   warn  (2) → anomalie récupérable (retry, orphan ref, etc.)
 *   info  (3) → événement métier normal (paiement initié, abo créé)
 *   http  (4) → log HTTP des requêtes
 *   debug (5) → détails techniques (désactivé en prod)
 *
 * Context propagé via `logger.child({ ... })` ou via `{ context }` dans les
 * appels individuels. Le middleware requestId attache le logger enfant sur
 * `req.log` pour que chaque log d'une requête porte le requestId.
 */
const winston = require('winston');
const path = require('path');
const fs = require('fs');

const LEVELS = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  http: 4,
  debug: 5,
};

const LEVEL_COLORS = {
  fatal: 'red bold',
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'cyan',
  debug: 'gray',
};

winston.addColors(LEVEL_COLORS);

// Le dossier logs/ reste utilisé pour le fallback fichier (utile si Mongo est
// indisponible au démarrage). PM2 les lit aussi.
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const isProd = process.env.NODE_ENV === 'production';

// Niveau GLOBAL du logger : c'est un plafond — tout ce qui est en-dessous
// (au sens de rank numérique) sera ignoré par TOUS les transports. On le met
// sur 'http' par défaut pour que les logs HTTP restent visibles dans PM2
// (comportement identique à l'ancien logger qui wrappait http→info).
// Chaque transport peut ensuite FILTRER plus haut (plus restrictif).
const defaultLevel = process.env.LOG_LEVEL || (isProd ? 'http' : 'debug');

// Clés de meta qui ne sont PAS du vrai contexte utilisateur — on les exclut
// de la sortie console pour garder les lignes lisibles.
const NOISE_META_KEYS = new Set(['app']);

// Format machine-readable (JSON) pour fichier + Mongo.
const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Format humain pour la console. On extrait les champs "first-class" (service,
// requestId) pour les afficher en pré-amble, puis le reste en JSON compact.
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: false, level: true }),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf((info) => {
    const { timestamp, level, message, service, requestId, ...rest } = info;
    for (const k of NOISE_META_KEYS) delete rest[k];
    const svc = service ? ` [${service}]` : '';
    const rid = requestId ? ` {${String(requestId).slice(0, 8)}}` : '';
    const meta = Object.keys(rest).length
      ? ` ${JSON.stringify(rest, (k, v) => (v instanceof Error ? v.stack : v))}`
      : '';
    return `${timestamp} ${level}${svc}${rid} ${message}${meta}`;
  })
);

// Per-transport levels : le logger voit tout (jusqu'à http), mais :
//   - File combined : skip HTTP pour ne pas remplir le disque avec la noise
//   - File error    : uniquement les erreurs (comme avant)
//   - Mongo (ajouté + tard) : skip HTTP par défaut (voir transports/mongo.js)
const transports = [
  new winston.transports.Console({ format: consoleFormat }),
  new winston.transports.File({
    filename: path.join(logsDir, 'error.log'),
    level: 'error',
    format: jsonFormat,
    maxsize: 10 * 1024 * 1024,
    maxFiles: 5,
  }),
  new winston.transports.File({
    filename: path.join(logsDir, 'combined.log'),
    level: 'info',
    format: jsonFormat,
    maxsize: 10 * 1024 * 1024,
    maxFiles: 5,
  }),
];

// Transport Mongo attaché de manière différée (après init de la connexion).
// On l'ajoute ici une fois que le module `connection` nous donne une connexion
// prête. Voir `attachMongoTransport()` plus bas.
const baseLogger = winston.createLogger({
  levels: LEVELS,
  level: defaultLevel,
  format: jsonFormat,
  defaultMeta: { app: 'bigwin-api-v2' },
  transports,
  exitOnError: false,
});

/**
 * Attache (une seule fois) un transport MongoDB au logger.
 * Appelé depuis `core/logger/connection.js` après que la connexion logs soit
 * établie. Idempotent.
 */
let mongoTransportAttached = false;
function attachMongoTransport(transport) {
  if (mongoTransportAttached) return;
  baseLogger.add(transport);
  mongoTransportAttached = true;
}

/**
 * Idem pour le transport email — ajouté après init de la connexion Mongo
 * puisqu'il a besoin du modèle Log pour trouver le doc persisté et y poser
 * le flag `alertSent`.
 */
let emailTransportAttached = false;
function attachEmailTransport(transport) {
  if (emailTransportAttached) return;
  baseLogger.add(transport);
  emailTransportAttached = true;
}

// Compat ascendante : l'ancien logger exposait `.http`, `.db`, `.api` comme
// shortcuts. On garde ces helpers pour ne rien casser.
baseLogger.db = (message, meta = {}) => baseLogger.info(message, { ...meta, category: 'db' });
baseLogger.api = (message, meta = {}) => baseLogger.info(message, { ...meta, category: 'api' });

module.exports = baseLogger;
module.exports.attachMongoTransport = attachMongoTransport;
module.exports.attachEmailTransport = attachEmailTransport;
module.exports.LEVELS = LEVELS;
