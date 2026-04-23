/**
 * Modèle Log — stocke les logs applicatifs dans la DB logs.
 *
 * IMPORTANT : ce modèle doit être attaché à la connexion `logsConnection`
 * (retournée par `core/logger/connection.js#initLogsConnection`), pas à la
 * connexion Mongoose par défaut. On exporte donc une factory qui prend la
 * connexion en argument.
 *
 * Index :
 *   - `{ timestamp: -1 }` : ordre décroissant pour le feed "live"
 *   - `{ level, timestamp: -1 }` : filtre rapide par niveau
 *   - `{ appId, timestamp: -1 }` : filtre par tenant (X-App-Id)
 *   - `{ requestId }` : "show related logs" dans le drawer
 *   - `{ service, timestamp: -1 }` : filtre par service (afribapay, smobilpay…)
 *   - TTL 90j sur timestamp : auto-cleanup, pas besoin de cron
 */
const mongoose = require('mongoose');

const logSchema = new mongoose.Schema(
  {
    // Pas d'`index: true` ici : on définit l'index TTL plus bas via
    // `schema.index({ timestamp: 1 }, { expireAfterSeconds })` qui sert
    // aussi d'index simple. Déclarer les deux génère un warning Mongoose
    // "Duplicate schema index".
    timestamp: {
      type: Date,
      default: Date.now,
      required: true,
    },

    // fatal | error | warn | info | http | debug
    level: {
      type: String,
      required: true,
      enum: ['fatal', 'error', 'warn', 'info', 'http', 'debug'],
      index: true,
    },

    message: { type: String, required: true },

    // Nom du service émetteur (afribapay, smobilpay, paymentMiddleware, auth…)
    // Sert aux filtres + au groupage pour le throttling des emails.
    service: { type: String, default: null, index: true },

    // Sous-catégorie optionnelle (webhook, initiate, verify, db, api…)
    // Couplée au service, elle donne la clé de throttling email.
    category: { type: String, default: null },

    // UUID de la requête HTTP (attaché par le middleware requestId).
    // Permet de reconstituer la chaîne complète d'une requête.
    requestId: { type: String, default: null, index: true },

    // Tenant multi-tenant (X-App-Id). Null pour les logs système (startup,
    // cron, etc.)
    appId: { type: String, default: null, lowercase: true },

    // User lié, si disponible au moment du log.
    userId: { type: String, default: null },

    // Stack trace pour les erreurs.
    stack: { type: String, default: null },

    // Tout le reste (metadata non-structurée) dans un objet flou. Déjà
    // sanitized (clés sensibles masquées) par le transport Mongo.
    context: { type: mongoose.Schema.Types.Mixed, default: {} },

    // État de l'alerte email pour ce log (rempli par le transport email en
    // J2). Garde une trace qu'une alerte a été envoyée.
    alertSent: { type: Boolean, default: false },
    alertSentAt: { type: Date, default: null },
  },
  {
    // Pas de `createdAt/updatedAt` — on a notre propre `timestamp` plus
    // précis et l'updatedAt n'a pas de sens (un log est immuable).
    timestamps: false,
    // Désactive la versioning `__v` : un log ne se modifie pas.
    versionKey: false,
    // On va écrire beaucoup, minifier le doc stocké est une micro-optim utile.
    minimize: true,
  }
);

// TTL 90 jours — MongoDB supprime auto les vieux logs.
// La valeur est paramétrable via env pour pouvoir l'étendre en cas d'enquête.
const TTL_SECONDS = parseInt(process.env.LOG_TTL_SECONDS || String(90 * 24 * 3600), 10);
logSchema.index({ timestamp: 1 }, { expireAfterSeconds: TTL_SECONDS });

// Index composites pour les filtres fréquents du backoffice.
logSchema.index({ appId: 1, timestamp: -1 });
logSchema.index({ level: 1, timestamp: -1 });
logSchema.index({ service: 1, timestamp: -1 });
logSchema.index({ appId: 1, level: 1, timestamp: -1 });

// Évite de re-compiler le modèle si la connexion en a déjà une instance.
// Permet aux imports multiples (transport mongo + controllers) de partager.
let cachedModel = null;

/**
 * Factory : retourne le modèle Log attaché à la connexion fournie.
 * @param {mongoose.Connection} connection
 */
module.exports = function getLogModel(connection) {
  if (cachedModel && cachedModel.db === connection) return cachedModel;
  if (connection.models && connection.models.Log) {
    cachedModel = connection.models.Log;
    return cachedModel;
  }
  cachedModel = connection.model('Log', logSchema);
  return cachedModel;
};
