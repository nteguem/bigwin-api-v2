/**
 * Formate une réponse réussie
 * @param {Object} res - Objet de réponse Express
 * @param {Object} options
 * @param {Object} [options.data] - Données retournées
 * @param {string} [options.message] - Message de succès
 * @param {number} [options.statusCode=200] - Code HTTP
 * @param {Object} [options.pagination] - Pagination (facultatif)
 */
const formatSuccess = (res, { data, message, statusCode = 200, pagination }) => {
  const response = {
    success: true,
    ...(message && { message }),
    ...(data !== undefined && { data }),
    ...(pagination && { pagination })
  };

  res.status(statusCode).json(response);
};

/**
 * Formate une réponse d'erreur. Accepte 2 signatures pour rétrocompatibilité :
 *
 * NOUVELLE (recommandée) :
 *   formatError(res, { message, statusCode, errors, stack })
 *
 * ANCIENNE (utilisée massivement dans les controllers existants) :
 *   formatError(res, 'message', statusCode, errors)
 *
 * Sans ce dual-support, des centaines d'appels en string masquaient leur
 * message d'erreur (la destructuration échouait silencieusement et
 * `error: undefined` disparaissait du JSON, ne laissant que `{success: false}`
 * côté client).
 *
 * @param {Object} res - Objet de réponse Express
 * @param {string|Object} messageOrOpts
 * @param {number} [maybeStatusCode=500] - Code HTTP (signature ancienne)
 * @param {Object} [maybeErrors] - Détails (signature ancienne)
 */
const formatError = (res, messageOrOpts, maybeStatusCode = 500, maybeErrors) => {
  let message, statusCode, errors, stack;

  if (typeof messageOrOpts === 'string') {
    message = messageOrOpts;
    statusCode = maybeStatusCode;
    errors = maybeErrors;
  } else if (messageOrOpts && typeof messageOrOpts === 'object') {
    ({ message, statusCode = 500, errors, stack } = messageOrOpts);
  } else {
    message = 'Erreur inconnue';
    statusCode = 500;
  }

  const response = {
    success: false,
    error: message,
    ...(errors && { errors }),
    ...(stack && process.env.NODE_ENV === 'development' && { stack })
  };

  res.status(statusCode).json(response);
};

module.exports = {
  formatSuccess,
  formatError
};
