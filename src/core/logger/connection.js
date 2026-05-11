/**
 * Connexion MongoDB dédiée à la collection `logs`.
 *
 * Pourquoi une connexion séparée :
 *   - Les écritures de logs sont fréquentes et pollueraient la collection
 *     principale (stats, index, backups).
 *   - La rétention est courte (TTL 90j) vs. la prod (années).
 *   - On peut la mettre sur un cluster moins cher (Atlas M0 gratuit suffit
 *     pour démarrer).
 *
 * Fallback : si `MONGO_LOGS_URI` n'est pas défini, on réutilise la
 * connexion principale (Mongoose default) pour ne pas bloquer le dev ou un
 * environnement de staging. On log un warning au démarrage dans ce cas.
 */
const mongoose = require('mongoose');
const logger = require('./index');
const createMongoTransport = require('./transports/mongo');
const createEmailTransport = require('./transports/email');

let logsConnection = null;
let initialized = false;

/**
 * Initialise la connexion logs et attache le transport au logger.
 * À appeler UNE fois au démarrage, après que la connexion principale soit
 * établie (pour que le fallback fonctionne).
 *
 * @returns {Promise<mongoose.Connection>}
 */
async function initLogsConnection() {
  if (initialized) return logsConnection;
  initialized = true;

  // Coupe complètement le transport Mongo (et email) des logs — utile en dev
  // où on ne veut que la sortie console. Activer avec DISABLE_MONGO_LOG_TRANSPORT=true.
  if (process.env.DISABLE_MONGO_LOG_TRANSPORT === 'true') {
    logger.warn(
      'Transport Mongo des logs désactivé (DISABLE_MONGO_LOG_TRANSPORT=true) — logs console uniquement.'
    );
    logsConnection = mongoose.connection;
    return logsConnection;
  }

  const logsUri = process.env.MONGO_LOGS_URI;

  if (!logsUri) {
    // Fallback : connexion principale. On warn explicitement — c'est un
    // mode dégradé acceptable en dev mais surveillé en prod.
    logger.warn(
      'MONGO_LOGS_URI absent — fallback sur la connexion principale. ' +
      'En prod, provisionner un cluster séparé (Atlas M0 suffit).'
    );
    logsConnection = mongoose.connection;
  } else {
    try {
      logsConnection = mongoose.createConnection(logsUri, {
        // On limite volontairement le pool : les logs ne doivent jamais
        // saturer les slots de connexion d'un cluster partagé.
        maxPoolSize: 5,
        serverSelectionTimeoutMS: 5000,
      });

      await new Promise((resolve, reject) => {
        logsConnection.once('open', resolve);
        logsConnection.once('error', reject);
      });

      logger.info(`Logs MongoDB connecté: ${logsConnection.host}`);
    } catch (err) {
      // Si le cluster logs tombe, on ne doit PAS crasher l'API. On bascule
      // sur la connexion principale et on continue. Le transport Mongo
      // rattrapera quand il pourra.
      logger.error(
        `Logs MongoDB inaccessible, fallback sur DB principale: ${err.message}`
      );
      logsConnection = mongoose.connection;
    }
  }

  // Attache le transport Winston → Mongo maintenant que la connexion est prête
  logger.attachMongoTransport(createMongoTransport(logsConnection));

  // Transport email : même connexion (il lit le Log doc pour trouver l'_id
  // et marque alertSent=true après envoi). Ne fait rien si ALERT_EMAIL
  // absent — transport silencieux.
  logger.attachEmailTransport(createEmailTransport(logsConnection));

  return logsConnection;
}

/**
 * Accès à la connexion logs (après init). Utilisé par le modèle Log pour
 * définir le schéma sur la bonne connexion.
 */
function getLogsConnection() {
  return logsConnection || mongoose.connection;
}

module.exports = {
  initLogsConnection,
  getLogsConnection,
};
